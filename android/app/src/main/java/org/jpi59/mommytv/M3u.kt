package org.jpi59.mommytv

import java.text.Normalizer

/** One playlist entry. Same fields and rules as js/m3u.js on webOS. */
data class Channel(
    val name: String,
    val logo: String,
    val group: String,
    val url: String,
    val country: String = "",
    val langs: String = "",
) {
    /** "Canal (1080p) [Not 24/7]" -> "Canal"; also "(480i)" */
    val title: String = name.replace(Regex("\\s*\\(\\d{3,4}[pi]\\)"), "").replace(Regex("\\s*\\[[^\\]]*]"), "").trim().ifEmpty { name }
    val quality: String = Regex("\\((\\d{3,4})[pi]\\)").find(name)?.groupValues?.get(1)?.let { QUALITY[it] } ?: ""
    val key: String = normalize(title)
    /** Categories come from the standard group-title attribute, like on the TV. */
    val categories: List<String> get() = if (group.isEmpty()) listOf("") else group.split(';').filter { it.isNotEmpty() }
    val isShortcut: Boolean get() = url.startsWith(SHORTCUT)

    companion object {
        const val SHORTCUT = "android-app://"
        private val QUALITY = mapOf("2160" to "4K", "1440" to "QHD", "1080" to "FULL HD", "720" to "HD")
    }
}

fun normalize(s: String): String =
    Normalizer.normalize(s.lowercase(), Normalizer.Form.NFD).replace(Regex("\\p{Mn}+"), "")

object M3u {
    private val BOM = 0xFEFF.toChar().toString()

    /** Some generators write the JavaScript value `undefined` instead of omitting group-title. */
    private fun cleanGroup(value: String): String = value.split(';')
        .map { it.trim() }
        .filter { it.isNotEmpty() && !it.equals("undefined", ignoreCase = true) }
        .joinToString(";")

    private fun attr(line: String, name: String): String =
        Regex("\\s" + Regex.escape(name) + "=\"([^\"]*)\"", RegexOption.IGNORE_CASE).find(line)?.groupValues?.get(1)?.trim() ?: ""

    /**
     * iptv-org channel ids are "name.country@feed" (country = ISO 3166-1 alpha-2): "CaracolTV.co@SD" → "CO".
     * Used only when the playlist gives no tvg-country.
     */
    private fun countryOfId(id: String): String =
        Regex("\\.([a-z]{2})(?:@[^.]*)?$", RegexOption.IGNORE_CASE).find(id)?.groupValues?.get(1)?.uppercase().orEmpty()

    /** The title follows the first comma outside quoted attribute values. */
    private fun titleOf(line: String): String {
        var quoted = false
        for (i in line.indices) {
            val c = line[i]
            if (c == '"') quoted = !quoted
            else if (c == ',' && !quoted) return line.substring(i + 1).trim()
        }
        return ""
    }

    fun parse(text: String): List<Channel> {
        val out = ArrayList<Channel>()
        var info: String? = null
        var group = ""
        for (raw in text.removePrefix(BOM).lineSequence()) {
            val line = raw.trim()
            if (line.isEmpty()) continue
            when {
                line.startsWith("#EXTINF") -> info = line
                line.startsWith("#EXTGRP:") -> group = line.substring(8).trim()
                line.startsWith("#") -> Unit
                else -> {
                    val i = info
                    val name = i?.let { titleOf(it).ifEmpty { attr(it, "tvg-name") } }.orEmpty().ifEmpty { line }
                    out += Channel(
                        name = name,
                        logo = i?.let { attr(it, "tvg-logo") }.orEmpty(),
                        group = cleanGroup(i?.let { attr(it, "group-title") }.orEmpty()).ifEmpty { cleanGroup(group) },
                        url = line,
                        country = i?.let { attr(it, "tvg-country").ifEmpty { countryOfId(attr(it, "tvg-id")) } }.orEmpty(),
                        langs = i?.let { attr(it, "tvg-language") }.orEmpty(),
                    )
                    info = null
                    group = ""
                }
            }
        }
        return out
    }

}
