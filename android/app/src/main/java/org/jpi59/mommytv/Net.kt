package org.jpi59.mommytv

import android.content.Context
import android.net.ConnectivityManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.URL

object Net {
    const val MANAGER_PORT = 8642
    private const val MAX_BYTES = 25 * 1024 * 1024

    class HttpError(val code: Int) : Exception("HTTP $code")

    /** GET as text, following up to 5 redirects (also http <-> https, which HttpURLConnection does not). */
    suspend fun fetch(url: String, timeoutMs: Int = 20000): String = withContext(Dispatchers.IO) {
        var current = url
        repeat(6) {
            val c = URL(current).openConnection() as HttpURLConnection
            c.connectTimeout = timeoutMs
            c.readTimeout = timeoutMs
            c.instanceFollowRedirects = false
            c.setRequestProperty("User-Agent", "MommyTV")
            try {
                val code = c.responseCode
                if (code in 300..399) {
                    val loc = c.getHeaderField("Location") ?: throw HttpError(code)
                    current = URL(URL(current), loc).toString()
                    return@repeat
                }
                if (code !in 200..299) throw HttpError(code)
                c.inputStream.use { input ->
                    val out = java.io.ByteArrayOutputStream()
                    val buf = ByteArray(16 * 1024)
                    while (out.size() < MAX_BYTES) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                    }
                    return@withContext out.toString("UTF-8")
                }
            } finally {
                c.disconnect()
            }
        }
        throw HttpError(310)
    }

    /** POST a small JSON body; returns the status and the response text (MommyTV Manager only). */
    suspend fun post(url: String, json: String, timeoutMs: Int = 8000): kotlin.Pair<Int, String> = withContext(Dispatchers.IO) {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = timeoutMs
        c.readTimeout = timeoutMs
        c.requestMethod = "POST"
        c.doOutput = true
        c.setRequestProperty("Content-Type", "application/json; charset=utf-8")
        c.setRequestProperty("User-Agent", "MommyTV")
        try {
            c.outputStream.use { it.write(json.toByteArray(Charsets.UTF_8)) }
            val code = c.responseCode
            val stream = if (code in 200..299) c.inputStream else c.errorStream
            code to (stream?.use { it.readBytes().toString(Charsets.UTF_8).take(64 * 1024) } ?: "")
        } finally {
            c.disconnect()
        }
    }

    /** This device's IPv4 address on the active network, without any extra permission than ACCESS_NETWORK_STATE. */
    fun localIpv4(context: Context): String? {
        val cm = context.getSystemService(ConnectivityManager::class.java) ?: return null
        val props = cm.getLinkProperties(cm.activeNetwork) ?: return null
        return props.linkAddresses.map { it.address }.firstOrNull { it is Inet4Address && !it.isLoopbackAddress }?.hostAddress
    }

    /** Asks every address of the device's /24 network, 32 at a time, for MommyTV Manager. Returns its playlist URL. */
    suspend fun findManager(context: Context): String? = coroutineScope {
        val ip = localIpv4(context) ?: return@coroutineScope null
        val prefix = ip.substringBeforeLast('.')
        val own = ip.substringAfterLast('.')
        val gate = Semaphore(32)
        val found = (1..254).filter { it.toString() != own }.map { n ->
            async(Dispatchers.IO) {
                gate.withPermit {
                    val host = "$prefix.$n"
                    val ok = runCatching { fetch("http://$host:$MANAGER_PORT/mommytv.json", 1500).contains("\"mommytv-manager\"") }.getOrDefault(false)
                    if (ok) "http://$host:$MANAGER_PORT/playlist.m3u" else null
                }
            }
        }.awaitAll()
        found.firstOrNull { it != null }
    }
}
