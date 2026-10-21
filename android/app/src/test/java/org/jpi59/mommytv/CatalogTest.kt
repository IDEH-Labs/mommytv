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

    private fun ch(name: String, url: String, country: String = "", cname: String = "", langs: String = "", cats: String = "", nsfw: String = "") =
        Channel(name = name, logo = "", group = "", url = url, country = country, countryName = cname, langs = langs, cats = cats, nsfw = nsfw)

    private val list = listOf(
        ch("Uno CO", "u1", "CO", "Colombia", "spa", "Noticias"),
        ch("Dos CO", "u2", "CO", "Colombia", "spa", "Películas"),
        ch("Three US", "u3", "US", "Estados Unidos", "eng", "Noticias;General"),
        ch("Adulto", "u4", "US", "Estados Unidos", "eng", "Adultos", nsfw = "1"),
        ch("App", "android-app://org.example"),
    )

    @Test fun buildsTheSameGroupsAsWebOs() {
        val c = Catalog(list, "CO", "spa", labels, MapStore())
        val names = c.groups.map { it.name }
        assertEquals(listOf("Buscar", "Favoritos", "Accesos directos", "Colombia", "En español", "Países", "Todos", "Noticias", "Películas", "General", "Ajustes"), names)
        assertEquals(4, c.channels.size) // adult channel never present
        assertEquals(listOf("Colombia", "Estados Unidos"), c.groups.first { it.kind == Kind.COUNTRIES }.countries.map { it.name })
        assertEquals(2, c.groups.first { it.name == "Noticias" }.items.size)
        assertEquals(c.groups.indexOfFirst { it.name == "Colombia" }, c.startGroup())
    }

    @Test fun startsOnTheSystemCountryOrEverything() {
        val noApps = list.filter { !it.url.startsWith("android-app://") }
        val home = Catalog(noApps, "CO", "spa", labels, MapStore())
        assertEquals("Colombia", home.groups[home.startGroup()].name)
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

    @Test fun parentalPinMatchesTheManagerFormat() {
        // the manager stores salt + ":" + sha256(salt + ":" + pin)
        val salt = "a1b2c3d4"
        val p = Parental(Header("$salt:" + Parental.sha256("$salt:1234"), listOf("Películas")))
        val movie = ch("Peli", "x", cats = "Películas")
        assertTrue(p.isLocked(movie))
        assertFalse(p.check("0000"))
        assertTrue(p.check("1234"))
        assertFalse(p.isLocked(movie))
        assertEquals("f1e5d9d95928deb5bb58568901760888c1135569494507d5e36938a058e6bf94", Parental.sha256("a1b2c3d4:1234"))
    }
}
