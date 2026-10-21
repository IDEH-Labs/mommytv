package org.jpi59.mommytv

import java.io.Closeable
import java.io.EOFException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.Base64
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.X509TrustManager

/**
 * The little of WebSocket (RFC 6455) the TV link needs: one text conversation over TLS on the LAN.
 * Client frames are masked, server frames are not; pings are answered, a close ends the talk.
 * [fingerprint] is the SHA-256 of the TV's certificate, pinned at pairing.
 */
class Ws private constructor(private val socket: Socket, private val input: InputStream, private val output: OutputStream, val fingerprint: String) : Closeable {

    class Closed : Exception("closed")

    fun send(text: String) = synchronized(output) { output.write(frame(OP_TEXT, text.toByteArray(Charsets.UTF_8), mask())); output.flush() }

    /** The next text message; waits up to the socket timeout. */
    fun receive(): String {
        while (true) {
            val (op, payload) = readFrame(input)
            when (op) {
                OP_TEXT -> return payload.toString(Charsets.UTF_8)
                OP_PING -> synchronized(output) { output.write(frame(OP_PONG, payload, mask())); output.flush() }
                OP_CLOSE -> throw Closed()
            }
        }
    }

    fun timeout(ms: Int) { socket.soTimeout = ms }

    override fun close() { runCatching { socket.close() } }

    /**
     * LG TVs present a certificate signed by themselves, so no authority can vouch for it. Pairing
     * accepts only a valid, self-signed LG certificate and remembers it; afterwards only that exact
     * certificate is accepted ([pin]), so nobody else on the network can pose as the TV.
     */
    class TvTrust(private val pin: String?) : X509TrustManager {
        override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
            val cert = chain?.firstOrNull() ?: throw CertificateException("no certificate")
            if (pin != null) {
                if (!MessageDigest.isEqual(fingerprint(cert).toByteArray(), pin.toByteArray())) throw CertificateException("not the paired TV")
                return
            }
            cert.checkValidity()
            if (cert.subjectX500Principal != cert.issuerX500Principal || !cert.subjectX500Principal.name.contains("O=LG Electronics")) throw CertificateException("not an LG TV")
            cert.verify(cert.publicKey) // its own signature
        }
        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) = throw CertificateException("server only")
        override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
    }

    companion object {
        const val OP_TEXT = 1
        const val OP_CLOSE = 8
        const val OP_PING = 9
        const val OP_PONG = 10
        private val random = SecureRandom()

        fun fingerprint(cert: X509Certificate): String =
            MessageDigest.getInstance("SHA-256").digest(cert.encoded).joinToString("") { "%02x".format(it) }

        /** Connects over TLS; [pin] is the paired TV's certificate fingerprint, null only while pairing. */
        fun connect(host: String, port: Int, pin: String?, timeoutMs: Int = 5000): Ws {
            val tls = SSLContext.getInstance("TLS").apply { init(null, arrayOf(TvTrust(pin)), random) }
            val socket = tls.socketFactory.createSocket() as SSLSocket
            try {
                socket.connect(InetSocketAddress(host, port), timeoutMs)
                socket.soTimeout = timeoutMs
                socket.startHandshake()
                val seen = fingerprint(socket.session.peerCertificates[0] as X509Certificate)
                val key = Base64.getEncoder().encodeToString(ByteArray(16).also { random.nextBytes(it) })
                val out = socket.getOutputStream()
                out.write(("GET / HTTP/1.1\r\nHost: $host:$port\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
                    "Sec-WebSocket-Key: $key\r\nSec-WebSocket-Version: 13\r\n\r\n").toByteArray(Charsets.US_ASCII))
                out.flush()
                val input = socket.getInputStream()
                val head = readHead(input)
                if (!head.startsWith("HTTP/1.1 101")) throw IllegalStateException(head.lineSequence().first())
                return Ws(socket, input, out, seen)
            } catch (e: Exception) {
                socket.close()
                throw e
            }
        }

        private fun mask() = ByteArray(4).also { random.nextBytes(it) }

        private fun readHead(input: InputStream): String {
            val b = StringBuilder()
            while (!b.endsWith("\r\n\r\n")) {
                val c = input.read()
                if (c < 0) throw EOFException()
                b.append(c.toChar())
                if (b.length > 8192) throw IllegalStateException("handshake too long")
            }
            return b.toString()
        }

        /** One final frame; [mask] is null for a server-side frame (tests). */
        fun frame(op: Int, payload: ByteArray, mask: ByteArray?): ByteArray {
            val out = java.io.ByteArrayOutputStream()
            out.write(0x80 or op)
            val m = if (mask != null) 0x80 else 0
            when {
                payload.size < 126 -> out.write(m or payload.size)
                payload.size < 65536 -> { out.write(m or 126); out.write(payload.size shr 8); out.write(payload.size and 0xff) }
                else -> { out.write(m or 127); for (i in 7 downTo 0) out.write(((payload.size.toLong() shr (8 * i)) and 0xff).toInt()) }
            }
            if (mask == null) { out.write(payload); return out.toByteArray() }
            out.write(mask)
            out.write(ByteArray(payload.size) { (payload[it].toInt() xor mask[it % 4].toInt()).toByte() })
            return out.toByteArray()
        }

        /** Reads one whole message (continuation frames joined), unmasking if needed. */
        fun readFrame(input: InputStream): kotlin.Pair<Int, ByteArray> {
            val body = java.io.ByteArrayOutputStream()
            var op = -1
            while (true) {
                val b0 = readByte(input)
                val b1 = readByte(input)
                (b0 and 0x0f).let { if (it != 0) op = it } // 0: continuation of the same message
                var len = (b1 and 0x7f).toLong()
                if (len == 126L) len = ((readByte(input) shl 8) or readByte(input)).toLong()
                else if (len == 127L) { len = 0; repeat(8) { len = (len shl 8) or readByte(input).toLong() } }
                if (len > 8L * 1024 * 1024) throw IllegalStateException("message too large")
                val key = if (b1 and 0x80 != 0) ByteArray(4) { readByte(input).toByte() } else null
                val data = ByteArray(len.toInt())
                var read = 0
                while (read < data.size) { val n = input.read(data, read, data.size - read); if (n < 0) throw EOFException(); read += n }
                if (key != null) for (i in data.indices) data[i] = (data[i].toInt() xor key[i % 4].toInt()).toByte()
                body.write(data)
                if (b0 and 0x80 != 0) return op to body.toByteArray()
            }
        }

        private fun readByte(input: InputStream): Int = input.read().also { if (it < 0) throw EOFException() }
    }
}
