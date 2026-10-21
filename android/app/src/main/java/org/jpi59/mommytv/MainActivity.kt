package org.jpi59.mommytv

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.Locale

enum class Screen { SETUP, BROWSER, PLAYER }
enum class Column { RAIL, LIST, SEARCH }

/** Rows of Ajustes: what does something first, then the dedication and the information. */
enum class Setting { CHANGE, DELETE, REMOTE, DEDICATION, VERSION, LICENSE, SOURCE, NO_CHANNELS, LG_LIB, FONT }

@OptIn(UnstableApi::class)
class MainActivity : ComponentActivity(), Playback.Listener {
    // ---------- state shown by the interface (Ui.kt) ----------
    var screen by mutableStateOf(Screen.SETUP)
    var status by mutableStateOf("")
    var busy by mutableStateOf(false)
    var urlField by mutableStateOf("")
    var setupFocus by mutableIntStateOf(1) // 0 field, 1 button
    var catalog by mutableStateOf<Catalog?>(null)
    var gSel by mutableIntStateOf(0)
    var cSel by mutableIntStateOf(0)
    var column by mutableStateOf(Column.RAIL)
    var version by mutableIntStateOf(0) // bumped when lists change in place (favourites, search)
    var playItems: List<Int> = emptyList()
    var playIdx by mutableIntStateOf(0)
    var buffering by mutableStateOf(false)
    var banner by mutableStateOf(false)
    var osd by mutableStateOf<String?>(null)
    var pinOpen by mutableStateOf(false)
    var pinBuf by mutableStateOf("")
    var pinMsg by mutableStateOf("")
    var remoteOpen by mutableStateOf(false)
    var remoteMsg by mutableStateOf("")
    var remoteBusy by mutableStateOf(false)
    var remoteFound by mutableStateOf<List<LgTv.Found>?>(null) // TVs answering on the LAN, while pairing
    var tvName by mutableStateOf<String?>(null) // the paired LG TV; null when not paired
    var rememberList by mutableStateOf(true) // "Recordar esta lista", on unless the user unticks it
    var onTv by mutableStateOf(true) // paired phone: a tapped channel plays on the TV (the TV button in the top bar)

    lateinit var playback: Playback
    var parental = Parental(Header("", emptyList()))
    private var pinDone: (() -> Unit)? = null
    private var pinFails = 0
    private var pinWaitUntil = 0L
    private var osdJob: Job? = null
    private var bannerJob: Job? = null
    private var okLong = false

    private val prefs by lazy { getSharedPreferences("mommytv", Context.MODE_PRIVATE) }
    private val store = object : Store {
        override fun get(key: String) = prefs.getString(key, null)
        override fun put(key: String, value: String) { prefs.edit().putString(key, value).apply() }
    }

    /** On a TV this app is the screen, not the remote: no "Control the TV" row. */
    val isTv by lazy { packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK) }
    val settingsRows by lazy { Setting.entries.filter { it != Setting.REMOTE || !isTv } }

    val lang: String get() = Locale.getDefault().language.let { if (it in LANGS) it else "en" }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        playback = Playback(this, this)
        onTv = prefs.getBoolean(KEY_ON_TV, true)
        prefs.edit().remove("remoteToken").remove("remoteBase").remove("watch").remove("hidden").apply() // the old PC remote and watch counts
        tvName = prefs.getString(KEY_TV_NAME, null)?.takeIf { prefs.getString(KEY_TV_KEY, null) != null }
        setContent {
            BackHandler { onBack() }
            MommyApp(this)
        }
        val saved = prefs.getString(KEY_URL, null)
        if (saved != null) { urlField = saved; setupFocus = 1; load(saved, fromCopy = true) } else { setupFocus = 0; screen = Screen.SETUP }
    }

    override fun onStop() {
        super.onStop()
        if (screen == Screen.PLAYER) { playback.stop(); screen = Screen.BROWSER }
    }

    override fun onDestroy() {
        playback.release()
        super.onDestroy()
    }

    // ---------- loading ----------

    private val copyFile get() = java.io.File(filesDir, "playlist-copy.m3u")

    /**
     * Loads the playlist the user gave. Remembered, with a copy, unless "Recordar esta lista" is off;
     * when its site does not answer, a remembered list starts from the copy.
     */
    fun load(url: String, fromCopy: Boolean = false) {
        val u = url.trim()
        if (u.isEmpty()) { fail(getString(R.string.needUrl)); return }
        screen = Screen.SETUP
        status = getString(R.string.loading); busy = true
        lifecycleScope.launch {
            val text = try {
                Net.fetch(u)
            } catch (e: Exception) {
                val copy = if (fromCopy && prefs.getString(KEY_URL, null) == u) runCatching { copyFile.readText() }.getOrNull() else null
                if (copy != null) { useText(copy); showOsd(getString(R.string.usingCopy)) }
                else fail(if (e is Net.HttpError) getString(R.string.httpError, e.code.toString()) else getString(R.string.noConnect))
                return@launch
            }
            if (M3u.parse(text).isEmpty()) { fail(getString(R.string.emptyList)); return@launch }
            if (rememberList) { prefs.edit().putString(KEY_URL, u).apply(); runCatching { copyFile.writeText(text) } } else forgetList(false)
            useText(text)
        }
    }

    private fun useText(text: String) {
        parental = Parental(M3u.header(text))
        useList(M3u.parse(text))
    }

    /** "Eliminar lista": the playlist, its copy and what belongs to it (Favoritos, watch time, last channel). */
    private fun forgetList(everything: Boolean) {
        prefs.edit().remove(KEY_URL).apply {
            if (everything) listOf(KEY_LAST, Catalog.PINS).forEach { remove(it) }
        }.apply()
        copyFile.delete()
    }

    private var deleteArmed = 0L

    private fun deleteList() {
        if (prefs.getString(KEY_URL, null) == null) return
        if (System.currentTimeMillis() - deleteArmed > 5000) { deleteArmed = System.currentTimeMillis(); showOsd(getString(R.string.deleteConfirm)); return }
        deleteArmed = 0
        forgetList(true)
        catalog = null
        urlField = ""; setupFocus = 0; busy = false
        status = getString(R.string.listDeleted)
        screen = Screen.SETUP
    }

    private fun fail(text: String) { busy = false; status = text; screen = Screen.SETUP }

    private fun useList(list: List<Channel>) {
        val locale = Locale.getDefault()
        val labels = Labels(
            getString(R.string.search), getString(R.string.favs), getString(R.string.shortcuts),
            getString(R.string.inLang), getString(R.string.countries), getString(R.string.all), getString(R.string.settings), getString(R.string.noGroup),
        )
        val c = Catalog(list, locale.country, runCatching { locale.isO3Language }.getOrDefault("eng"), labels, store)
        catalog = c
        gSel = c.startGroup(); cSel = 0; column = Column.RAIL
        busy = false; status = ""
        screen = Screen.BROWSER
        selectLast(c)
    }

    // Marks the last channel watched; playback waits for the user.
    private fun selectLast(c: Catalog) {
        val last = prefs.getString(KEY_LAST, null) ?: return
        val idx = c.indexOfUrl(last) ?: return
        var g = c.groups[gSel]
        var at = g.items.indexOf(idx)
        if (at < 0) { gSel = c.groups.indexOfFirst { it.name == c.labels.all }.coerceAtLeast(0); g = c.groups[gSel]; at = g.items.indexOf(idx) }
        if (at < 0) return
        column = Column.LIST; cSel = at
    }

    // ---------- phone remote: LG's own second-screen link, no server in between ----------

    fun openRemote() { remoteMsg = ""; remoteBusy = false; remoteFound = null; remoteOpen = true }

    fun findTvs() {
        if (remoteBusy) return
        remoteBusy = true; remoteMsg = getString(R.string.remoteSearching); remoteFound = null
        lifecycleScope.launch {
            val found = LgTv.discover()
            remoteBusy = false
            remoteFound = found
            remoteMsg = if (found.isEmpty()) getString(R.string.remoteNone) else ""
        }
    }

    fun pairTv(tv: LgTv.Found) {
        if (remoteBusy) return
        remoteBusy = true; remoteMsg = getString(R.string.remoteAccept)
        lifecycleScope.launch {
            val key = LgTv.pair(tv.host, null)
            remoteBusy = false
            if (key == null) { remoteMsg = getString(R.string.remoteNoTv); return@launch }
            prefs.edit().putString(KEY_TV_HOST, tv.host).putString(KEY_TV_KEY, key).putString(KEY_TV_NAME, tv.name).apply()
            tvName = tv.name; remoteFound = null; remoteMsg = ""
        }
    }

    fun toggleOnTv() { onTv = !onTv; prefs.edit().putBoolean(KEY_ON_TV, onTv).apply() }

    /** Opens MommyTV on the paired TV with [params]; says plainly what happened. */
    private fun tellTv(params: Map<String, String>, ok: String) {
        val host = prefs.getString(KEY_TV_HOST, null) ?: return
        val key = prefs.getString(KEY_TV_KEY, null) ?: return
        lifecycleScope.launch {
            when (LgTv.launch(host, key, params)) {
                LgTv.Sent.Ok -> showOsd(ok)
                LgTv.Sent.NoApp -> showOsd(getString(R.string.tvNoApp))
                LgTv.Sent.NotAllowed -> { forgetRemote(); showOsd(getString(R.string.remoteGone)) }
                LgTv.Sent.Unreachable -> showOsd(getString(R.string.remoteNoTv))
            }
        }
    }

    // a channel from any list: the TV plays it within its own list when it has it, alone otherwise
    private fun sendToTv(ch: Channel) = tellTv(mapOf("mtvPlay" to ch.url, "mtvTitle" to ch.title, "mtvLogo" to ch.logo), getString(R.string.sentToTv, ch.title))

    fun sendList() {
        val url = prefs.getString(KEY_URL, null) ?: run { showOsd(getString(R.string.needUrl)); return }
        tellTv(mapOf("mtvList" to url), getString(R.string.listSent))
    }

    fun forgetRemote() {
        prefs.edit().remove(KEY_TV_HOST).remove(KEY_TV_KEY).remove(KEY_TV_NAME).apply()
        tvName = null
    }

    // ---------- groups and lists ----------

    val group: Group? get() = catalog?.groups?.getOrNull(gSel)
    fun showingCountries(g: Group) = g.kind == Kind.COUNTRIES && g.country == null
    fun listLength(g: Group) = when {
        g.kind == Kind.SETTINGS -> settingsRows.size
        showingCountries(g) -> g.countries.size
        else -> g.items.size
    }

    private var returnTo: kotlin.Pair<Int, Int>? = null // group and row to go back to from a top-bar button

    /** The phone's search and settings buttons: open from anywhere, Back returns to where it was. */
    fun openSearch() = openFromTopBar(Kind.SEARCH, Column.SEARCH)
    fun openSettings() = openFromTopBar(Kind.SETTINGS, Column.LIST)

    private fun openFromTopBar(kind: Kind, col: Column) {
        val c = catalog ?: return
        val from = if (group?.kind == Kind.SEARCH || group?.kind == Kind.SETTINGS) returnTo else gSel to cSel
        selectGroup(c.groups.indexOfFirst { it.kind == kind })
        returnTo = from
        column = col
    }

    private fun openChangeList() { urlField = prefs.getString(KEY_URL, urlField) ?: urlField; setupFocus = 0; status = ""; screen = Screen.SETUP }

    fun selectGroup(i: Int) {
        val c = catalog ?: return
        returnTo = null
        gSel = (i + c.groups.size) % c.groups.size
        cSel = 0
        if (c.groups[gSel].kind == Kind.FAV) c.refreshFavourites()
        version++
    }

    fun activate(i: Int) {
        val c = catalog ?: return
        val g = group ?: return
        cSel = i
        when {
            g.kind == Kind.SETTINGS -> when (settingsRows[i]) { Setting.CHANGE -> openChangeList(); Setting.DELETE -> deleteList(); Setting.REMOTE -> openRemote(); else -> Unit }
            showingCountries(g) -> { g.country = g.countries[i]; g.items = g.country!!.items; cSel = 0; version++ }
            i !in g.items.indices -> Unit // empty group: nothing to open
            else -> {
                val ch = c.channels[g.items[i]]
                if (ch.isShortcut) launchApp(ch) else if (tvName != null && onTv && !isTv) sendToTv(ch) else play(g.items, i)
            }
        }
    }

    fun toggleFavourite(ch: Channel) {
        val c = catalog ?: return
        if (ch.isShortcut) return
        val added = c.toggleFavourite(ch)
        showOsd(getString(if (added) R.string.favAdded else R.string.favRemoved, ch.title))
        val g = group
        if (g?.kind == Kind.FAV) { cSel = cSel.coerceAtMost((g.items.size - 1).coerceAtLeast(0)); if (g.items.isEmpty()) column = Column.RAIL }
        version++
        if (screen == Screen.PLAYER) showBanner()
    }

    fun runSearch(q: String) { catalog?.runSearch(q); cSel = 0; version++ }

    private fun launchApp(ch: Channel) {
        val pkg = ch.url.removePrefix(Channel.SHORTCUT)
        val intent: Intent? = packageManager.getLeanbackLaunchIntentForPackage(pkg) ?: packageManager.getLaunchIntentForPackage(pkg)
        if (intent == null) showOsd(getString(R.string.appMissing, ch.title)) else runCatching { startActivity(intent) }.onFailure { showOsd(getString(R.string.appFail, ch.title, "-1")) }
    }

    // ---------- player ----------

    val current: Channel? get() = catalog?.channels?.getOrNull(playItems.getOrNull(playIdx) ?: -1)

    fun play(items: List<Int>, i: Int) {
        val c = catalog ?: return
        if (items.isEmpty()) return
        val idx = (i + items.size) % items.size
        val target = c.channels[items[idx]]
        if (parental.isLocked(target)) { askPin { play(items, i) }; return }
        playItems = items.toList()
        playIdx = idx
        if (group?.items === items) cSel = idx
        screen = Screen.PLAYER
        osd = null
        playback.play(target.url)
        prefs.edit().putString(KEY_LAST, target.url).apply()
        showBanner()
    }

    private fun stopPlayer() {
        playback.stop()
        banner = false
        buffering = false
        catalog?.let { if (group?.kind == Kind.FAV) { it.refreshFavourites(); version++ } }
        screen = Screen.BROWSER
    }

    fun showBanner() {
        banner = true
        bannerJob?.cancel()
        bannerJob = lifecycleScope.launch { delay(5000); banner = false }
    }

    override fun onBuffering(buffering: Boolean) { this.buffering = buffering }
    override fun onPlaying() {
        if (osd == getString(R.string.reconnecting, current?.title ?: "")) osd = null
    }
    override fun onReconnecting() { showOsd(getString(R.string.reconnecting, current?.title ?: "")) }
    override fun onFailed() { showOsd(getString(R.string.cantPlay, current?.title ?: ""), sticky = true) }

    fun showOsd(text: String, sticky: Boolean = false) {
        osd = text
        osdJob?.cancel()
        if (!sticky) osdJob = lifecycleScope.launch { delay(4000); if (osd == text) osd = null }
    }

    // ---------- parental PIN ----------

    private fun askPin(done: () -> Unit) { pinDone = done; pinBuf = ""; pinMsg = getString(R.string.pinPrompt); pinOpen = true }
    fun closePin() { pinOpen = false; pinDone = null }

    fun pinDigit(d: Int) {
        if (System.currentTimeMillis() < pinWaitUntil) { pinMsg = getString(R.string.pinWait); return }
        pinBuf += d
        if (pinBuf.length < 4) return
        if (parental.check(pinBuf)) {
            pinFails = 0
            val done = pinDone
            closePin(); version++
            done?.invoke()
            return
        }
        pinFails++
        pinBuf = ""
        if (pinFails >= 5) { pinFails = 0; pinWaitUntil = System.currentTimeMillis() + 60_000; pinMsg = getString(R.string.pinWait) }
        else pinMsg = getString(R.string.pinWrong)
    }

    // ---------- remote control: the same behaviour as the webOS app ----------

    // Keys that a focused text field (address, search) does not use reach the activity here.
    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (isOk(keyCode) && holdApplies()) {
            // short press acts on release; holding OK toggles Favourites
            if (event.repeatCount == 0) okLong = false
            else if (!okLong && event.repeatCount >= 3) { okLong = true; holdTarget()?.let { toggleFavourite(it) } }
            return true
        }
        return onKey(keyCode) || super.onKeyDown(keyCode, event)
    }

    override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean {
        if (isOk(keyCode) && holdApplies()) { if (!okLong) onKey(keyCode); okLong = false; return true }
        return super.onKeyUp(keyCode, event)
    }

    private fun isOk(code: Int) = code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER || code == KeyEvent.KEYCODE_NUMPAD_ENTER
    private fun holdApplies() = !pinOpen && (screen == Screen.PLAYER || (screen == Screen.BROWSER && column == Column.LIST))

    private fun holdTarget(): Channel? {
        if (screen == Screen.PLAYER) return current
        val c = catalog ?: return null
        val g = group ?: return null
        if (g.kind == Kind.SETTINGS || showingCountries(g) || g.items.isEmpty()) return null
        return c.channels[g.items[cSel.coerceIn(0, g.items.size - 1)]].takeIf { !it.isShortcut }
    }

    /** Back button or gesture, through the back-press dispatcher (predictive back). */
    fun onBack() {
        if (pinOpen) { closePin(); return }
        if (remoteOpen) { remoteOpen = false; return }
        when (screen) {
            Screen.SETUP -> if (catalog != null) screen = Screen.BROWSER else finish()
            Screen.PLAYER -> stopPlayer()
            Screen.BROWSER -> {
                val g = group
                val from = returnTo
                when {
                    from != null && (g?.kind == Kind.SEARCH || g?.kind == Kind.SETTINGS) -> { selectGroup(from.first); cSel = from.second; column = if (listLength(group ?: return) > 0) Column.LIST else Column.RAIL }
                    column == Column.SEARCH -> column = Column.RAIL
                    column == Column.LIST && g != null && g.kind == Kind.COUNTRIES && g.country != null -> {
                        val back = g.countries.indexOf(g.country)
                        g.country = null; g.items = ArrayList(); cSel = back.coerceAtLeast(0); version++
                    }
                    column == Column.LIST -> column = Column.RAIL
                    else -> finish()
                }
            }
        }
    }

    fun onKey(code: Int): Boolean {
        if (pinOpen) {
            when (code) {
                in KeyEvent.KEYCODE_0..KeyEvent.KEYCODE_9 -> pinDigit(code - KeyEvent.KEYCODE_0)
                in KeyEvent.KEYCODE_NUMPAD_0..KeyEvent.KEYCODE_NUMPAD_9 -> pinDigit(code - KeyEvent.KEYCODE_NUMPAD_0)
            }
            return true
        }
        if (remoteOpen) return false // the pairing dialog handles its own keys
        return when (screen) {
            Screen.SETUP -> setupKey(code)
            Screen.BROWSER -> browserKey(code)
            Screen.PLAYER -> playerKey(code)
        }
    }

    private fun setupKey(code: Int): Boolean = when (code) {
        // focus order: address (0), "Recordar esta lista" (2), Load (1)
        KeyEvent.KEYCODE_DPAD_UP -> { setupFocus = if (setupFocus == 1) 2 else 0; true }
        KeyEvent.KEYCODE_DPAD_DOWN -> { setupFocus = if (setupFocus == 0) 2 else 1; true }
        KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> { if (setupFocus == 1) load(urlField) else if (setupFocus == 2) rememberList = !rememberList; true }
        else -> false
    }

    private fun browserKey(code: Int): Boolean {
        val c = catalog ?: return false
        val g = group ?: return false
        if (column == Column.SEARCH) {
            if (code == KeyEvent.KEYCODE_DPAD_DOWN) { column = if (g.items.isNotEmpty()) Column.LIST else Column.RAIL; return true }
            return false
        }
        when (code) {
            KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN -> {
                val d = if (code == KeyEvent.KEYCODE_DPAD_UP) -1 else 1
                if (column == Column.RAIL) selectGroup(gSel + d) else cSel = (cSel + d).coerceIn(0, (listLength(g) - 1).coerceAtLeast(0))
            }
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> when {
                column == Column.RAIL && g.kind == Kind.SEARCH -> column = Column.SEARCH
                column == Column.RAIL -> if (listLength(g) > 0) column = Column.LIST
                else -> activate(cSel)
            }
            KeyEvent.KEYCODE_DPAD_RIGHT -> if (column == Column.RAIL && g.kind == Kind.SEARCH) column = Column.SEARCH else if (listLength(g) > 0) column = Column.LIST
            KeyEvent.KEYCODE_DPAD_LEFT -> column = Column.RAIL
            KeyEvent.KEYCODE_PROG_YELLOW -> holdTarget()?.let { toggleFavourite(it) }
            else -> return false
        }
        return true
    }

    private fun playerKey(code: Int): Boolean {
        when (code) {
            KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_CHANNEL_UP -> play(playItems, playIdx + 1)
            KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_CHANNEL_DOWN -> play(playItems, playIdx - 1)
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> showBanner()
            KeyEvent.KEYCODE_PROG_YELLOW -> current?.let { toggleFavourite(it) }
            else -> return false
        }
        return true
    }

    companion object {
        val LANGS = setOf("es", "en", "fr", "de", "it", "pt", "zh", "ja")
        const val KEY_URL = "playlistUrl"
        const val KEY_LAST = "last"
        const val KEY_TV_HOST = "tvHost"
        const val KEY_TV_KEY = "tvKey" // granted by the TV when its owner accepted this phone
        const val KEY_TV_NAME = "tvName"
        const val KEY_ON_TV = "onTv"
    }
}
