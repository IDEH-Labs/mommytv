package org.jpi59.mommytv

import java.security.MessageDigest

enum class Kind { SEARCH, FAV, APPS, LIST, COUNTRIES, SETTINGS }

class Country(val code: String, val name: String, val items: MutableList<Int> = ArrayList())

class Group(val kind: Kind, val name: String, var items: MutableList<Int> = ArrayList()) {
    var countries: List<Country> = emptyList()
    var country: Country? = null // open country inside "Countries"
    var query: String = ""
}

/** Texts the catalog needs, so it can be tested without Android resources. */
data class Labels(
    val search: String, val favs: String, val shortcuts: String,
    val inLang: String, val countries: String, val all: String, val settings: String, val noGroup: String,
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
    var categories: List<String> = emptyList() // for choosing which ones parental control locks
        private set
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
        list += Group(Kind.SEARCH, labels.search)
        list += Group(Kind.FAV, labels.favs)
        if (shortcuts.items.isNotEmpty()) list += shortcuts
        if (home.isNotEmpty()) list += Group(Kind.LIST, homeName, home).also { homeGroup = it }
        if (inLang.items.isNotEmpty()) list += inLang
        if (countries.size > 1) list += Group(Kind.COUNTRIES, labels.countries).also { g ->
            g.countries = countries.values.sortedWith(compareBy(java.text.Collator.getInstance()) { it.name })
        }
        if (everything.items.isNotEmpty()) list += everything
        val byCategory = cats.values.sortedByDescending { it.items.size }
        categories = byCategory.map { it.name }
        if (cats.size > 1) list += byCategory
        list += Group(Kind.SETTINGS, labels.settings)
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

    // ---------- favourites: only the channels the user marked, newest first ----------

    private fun list(key: String): MutableList<String> = store.get(key)?.split('\n')?.filter { it.isNotEmpty() }?.toMutableList() ?: ArrayList()
    private fun save(key: String, v: List<String>) = store.put(key, v.joinToString("\n"))

    fun isPinned(ch: Channel) = list(PINS).contains(ch.url)

    fun refreshFavourites() {
        val seen = HashSet<String>()
        favourites.items = list(PINS).mapNotNull { u -> byUrl[u]?.takeIf { seen.add(u) } }.toMutableList()
    }

    /** Marks a channel as favourite, or unmarks it. Returns true if added. */
    fun toggleFavourite(ch: Channel): Boolean {
        val pins = list(PINS)
        val adding = !pins.remove(ch.url)
        if (adding) pins.add(0, ch.url)
        save(PINS, pins.take(200))
        refreshFavourites()
        return adding
    }

    fun runSearch(query: String) {
        val q = normalize(query.trim())
        search.query = query
        search.items = if (q.isEmpty()) ArrayList() else channels.indices.filter { channels[it].key.contains(q) }.take(SEARCH_MAX).toMutableList()
    }

    fun indexOfUrl(url: String): Int? = byUrl[url]

    companion object {
        const val PINS = "pins"
        const val SEARCH_MAX = 300
    }
}

/** Parental control kept on the device: a 4-digit PIN stored only as a salted SHA-256, and the locked categories. */
class Parental(private val store: Store) {
    private var salt = ""
    private var hash = ""
    private val locked = LinkedHashSet<String>()
    var unlocked = false

    init {
        val lines = store.get(KEY)?.split('\n').orEmpty()
        lines.firstOrNull()?.let { salt = it.substringBefore(':', ""); hash = it.substringAfter(':', "") }
        locked += lines.drop(1).filter { it.isNotEmpty() }
    }

    val enabled get() = hash.isNotEmpty()

    fun isLocked(ch: Channel) = enabled && !unlocked && ch.categories.any { it in locked }
    fun isLockedGroup(name: String) = enabled && !unlocked && name in locked
    fun locks(category: String) = category in locked
    fun check(pin: String): Boolean = (enabled && sha256("$salt:$pin") == hash).also { if (it) unlocked = true }

    fun create(pin: String) {
        salt = ByteArray(8).also { java.security.SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
        hash = sha256("$salt:$pin")
        save()
    }

    fun toggle(category: String) { if (!locked.remove(category)) locked += category; save() }

    fun disable() { salt = ""; hash = ""; locked.clear(); unlocked = false; save() }

    private fun save() = store.put(KEY, "$salt:$hash\n" + locked.joinToString("\n"))

    companion object {
        const val KEY = "parental"
        fun sha256(s: String): String = MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }
    }
}
