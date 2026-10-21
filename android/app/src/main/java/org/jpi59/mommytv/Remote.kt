package org.jpi59.mommytv

import org.json.JSONObject

/**
 * Phone remote through MommyTV Manager: the phone types the code the TV shows and gets its own
 * token; with it, it reads what the TV is playing. Nothing runs in the background.
 */
object Remote {
    sealed interface Paired { data class Ok(val token: String) : Paired; data object Wrong : Paired; data object Locked : Paired; data object Unreachable : Paired }
    sealed interface Sent { data class Ok(val tvListening: Boolean) : Sent; data object Unpaired : Sent; data object Unreachable : Sent }
    sealed interface Now { data class Tv(val view: String, val title: String) : Now; data object Idle : Now; data object Unpaired : Now; data object Unreachable : Now }

    /** MommyTV Manager's playlist, over HTTP or (on the next port) HTTPS. */
    private val MANAGER_LIST = Regex("^(https?://[^/:]+:(?:${Net.MANAGER_PORT}|${Net.MANAGER_PORT + 1}))/playlist\\.m3u$")

    fun isManagerList(url: String) = MANAGER_LIST.matches(url)

    /** MommyTV Manager's address when the playlist comes from it, else null. */
    fun managerBase(playlistUrl: String?): String? = MANAGER_LIST.find(playlistUrl ?: "")?.groupValues?.get(1)

    suspend fun pair(base: String, code: String, name: String): Paired {
        val (status, body) = runCatching { Net.post("$base/remote/pair", JSONObject().put("code", code).put("name", name).toString()) }
            .getOrElse { return Paired.Unreachable }
        return when {
            status == 200 -> runCatching { Paired.Ok(JSONObject(body).getString("token")) }.getOrDefault(Paired.Unreachable)
            status == 429 -> Paired.Locked
            status == 403 -> Paired.Wrong
            else -> Paired.Unreachable
        }
    }

    /** Asks the TV to play a channel of its list; the TV itself checks that it is one. */
    suspend fun play(base: String, token: String, url: String): Sent {
        val (status, body) = runCatching { Net.post("$base/remote/play", JSONObject().put("token", token).put("url", url).toString(), 6000) }
            .getOrElse { return Sent.Unreachable }
        return when (status) {
            200 -> Sent.Ok(runCatching { JSONObject(body).getBoolean("listening") }.getOrDefault(false))
            403 -> Sent.Unpaired
            else -> Sent.Unreachable
        }
    }

    suspend fun now(base: String, token: String): Now {
        val (status, body) = runCatching { Net.post("$base/remote/now", JSONObject().put("token", token).toString(), 6000) }
            .getOrElse { return Now.Unreachable }
        if (status == 403) return Now.Unpaired
        if (status != 200) return Now.Unreachable
        val s = runCatching { JSONObject(body).optJSONObject("state") }.getOrNull() ?: return Now.Idle
        val title = s.optString("title")
        return if (s.optString("view") == "player" && title.isNotEmpty()) Now.Tv("player", title) else Now.Idle
    }
}
