package org.jpi59.mommytv

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.SocketTimeoutException

/**
 * The phone talks to an LG webOS TV directly, with LG's own second-screen protocol (the one LG's
 * Connect SDK uses). The TV asks its owner once to allow the phone; after that the phone may open
 * MommyTV there with what to play. Only the LAUNCH and READ_RUNNING_APPS permissions are requested.
 */
object LgTv {
    const val APP_ID = "org.jpi59.mommytv"
    private const val PORT = 3001 // TLS; newer firmware closes the plain 3000
    private const val SSDP_TYPE = "urn:lge-com:service:webos-second-screen:1"

    data class Found(val host: String, val name: String)
    sealed interface Sent { data object Ok : Sent; data object NoApp : Sent; data object NotAllowed : Sent; data object Unreachable : Sent }

    /** Asks the LAN which LG TVs are there (SSDP, as LG's apps do); answers for [timeoutMs]. */
    suspend fun discover(timeoutMs: Int = 3000): List<Found> = withContext(Dispatchers.IO) {
        val found = LinkedHashMap<String, Found>()
        runCatching {
            DatagramSocket().use { socket ->
                socket.soTimeout = 400
                val ask = ("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: $SSDP_TYPE\r\n\r\n").toByteArray()
                val group = InetAddress.getByName("239.255.255.250")
                repeat(2) { socket.send(DatagramPacket(ask, ask.size, group, 1900)) }
                val until = System.currentTimeMillis() + timeoutMs
                val buf = ByteArray(2048)
                while (System.currentTimeMillis() < until) {
                    val packet = DatagramPacket(buf, buf.size)
                    try { socket.receive(packet) } catch (e: SocketTimeoutException) { continue }
                    val host = packet.address.hostAddress ?: continue
                    val answer = String(packet.data, 0, packet.length, Charsets.UTF_8)
                    if (SSDP_TYPE in answer && host !in found) found[host] = Found(host, deviceName(answer) ?: friendlyName(answer) ?: host)
                }
            }
        }
        found.values.toList()
    }

    /** The name the TV gives in the description its answer points to (LOCATION), or null. */
    private fun friendlyName(answer: String): String? = runCatching {
        val location = answer.lineSequence().firstOrNull { it.startsWith("LOCATION:", ignoreCase = true) }?.substringAfter(':')?.trim() ?: return null
        if (!location.startsWith("http://")) return null
        val c = java.net.URL(location).openConnection() as java.net.HttpURLConnection
        c.connectTimeout = 2000; c.readTimeout = 2000
        try { nameInDescription(c.inputStream.use { it.readBytes().toString(Charsets.UTF_8).take(64 * 1024) }) } finally { c.disconnect() }
    }.getOrNull()

    /** <friendlyName>…</friendlyName> of a UPnP device description. */
    fun nameInDescription(xml: String): String? = Regex("<friendlyName>([^<]{1,80})</friendlyName>").find(xml)?.groupValues?.get(1)?.trim()
        ?.replace("&amp;", "&")?.takeIf { it.isNotEmpty() }

    /** "DLNADeviceName.lge.com: [LG] webOS TV" in the answer, decoded; null if absent. */
    fun deviceName(answer: String): String? = answer.lineSequence()
        .firstOrNull { it.startsWith("DLNADeviceName.lge.com:", ignoreCase = true) }
        ?.substringAfter(':')?.trim()?.let { runCatching { java.net.URLDecoder.decode(it, "UTF-8") }.getOrDefault(it) }
        ?.takeIf { it.isNotEmpty() }

    private fun register(key: String?) = JSONObject().put("type", "register").put("id", "register").put("payload", JSONObject()
        .put("forcePairing", false).put("pairingType", "PROMPT").apply { if (key != null) put("client-key", key) }
        .put("manifest", JSONObject().put("manifestVersion", 1).put("appVersion", "0.1").put("appId", "$APP_ID.remote")
            .put("vendorId", "IDEH Labs").put("localizedAppNames", JSONObject().put("", "MommyTV"))
            .put("permissions", JSONArray(listOf("LAUNCH", "LAUNCH_WEBAPP", "READ_RUNNING_APPS"))))).toString()

    /** What pairing yields: the key the TV grants and its certificate's fingerprint, pinned from now on. */
    data class Paired(val key: String, val pin: String)

    /** Pairs with the TV: it shows a prompt and waits up to a minute for its owner. */
    suspend fun pair(host: String, key: String?): Paired? = withContext(Dispatchers.IO) {
        runCatching {
            Ws.connect(host, PORT, pin = null).use { ws ->
                ws.send(register(key))
                ws.timeout(60_000)
                while (true) {
                    val r = JSONObject(ws.receive())
                    when (r.optString("type")) {
                        "registered" -> return@runCatching Paired(r.getJSONObject("payload").getString("client-key"), ws.fingerprint)
                        "error" -> return@runCatching null
                    }
                }
                @Suppress("UNREACHABLE_CODE") null
            }
        }.getOrNull()
    }

    /**
     * Opens MommyTV on the TV with [params]; a running MommyTV gets them at once. [pin] is the TV's
     * certificate fingerprint; [learned] receives it when a phone paired before 0.1.3 meets the TV first.
     */
    suspend fun launch(host: String, key: String, pin: String?, params: Map<String, String>, learned: (String) -> Unit = {}): Sent = withContext(Dispatchers.IO) {
        runCatching {
            Ws.connect(host, PORT, pin).use { ws ->
                if (pin == null) learned(ws.fingerprint)
                ws.send(register(key))
                ws.timeout(8000)
                while (true) {
                    val r = JSONObject(ws.receive())
                    if (r.optString("id") == "register") when (r.optString("type")) {
                        "registered" -> ws.send(JSONObject().put("type", "request").put("id", "launch").put("uri", "ssap://system.launcher/launch")
                            .put("payload", JSONObject().put("id", APP_ID).put("params", JSONObject(params as Map<*, *>))).toString())
                        "response" -> return@runCatching Sent.NotAllowed // the TV asks again: this phone's key is no longer valid
                        "error" -> return@runCatching Sent.NotAllowed
                    }
                    if (r.optString("id") == "launch") {
                        return@runCatching if (r.optString("type") == "response" && r.optJSONObject("payload")?.optBoolean("returnValue") == true) Sent.Ok else Sent.NoApp
                    }
                }
                @Suppress("UNREACHABLE_CODE") Sent.Unreachable
            }
        }.getOrDefault(Sent.Unreachable)
    }
}
