package org.jpi59.mommytv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LgTvTest {
    @Test fun readsTheTvNameFromItsAnswer() {
        val answer = "HTTP/1.1 200 OK\r\nST: urn:lge-com:service:webos-second-screen:1\r\nDLNADeviceName.lge.com: %5BLG%5D%20webOS%20TV%20LM6300PDB\r\n\r\n"
        assertEquals("[LG] webOS TV LM6300PDB", LgTv.deviceName(answer))
        assertNull(LgTv.deviceName("HTTP/1.1 200 OK\r\nST: x\r\n\r\n"))
    }

    @Test fun readsTheTvNameFromItsDescription() {
        assertEquals("TV de la sala & co", LgTv.nameInDescription("<root><device><friendlyName> TV de la sala &amp; co </friendlyName></device></root>"))
        assertNull(LgTv.nameInDescription("<root/>"))
    }
}
