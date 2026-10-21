package org.jpi59.mommytv

import org.junit.Assert.assertEquals
import org.junit.Test

class M3uTest {
    private val sample = "\uFEFF#EXTM3U\r\n" +
        "#EXTINF:-1 tvg-id=\"a\" tvg-logo=\"http://l/a.png\" group-title=\"Noticias;General\" tvg-country=\"CO\" tvg-language=\"spa\" mommytv-cats=\"Ignored\" mommytv-nsfw=\"1\",Channel A (1080p) [Not 24/7]\r\n" +
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
        assertEquals("Noticias;General", ch[0].group)
        assertEquals("CO", ch[0].country)
        assertEquals("spa", ch[0].langs)
        assertEquals(listOf("Noticias", "General"), ch[0].categories)
        assertEquals("Only Attr", ch[1].name)
        assertEquals("Sports", ch[2].group)
        assertEquals("http://s/bare.m3u8", ch[3].name)
        assertEquals(listOf(""), ch[3].categories)
    }

    @Test fun interlacedResolutionLeavesTheName() {
        val ch = Channel(name = "TV Fronteira (480i)", logo = "", group = "", url = "u")
        assertEquals("TV Fronteira", ch.title)
        assertEquals("", ch.quality) // below HD: no badge
    }

    @Test fun treatsGeneratorUndefinedCategoryAsNoCategory() {
        val ch = M3u.parse("#EXTINF:-1 group-title=\"Undefined\",Channel\nhttps://stream.example/channel.m3u8").single()
        assertEquals("", ch.group)
        assertEquals(listOf(""), ch.categories)
    }

    @Test fun normalizesForSearch() {
        assertEquals("noticias espana", normalize("Noticias España"))
        assertEquals("cafe", normalize("CAFÉ"))
    }
}
