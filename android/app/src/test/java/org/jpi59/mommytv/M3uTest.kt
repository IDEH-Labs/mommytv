package org.jpi59.mommytv

import org.junit.Assert.assertEquals
import org.junit.Test

class M3uTest {
    private val sample = "\uFEFF#EXTM3U mommytv-pin=\"ab:cd\" mommytv-locked=\"Películas;Series\"\r\n" +
        "#EXTINF:-1 tvg-id=\"a\" tvg-logo=\"http://l/a.png\" group-title=\"News, World\" tvg-country=\"CO\" mommytv-country-name=\"Colombia\" tvg-language=\"spa\" mommytv-cats=\"Noticias;General\",Channel A (1080p) [Not 24/7]\r\n" +
        "http://s/a.m3u8\r\n\r\n" +
        "#EXTINF:-1 tvg-name=\"Only Attr\",\n#EXTVLCOPT:http-user-agent=Foo\nhttp://s/b.m3u8\n" +
        "#EXTINF:0,Channel C\n#EXTGRP:Sports\nhttp://s/c.ts\n" +
        "http://s/bare.m3u8\n"

    @Test fun parsesLikeTheWebOsParser() {
        val ch = M3u.parse(sample)
        assertEquals(4, ch.size)
        assertEquals("Channel A (1080p) [Not 24/7]", ch[0].name)
        assertEquals("Channel A", ch[0].title)
        assertEquals("FULL HD", ch[0].quality)
        assertEquals("News, World", ch[0].group)
        assertEquals("CO", ch[0].country)
        assertEquals("Colombia", ch[0].countryName)
        assertEquals("spa", ch[0].langs)
        assertEquals(listOf("Noticias", "General"), ch[0].categories)
        assertEquals("Only Attr", ch[1].name)
        assertEquals("Sports", ch[2].group)
        assertEquals("http://s/bare.m3u8", ch[3].name)
        assertEquals(listOf(""), ch[3].categories)
    }

    @Test fun readsParentalHeader() {
        val h = M3u.header(sample)
        assertEquals("ab:cd", h.pin)
        assertEquals(listOf("Películas", "Series"), h.locked)
        assertEquals(Header("", emptyList()), M3u.header("#EXTINF:-1,x\nhttp://a"))
    }

    @Test fun normalizesForSearch() {
        assertEquals("noticias espana", normalize("Noticias España"))
        assertEquals("cafe", normalize("CAFÉ"))
    }
}
