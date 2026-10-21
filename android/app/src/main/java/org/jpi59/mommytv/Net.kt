package org.jpi59.mommytv

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL

object Net {
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
}
