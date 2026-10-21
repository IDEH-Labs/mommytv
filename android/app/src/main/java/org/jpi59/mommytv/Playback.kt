package org.jpi59.mommytv

import android.content.Context
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.upstream.DefaultBandwidthMeter

/**
 * Media3 player tuned like the webOS app, from what was measured on a real TV over Wi-Fi:
 * start at the top quality (high initial bandwidth estimate; the player still steps down if needed),
 * play live streams 8 s behind the edge so the buffer absorbs network hiccups, and reconnect quietly.
 */
@OptIn(UnstableApi::class)
class Playback(context: Context, private val listener: Listener) {
    interface Listener {
        fun onBuffering(buffering: Boolean)
        fun onPlaying()
        fun onReconnecting()
        fun onFailed()
    }

    val player: ExoPlayer = ExoPlayer.Builder(context)
        .setBandwidthMeter(DefaultBandwidthMeter.Builder(context).setInitialBitrateEstimate(50_000_000L).build())
        .setLoadControl(DefaultLoadControl.Builder().setBufferDurationsMs(15_000, 50_000, 1_500, 3_000).build())
        .build()

    private var url: String? = null
    private var retries = 0

    init {
        player.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                listener.onBuffering(state == Player.STATE_BUFFERING)
                if (state == Player.STATE_READY && player.playWhenReady) { retries = 0; listener.onPlaying() }
            }

            override fun onPlayerError(error: PlaybackException) {
                if (error.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
                    player.seekToDefaultPosition() // fell behind: back to the sweet spot
                    player.prepare()
                    return
                }
                if (retries < RETRIES) { retries++; listener.onReconnecting(); start() } else listener.onFailed()
            }
        })
    }

    fun play(streamUrl: String) {
        url = streamUrl
        retries = 0
        start()
    }

    private fun start() {
        val u = url ?: return
        val item = MediaItem.Builder()
            .setUri(u)
            .setLiveConfiguration(MediaItem.LiveConfiguration.Builder().setTargetOffsetMs(LIVE_TARGET_MS).build())
            .build()
        player.setMediaItem(item)
        player.prepare()
        player.playWhenReady = true
    }

    fun stop() {
        url = null
        player.stop()
        player.clearMediaItems()
    }

    fun release() = player.release()

    val isPlaying get() = player.isPlaying
    val videoSize get() = player.videoSize

    companion object {
        const val RETRIES = 3
        const val LIVE_TARGET_MS = 8_000L
    }
}
