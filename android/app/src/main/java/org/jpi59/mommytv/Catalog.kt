package org.jpi59.mommytv

import java.security.MessageDigest

enum class Kind { CHANGE, SEARCH, FAV, APPS, LIST, COUNTRIES, ABOUT }

class Country(val code: String, val name: String, val items: MutableList<Int> = ArrayList())

class Group(val kind: Kind, val name: String, var items: MutableList<Int> = ArrayList()) {
    var countries: List<Country> = emptyList()
    var country: Country? = null // open country inside "Countries"
    var query: String = ""
}

/** Texts the catalog needs, so it can be tested without Android resources. */
data class Labels(
    val change: String, val search: String, val favs: String, val shortcuts: String,
    val inLang: String, val countries: String, val all: String, val about: String, val noGroup: String,
)

/** Small key-value storage (SharedPreferences on the device, a map in tests). */
interface Store {
    fun get(key: String): String?
    fun put(key: String, value: String)
}

/**
 * The same organisation as the webOS app: Search, Favourites, shortcuts, the device's country,
 * channels in the device language, Countries, All and the categories. Adult channels never appear.
 */
class Catalog(all: List<Channel>, region: String, langIso3: String, val labels: Labels, private val store: Store) {
    val channels: List<Channel> = all.filter { it.nsfw != "1" }
    val groups: List<Group>
    private var homeGroup: Group? = null // channels of the system's country
    private val byUrl: Map<String, Int>

    init {
        byUrl = HashMap<String, Int>().also { m -> channels.forEachIndexed { i, c -> m.putIfAbsent(c.url, i) } }
        val shortcuts = Group(Kind.APPS, labels.shortcuts)
        val everything = Group(Kind.LIST, labels.all)
        var homeName = ""
        val home = ArrayList<Int>()
        val inLang = Group(Kind.LIST, labels.inLang)
        val cats = LinkedHashMap<String, Group>()
        val countries = LinkedHashMap<String, Country>()
        channels.forEachIndexed { i, ch ->
            if (ch.isShortcut) { shortcuts.items += i; return@forEachIndexed }
            everything.items += i
            for (c in ch.categories) {
                val name = c.ifEmpty { labels.noGroup }
                cats.getOrPut(name) { Group(Kind.LIST, name) }.items += i
            }
            if (ch.country.isNotEmpty()) {
                countries.getOrPut(ch.country) { Country(ch.country, ch.countryName.ifEmpty { ch.country }) }.items += i
                if (ch.country.equals(region, ignoreCase = true)) { home += i; homeName = ch.countryName.ifEmpty { region } }
            }
            if (";${ch.langs};".contains(";$langIso3;")) inLang.items += i
        }
        val list = ArrayList<Group>()
        list += Group(Kind.CHANGE, labels.change)
        list += Group(Kind.SEARCH, labels.search)
        list += Group(Kind.FAV, labels.favs)
        if (shortcuts.items.isNotEmpty()) list += shortcuts
        if (home.isNotEmpty()) list += Group(Kind.LIST, homeName, home).also { homeGroup = it }
        if (inLang.items.isNotEmpty()) list += inLang
        if (countries.size > 1) list += Group(Kind.COUNTRIES, labels.countries).also { g ->
            g.countries = countries.values.sortedWith(compareBy(java.text.Collator.getInstance()) { it.name })
        }
        if (everything.items.isNotEmpty()) list += everything
        if (cats.size > 1) list += cats.values.sortedByDescending { it.items.size }
        list += Group(Kind.ABOUT, labels.about)
        groups = list
        refreshFavourites()
    }

    val favourites: Group get() = groups.first { it.kind == Kind.FAV }
    val search: Group get() = groups.first { it.kind == Kind.SEARCH }

    fun startGroup(): Int {
        if (favourites.items.isNotEmpty()) return groups.indexOf(favourites)
        homeGroup?.let { return groups.indexOf(it) }
        return groups.indexOfFirst { it.name == labels.all }.coerceAtLeast(0)
    }

    // ---------- favourites: pinned first, then the most watched; removing one is permanent ----------

    private fun list(key: String): MutableList<String> = store.get(key)?.split('\n')?.filter { it.isNotEmpty() }?.toMutableList() ?: ArrayList()
    private fun save(key: String, v: List<String>) = store.put(key, v.joinToString("\n"))
    private fun watch(): MutableMap<String, Long> = list(WATCH).mapNotNull { l ->
        val sp = l.lastIndexOf(' ')
        if (sp < 0) null else l.substring(0, sp) to (l.substring(sp + 1).toLongOrNull() ?: 0L)
    }.toMap().toMutableMap()

    fun isPinned(ch: Channel) = list(PINS).contains(ch.url)

    fun refreshFavourites() {
        val pins = list(PINS)
        val hidden = list(HIDDEN).toSet()
        val items = ArrayList<Int>()
        val seen = HashSet<String>()
        for (u in pins) { val i = byUrl[u] ?: continue; if (seen.add(u) && items.size < FAV_MAX) items += i }
        watch().entries.filter { it.value >= 60 && it.key !in seen && it.key !in hidden && byUrl.containsKey(it.key) }
            .sortedByDescending { it.value }.forEach { if (items.size < FAV_MAX) items += byUrl.getValue(it.key) }
        favourites.items = items
    }

    /** One action for the user: in Favourites (pinned or most watched) -> out for good; otherwise pinned. Returns true if added. */
    fun toggleFavourite(ch: Channel): Boolean {
        refreshFavourites()
        val removing = favourites.items.any { channels[it].url == ch.url }
        val pins = list(PINS).apply { remove(ch.url) }
        val hidden = list(HIDDEN).apply { remove(ch.url) }
        if (removing) hidden.add(0, ch.url) else pins.add(0, ch.url)
        save(PINS, pins.take(200))
        save(HIDDEN, hidden.take(300))
        refreshFavourites()
        return !removing
    }

    fun addWatched(url: String, seconds: Long) {
        val w = watch()
        w[url] = (w[url] ?: 0L) + seconds
        save(WATCH, w.entries.sortedByDescending { it.value }.take(300).map { it.key + " " + it.value })
    }

    fun runSearch(query: String) {
        val q = normalize(query.trim())
        search.query = query
        search.items = if (q.isEmpty()) ArrayList() else channels.indices.filter { channels[it].key.contains(q) }.take(SEARCH_MAX).toMutableList()
    }

    fun indexOfUrl(url: String): Int? = byUrl[url]

    companion object {
        const val PINS = "pins"
        const val HIDDEN = "hidden"
        const val WATCH = "watch"
        const val FAV_MAX = 30
        const val SEARCH_MAX = 300
    }
}

/** Parental control from the playlist header: salted SHA-256 of a 4-digit PIN, same as MommyTV Manager. */
class Parental(header: Header) {
    private val salt = header.pin.substringBefore(':', "")
    private val hash = header.pin.substringAfter(':', "")
    private val locked = header.locked.toSet()
    var unlocked = false
    val enabled get() = hash.isNotEmpty()

    fun isLocked(ch: Channel) = enabled && !unlocked && ch.categories.any { it in locked }
    fun isLockedGroup(name: String) = enabled && !unlocked && name in locked
    fun check(pin: String): Boolean = (sha256("$salt:$pin") == hash).also { if (it) unlocked = true }

    companion object {
        fun sha256(s: String): String = MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }
    }
}
