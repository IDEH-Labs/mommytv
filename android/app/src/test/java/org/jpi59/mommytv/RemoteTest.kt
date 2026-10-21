package org.jpi59.mommytv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RemoteTest {
    @Test fun onlyAManagerPlaylistHasARemote() {
        assertEquals("http://192.168.1.9:8642", Remote.managerBase("http://192.168.1.9:8642/playlist.m3u"))
        assertNull(Remote.managerBase("https://example.org/list.m3u"))
        assertNull(Remote.managerBase("http://192.168.1.9:8642/playlist.m3u?x=1"))
        assertNull(Remote.managerBase(null))
    }
}
