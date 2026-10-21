package org.jpi59.mommytv

import java.text.Normalizer

/** One playlist entry. Same fields and rules as js/m3u.js on webOS. */
data class Channel(
    val name: String,
    val logo: String,
    val group: String,
    val url: String,
    val cert: String = "",
    val country: String = "",
    val countryName: String = "",
    val langs: String = "",
    val cats: String = "",
    val nsfw: String = "",
) {
    /** "Canal (1080p) [Not 24/7]" -> "Canal"; also "(480i)" */
    val title: String = name.replace(Regex("\\s*\\(\\d{3,4}[pi]\\)"), "").replace(Regex("\\s*\\[[^\\]]*]"), "").trim().ifEmpty { name }
    val quality: String = Regex("\\((\\d{3,4})[pi]\\)").find(name)?.groupValues?.get(1)?.let { QUALITY[it] } ?: ""
    val key: String = normalize(title)
    val categories: List<String> get() = if (cats.isNotEmpty()) cats.split(';').filter { it.isNotEmpty() } else listOf(group)
    val isShortcut: Boolean get() = url.startsWith(SHORTCUT)

    companion object {
        const val SHORTCUT = "android-app://"
        private val QUALITY = mapOf("2160" to "4K", "1440" to "QHD", "1080" to "FULL HD", "720" to "HD")
    }
}

/** Attributes of the "#EXTM3U ..." line written by MommyTV Manager (parental control). */
data class Header(val pin: String, val locked: List<String>)

fun normalize(s: String): String =
    Normalizer.normalize(s.lowercase(), Normalizer.Form.NFD).replace(Regex("\\p{Mn}+"), "")

object M3u {
    private val BOM = 0xFEFF.toChar().toString()

    private fun attr(line: String, name: String): String =
        Regex("\\s" + Regex.escape(name) + "=\"([^\"]*)\"", RegexOption.IGNORE_CASE).find(line)?.groupValues?.get(1)?.trim() ?: ""

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
                        group = i?.let { attr(it, "group-title") }.orEmpty().ifEmpty { group },
                        url = line,
                        cert = i?.let { attr(it, "mommytv-cert") }.orEmpty(),
                        country = i?.let { attr(it, "tvg-country") }.orEmpty(),
                        countryName = i?.let { attr(it, "mommytv-country-name") }.orEmpty(),
                        langs = i?.let { attr(it, "tvg-language") }.orEmpty(),
                        cats = i?.let { attr(it, "mommytv-cats") }.orEmpty(),
                        nsfw = i?.let { attr(it, "mommytv-nsfw") }.orEmpty(),
                    )
                    info = null
                    group = ""
                }
            }
        }
        return out
    }

    fun header(text: String): Header {
        val first = text.removePrefix(BOM).lineSequence().firstOrNull().orEmpty()
        if (!first.startsWith("#EXTM3U")) return Header("", emptyList())
        return Header(attr(first, "mommytv-pin"), attr(first, "mommytv-locked").split(';').filter { it.isNotEmpty() })
    }
}
