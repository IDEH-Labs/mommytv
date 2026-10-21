package org.jpi59.mommytv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogTest {
    private val labels = Labels("Buscar", "Favoritos", "Accesos directos", "En español", "Países", "Todos", "Ajustes", "Sin grupo")

    private class MapStore : Store {
        val m = HashMap<String, String>()
        override fun get(key: String) = m[key]
        override fun put(key: String, value: String) { m[key] = value }
    }

    private fun ch(name: String, url: String, country: String = "", langs: String = "", group: String = "") =
        Channel(name = name, logo = "", group = group, url = url, country = country, langs = langs)

    private val list = listOf(
        ch("Uno CO", "u1", "CO", "spa", "Noticias"),
        ch("Dos CO", "u2", "CO", "spa", "Películas"),
        ch("Three US", "u3", "US", "eng", "Noticias;General"),
        ch("Adulto", "u4", "US", "eng", "Adultos"),
        ch("App", "android-app://org.example"),
    )

    @Test fun buildsTheSameGroupsAsWebOs() {
        val c = Catalog(list, "CO", "spa", labels, MapStore())
        val names = c.groups.map { it.name }
        assertEquals(listOf("Buscar", "Favoritos", "Accesos directos", "CO", "En español", "Países", "Todos", "Noticias", "Películas", "General", "Adultos", "Ajustes"), names)
        assertEquals(5, c.channels.size) // channels are not silently hidden by manager-only attributes
        assertEquals(listOf("CO", "US"), c.groups.first { it.kind == Kind.COUNTRIES }.countries.map { it.name })
        assertEquals(2, c.groups.first { it.name == "Noticias" }.items.size)
        assertEquals(c.groups.indexOfFirst { it.name == "CO" }, c.startGroup())
    }

    @Test fun startsOnTheSystemCountryOrEverything() {
        val noApps = list.filter { !it.url.startsWith("android-app://") }
        val home = Catalog(noApps, "CO", "spa", labels, MapStore())
        assertEquals("CO", home.groups[home.startGroup()].name)
        val abroad = Catalog(noApps, "JP", "jpn", labels, MapStore())
        assertEquals("Todos", abroad.groups[abroad.startGroup()].name)
    }

    @Test fun favouritesAreOnlyWhatTheUserMarked() {
        val c = Catalog(list, "CO", "spa", labels, MapStore())
        c.refreshFavourites()
        assertTrue(c.favourites.items.isEmpty()) // watching alone never adds one
        assertTrue(c.toggleFavourite(c.channels[2]))
        assertTrue(c.toggleFavourite(c.channels[0]))
        assertEquals(listOf(0, 2), c.favourites.items) // newest first
        assertFalse(c.toggleFavourite(c.channels[2])) // unmarked
        assertEquals(listOf(0), c.favourites.items)
    }

    @Test fun searchIgnoresCaseAndAccents() {
        val c = Catalog(list, "CO", "spa", labels, MapStore())
        c.runSearch("UNO")
        assertEquals(listOf(0), c.search.items)
    }

    @Test fun parentalControlLivesOnTheDevice() {
        val store = MapStore()
        val movie = ch("Peli", "x", group = "Películas")
        val p = Parental(store)
        assertFalse(p.enabled)
        assertFalse(p.isLocked(movie))
        p.create("1234")
        p.toggle("Películas")
        assertFalse(store.m.getValue(Parental.KEY).contains("1234")) // only a salted hash is kept
        val again = Parental(store) // as after a restart
        assertTrue(again.isLocked(movie))
        assertFalse(again.check("0000"))
        assertTrue(again.check("1234"))
        assertFalse(again.isLocked(movie)) // unlocked for this session
        again.disable()
        assertFalse(Parental(store).enabled)
        assertEquals("f1e5d9d95928deb5bb58568901760888c1135569494507d5e36938a058e6bf94", Parental.sha256("a1b2c3d4:1234"))
    }
}
