package org.jpi59.mommytv

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL

/** Channel logos: downloaded once, scaled down to the size shown, last 200 kept in memory. */
object Logos {
    private const val MAX_SIDE = 256
    private val cache = LruCache<String, Bitmap>(200)
    private val failed: MutableSet<String> = java.util.Collections.synchronizedSet(HashSet())

    suspend fun load(url: String): Bitmap? {
        cache.get(url)?.let { return it }
        if (url in failed || !(url.startsWith("http://") || url.startsWith("https://"))) return null
        return withContext(Dispatchers.IO) {
            runCatching {
                val c = URL(url).openConnection() as HttpURLConnection
                c.connectTimeout = 8000
                c.readTimeout = 8000
                val bytes = c.inputStream.use { it.readBytes() }
                c.disconnect()
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                var sample = 1
                while (bounds.outWidth / (sample * 2) >= MAX_SIDE || bounds.outHeight / (sample * 2) >= MAX_SIDE) sample *= 2
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
            }.getOrNull().also { if (it != null) cache.put(url, it) else failed += url }
        }
    }
}

@Composable
fun rememberLogo(url: String): ImageBitmap? {
    var image by remember(url) { mutableStateOf<ImageBitmap?>(null) }
    LaunchedEffect(url) { if (url.isNotEmpty()) image = Logos.load(url)?.asImageBitmap() }
    return image
}
