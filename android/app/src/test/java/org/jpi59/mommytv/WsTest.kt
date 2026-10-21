package org.jpi59.mommytv

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.ByteArrayInputStream

class WsTest {
    @Test fun maskedFramesRoundTrip() {
        for (size in listOf(0, 5, 125, 126, 300, 70_000)) {
            val text = "x".repeat(size)
            val (op, payload) = Ws.readFrame(ByteArrayInputStream(Ws.frame(Ws.OP_TEXT, text.toByteArray(), byteArrayOf(1, 2, 3, 4))))
            assertEquals(Ws.OP_TEXT, op)
            assertEquals(text, payload.toString(Charsets.UTF_8))
        }
    }

    @Test fun clientFramesAreMasked() {
        val f = Ws.frame(Ws.OP_TEXT, "hi".toByteArray(), byteArrayOf(9, 9, 9, 9))
        assertEquals(0x81, f[0].toInt() and 0xff)
        assertEquals(0x80 or 2, f[1].toInt() and 0xff)
        assertArrayEquals(byteArrayOf(('h'.code xor 9).toByte(), ('i'.code xor 9).toByte()), f.copyOfRange(6, 8))
    }

    @Test fun joinsContinuationFrames() {
        val first = Ws.frame(Ws.OP_TEXT, "hel".toByteArray(), null).also { it[0] = (it[0].toInt() and 0x7f).toByte() } // not final
        val rest = Ws.frame(0, "lo".toByteArray(), null)
        val (op, payload) = Ws.readFrame(ByteArrayInputStream(first + rest))
        assertEquals(Ws.OP_TEXT, op)
        assertEquals("hello", payload.toString(Charsets.UTF_8))
    }

    private fun cert(name: String) = java.security.cert.CertificateFactory.getInstance("X.509")
        .generateCertificate(javaClass.classLoader!!.getResourceAsStream(name)) as java.security.cert.X509Certificate

    @Test fun pairingAcceptsOnlyAValidSelfSignedLgCertificate() {
        Ws.TvTrust(null).checkServerTrusted(arrayOf(cert("lg-tv-test.pem")), "RSA")
        assertThrows(java.security.cert.CertificateException::class.java) { Ws.TvTrust(null).checkServerTrusted(arrayOf(cert("other-test.pem")), "RSA") }
        assertThrows(java.security.cert.CertificateException::class.java) { Ws.TvTrust(null).checkServerTrusted(emptyArray(), "RSA") }
    }

    @Test fun afterPairingOnlyThePinnedCertificateIsAccepted() {
        val tv = cert("lg-tv-test.pem")
        Ws.TvTrust(Ws.fingerprint(tv)).checkServerTrusted(arrayOf(tv), "RSA")
        assertThrows(java.security.cert.CertificateException::class.java) { Ws.TvTrust(Ws.fingerprint(cert("other-test.pem"))).checkServerTrusted(arrayOf(tv), "RSA") }
    }
}
