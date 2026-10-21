package org.jpi59.mommytv

import android.text.format.DateFormat
import androidx.annotation.DrawableRes
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import kotlinx.coroutines.delay
import java.util.Date

// The same palette as the webOS app and ideh.top
private val Bg = Color(0xFF0B0F17)
private val Panel = Color(0xB8161E2C)
private val Line = Color(0x29A3B8C8)
private val Fg = Color(0xFFF1F5F9)
private val Muted = Color(0xFF94A3B8)
private val FocusBg = Color(0xFFF8FAFC)
private val FocusFg = Color(0xFF0B0F17)
private val Sky = Color(0xFF38BDF8)
private val Gold = Color(0xFFFACC15)
private val Rose = Color(0xFFFB7185)
private val Live = Color(0xFFF43F5E)

@Composable
fun MommyApp(a: MainActivity) {
    Box(
        Modifier
            .fillMaxSize()
            .background(Bg)
            .background(Brush.radialGradient(listOf(Color(0x2900D2A0), Color.Transparent), radius = 1400f))
    ) {
        when (a.screen) {
            Screen.SETUP -> SetupScreen(a)
            Screen.BROWSER -> BrowserScreen(a)
            Screen.PLAYER -> PlayerScreen(a)
        }
        if (a.pinOpen) PinDialog(a)
        if (a.remoteOpen) RemoteDialog(a)
        Osd(a.osd, Modifier.align(Alignment.BottomCenter)) // above the dialogs: it answers what they did
    }
}

// ---------- shared pieces ----------

@Composable
private fun Icon(@DrawableRes id: Int, tint: Color, size: Int = 22) =
    Image(painterResource(id), null, Modifier.size(size.dp), colorFilter = ColorFilter.tint(tint))

@Composable
private fun Tile(ch: Channel?, w: Int, h: Int, @DrawableRes icon: Int? = null, iconTint: Color = Sky) {
    Box(
        Modifier.size(w.dp, h.dp).clip(RoundedCornerShape((h / 4).dp))
            .background(Brush.linearGradient(listOf(Color(0xFF1E293B), Color(0xFF0F172A))))
            .border(1.dp, Line, RoundedCornerShape((h / 4).dp)),
        contentAlignment = Alignment.Center,
    ) {
        val logo = ch?.logo?.let { rememberLogo(it) }
        when {
            icon != null -> Icon(icon, iconTint, h / 2)
            logo != null -> Image(logo, null, Modifier.fillMaxSize().padding((h / 8).dp), contentScale = ContentScale.Fit)
            ch != null -> Box(Modifier.fillMaxSize().background(Brush.linearGradient(tileColors(ch.title))), contentAlignment = Alignment.Center) {
                Text(initials(ch.title), color = Color.White, fontWeight = FontWeight.ExtraBold, fontSize = (h / 2.6).sp, maxLines = 1)
            }
            else -> Unit
        }
    }
}

/** "Blu Radio" → "BR": the first letter or digit of the first two words. Same rule as webOS. */
private fun initials(t: String) = t.split(' ').mapNotNull { w -> w.firstOrNull { it.isLetterOrDigit() } }.take(2).joinToString("").uppercase().ifEmpty { "•" }

/** A channel without a logo keeps one colour everywhere: picked from its name, same hash and palette as webOS. */
private val TILE_PALETTE = listOf(0xFF2563EB, 0xFF7C3AED, 0xFFDB2777, 0xFFEA580C, 0xFF059669, 0xFF0891B2, 0xFFCA8A04, 0xFFDC2626)
private fun tileColors(title: String): List<Color> {
    val c = Color(TILE_PALETTE[Math.floorMod(title.hashCode(), TILE_PALETTE.size)])
    return listOf(c, Color(c.red * 0.55f, c.green * 0.55f, c.blue * 0.55f))
}

@Composable
private fun Chip(text: String, focused: Boolean = false) {
    if (text.isEmpty()) return
    Text(
        text, fontSize = 13.sp, fontWeight = FontWeight.ExtraBold, color = if (focused) Color(0xFF0369A1) else Color(0xFFBAE6FD),
        modifier = Modifier.border(1.5.dp, if (focused) Color(0xFF7DD3FC) else Color(0x8038BDF8), RoundedCornerShape(8.dp)).padding(horizontal = 10.dp, vertical = 2.dp),
    )
}

@Composable
private fun LiveBadge() = Row(verticalAlignment = Alignment.CenterVertically) {
    Box(Modifier.size(9.dp).clip(CircleShape).background(Live))
    Spacer(Modifier.width(7.dp))
    Text(stringResource(R.string.live), color = Color(0xFFFECDD3), fontWeight = FontWeight.ExtraBold, fontSize = 13.sp)
}

@Composable
private fun Osd(text: String?, modifier: Modifier) {
    AnimatedVisibility(text != null, modifier.padding(bottom = 40.dp), enter = fadeIn() + slideInVertically { it / 2 }, exit = fadeOut()) {
        Text(
            text.orEmpty(), color = Fg, fontSize = 18.sp, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.widthIn(max = 900.dp).clip(RoundedCornerShape(14.dp)).background(Color(0xF00F172A))
                .border(1.dp, Line, RoundedCornerShape(14.dp)).padding(horizontal = 26.dp, vertical = 14.dp),
        )
    }
}

@Composable
private fun Clock() {
    var now by remember { mutableStateOf(Date()) }
    LaunchedEffect(Unit) { while (true) { delay(15_000); now = Date() } }
    val locale = LocalConfiguration.current.locales[0]
    val time = java.text.SimpleDateFormat(DateFormat.getBestDateTimePattern(locale, "Hm"), locale).format(now)
    val date = java.text.SimpleDateFormat(DateFormat.getBestDateTimePattern(locale, "EEEEdMMMM"), locale).format(now).replaceFirstChar { it.titlecase(locale) }
    Row(verticalAlignment = Alignment.Bottom) {
        Text(time, color = Fg, fontWeight = FontWeight.ExtraBold, fontSize = 24.sp)
        Spacer(Modifier.width(10.dp)); Text(date, color = Muted, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
    }
}

// ---------- setup ----------

@Composable
private fun SetupScreen(a: MainActivity) {
    val field = remember { FocusRequester() }
    val button = remember { FocusRequester() }
    // The button takes the focus explicitly: with nothing focused, Compose would give it to the field
    // (keyboard, remote or D-pad mode) and open the on-screen keyboard over the button.
    LaunchedEffect(a.setupFocus) { if (a.setupFocus == 0) field.requestFocus() else button.requestFocus() }
    Column(Modifier.fillMaxSize().safeDrawingPadding().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Image(painterResource(R.drawable.logo), null, Modifier.size(104.dp).clip(RoundedCornerShape(26.dp)))
        Spacer(Modifier.height(18.dp))
        Text("MommyTV", color = Fg, fontSize = 46.sp, fontWeight = FontWeight.ExtraBold)
        Text(stringResource(R.string.dedication), color = Color(0xFFFDA4AF), fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(20.dp))
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.heightIn(min = 32.dp)) {
            if (a.busy) { CircularProgressIndicator(Modifier.size(22.dp), color = Sky, strokeWidth = 3.dp); Spacer(Modifier.width(12.dp)) }
            Text(a.status, color = Muted, fontSize = 17.sp)
        }
        Spacer(Modifier.height(16.dp))
        OutlinedTextField(
            value = a.urlField, onValueChange = { a.urlField = it }, singleLine = true,
            label = { Text(stringResource(R.string.urlLabel)) }, placeholder = { Text(stringResource(R.string.urlPlaceholder)) },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go), keyboardActions = KeyboardActions(onGo = { a.setupFocus = 1; a.load(a.urlField, fromCopy = true) }),
            colors = fieldColors(), modifier = Modifier.widthIn(max = 640.dp).fillMaxWidth().focusRequester(field),
        )
        Spacer(Modifier.height(20.dp))
        val focused = a.setupFocus == 1
        Text(
            stringResource(R.string.load), color = Color.White, fontWeight = FontWeight.ExtraBold, fontSize = 18.sp,
            modifier = Modifier.scale(if (focused) 1.05f else 1f).clip(RoundedCornerShape(14.dp))
                .background(Brush.linearGradient(listOf(Color(0xFF0EA5E9), Color(0xFF2563EB))))
                .border(if (focused) 3.dp else 0.dp, FocusBg, RoundedCornerShape(14.dp))
                .focusRequester(button).combinedClickable(onClick = { a.load(a.urlField, fromCopy = true) }).padding(horizontal = 44.dp, vertical = 12.dp),
        )
    }
}

@Composable
private fun fieldColors() = OutlinedTextFieldDefaults.colors(
    focusedTextColor = Fg, unfocusedTextColor = Fg, focusedBorderColor = Sky, unfocusedBorderColor = Line,
    focusedLabelColor = Sky, unfocusedLabelColor = Muted, cursorColor = Sky,
    focusedContainerColor = Panel, unfocusedContainerColor = Panel,
)

// ---------- browser ----------

@Composable
private fun BrowserScreen(a: MainActivity) {
    val c = a.catalog ?: return
    @Suppress("UNUSED_EXPRESSION") a.version // recompose when lists change in place
    BoxWithConstraints(Modifier.fillMaxSize().safeDrawingPadding()) {
        val compact = maxWidth < 720.dp
        Column(Modifier.fillMaxSize().padding(horizontal = if (compact) 14.dp else 40.dp, vertical = if (compact) 12.dp else 22.dp)) {
            TopBar(a, compact)
            Spacer(Modifier.height(if (compact) 10.dp else 18.dp))
            if (compact) {
                RailChips(a, c)
                Spacer(Modifier.height(10.dp))
                // Phones: rows already show each channel, so the large card stays only where it adds something
                val g = a.group
                val country = g?.country
                when {
                    // search: the field takes the full width (the top-bar magnifier already shows where you are)
                    g?.kind == Kind.SEARCH -> TouchSearch(a, c)
                    g == null || g.kind == Kind.SETTINGS || a.listLength(g) == 0 -> { Hero(a, c, compact = true); Spacer(Modifier.height(10.dp)) }
                    g.kind == Kind.COUNTRIES && country != null -> {
                        Row(Modifier.padding(horizontal = 4.dp, vertical = 2.dp), verticalAlignment = Alignment.Bottom) {
                            Text(country.name, color = Fg, fontWeight = FontWeight.ExtraBold, fontSize = 22.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                            Spacer(Modifier.width(10.dp)); Text(channelsText(country.items.size), color = Muted, fontSize = 15.sp)
                        }
                        Spacer(Modifier.height(8.dp))
                    }
                }
                ChannelList(a, c, Modifier.fillMaxWidth().weight(1f), compact = true)
            } else {
                Row(Modifier.fillMaxSize()) {
                    Rail(a, c, Modifier.width(300.dp).fillMaxHeight())
                    Spacer(Modifier.width(28.dp))
                    Column(Modifier.weight(1f)) {
                        // touch tablets search like phones; TVs keep the large card, readable from the sofa
                        if (a.group?.kind == Kind.SEARCH && !a.isTv) TouchSearch(a, c) else Hero(a, c, compact = false)
                        Spacer(Modifier.height(16.dp))
                        ChannelList(a, c, Modifier.fillMaxWidth().weight(1f))
                    }
                }
            }
        }
    }
}

@Composable
private fun TopBar(a: MainActivity, compact: Boolean) = Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
    Image(painterResource(R.drawable.logo), null, Modifier.size(34.dp).clip(RoundedCornerShape(9.dp)))
    Spacer(Modifier.width(12.dp))
    Text("MommyTV", color = Fg, fontWeight = FontWeight.ExtraBold, fontSize = 21.sp, modifier = Modifier.weight(1f))
    if (compact && a.tvName != null) {
        // paired phone: where a tapped channel plays, like a cast button
        val label = stringResource(if (a.onTv) R.string.watchOnTv else R.string.watchHere)
        Box(
            Modifier.padding(start = 4.dp).size(48.dp).clip(CircleShape).background(if (a.onTv) Sky else Color.Transparent)
                .combinedClickable(onClick = { a.toggleOnTv() }).semantics { contentDescription = label },
            contentAlignment = Alignment.Center,
        ) { Icon(R.drawable.ic_tv, if (a.onTv) Color.White else Muted, 26) }
    }
    if (compact) {
        // phones: search always at hand, like the title
        val searching = a.group?.kind == Kind.SEARCH
        val label = stringResource(R.string.search)
        Box(
            Modifier.padding(start = 4.dp).size(48.dp).clip(CircleShape).background(if (searching) FocusBg else Color.Transparent)
                .combinedClickable(onClick = { a.openSearch() }).semantics { contentDescription = label },
            contentAlignment = Alignment.Center,
        ) { Icon(R.drawable.ic_search, if (searching) FocusFg else Fg, 28) }
        val inSettings = a.group?.kind == Kind.SETTINGS
        val settingsLabel = stringResource(R.string.settings)
        Box(
            Modifier.size(48.dp).clip(CircleShape).background(if (inSettings) FocusBg else Color.Transparent)
                .combinedClickable(onClick = { a.openSettings() }).semantics { contentDescription = settingsLabel },
            contentAlignment = Alignment.Center,
        ) { Icon(R.drawable.ic_settings, if (inSettings) FocusFg else Fg, 26) }
    }
    if (!compact) {
        Text("OK", color = Fg, fontSize = 12.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.border(1.5.dp, Muted, RoundedCornerShape(6.dp)).padding(horizontal = 7.dp, vertical = 1.dp))
        Spacer(Modifier.width(8.dp)); Text(stringResource(R.string.holdOk), color = Muted, fontSize = 14.sp)
        Spacer(Modifier.width(8.dp)); Icon(R.drawable.ic_fav, Gold, 15)
        Spacer(Modifier.width(5.dp)); Text(stringResource(R.string.favourite), color = Muted, fontSize = 14.sp)
        Spacer(Modifier.weight(1f))
        Clock()
    }
}

private fun groupIcon(a: MainActivity, g: Group): Pair<Int, Color>? = when (g.kind) {
    Kind.SEARCH -> R.drawable.ic_search to Fg
    Kind.FAV -> R.drawable.ic_fav to Gold
    Kind.APPS -> R.drawable.ic_apps to Fg
    Kind.COUNTRIES -> R.drawable.ic_globe to Fg
    Kind.SETTINGS -> R.drawable.ic_settings to Fg
    Kind.LIST -> if (a.parental.isLockedGroup(g.name)) R.drawable.ic_lock to Fg else null
}

private fun groupCount(a: MainActivity, g: Group): String = when (g.kind) {
    Kind.SEARCH, Kind.SETTINGS -> ""
    Kind.COUNTRIES -> g.countries.size.toString()
    else -> g.items.size.toString()
}

@Composable
private fun Rail(a: MainActivity, c: Catalog, modifier: Modifier) {
    val state = rememberLazyListState()
    LaunchedEffect(a.gSel) { state.animateScrollToItem((a.gSel - 4).coerceAtLeast(0)) }
    LazyColumn(modifier, state = state, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        itemsIndexed(c.groups) { i, g ->
            val focused = i == a.gSel && a.column == Column.RAIL
            val current = i == a.gSel && a.column != Column.RAIL
            val s by animateFloatAsState(if (focused) 1.04f else 1f, label = "rail")
            Row(
                Modifier.fillMaxWidth().height(46.dp).scale(s).clip(RoundedCornerShape(12.dp))
                    .background(if (focused) FocusBg else if (current) Panel else Color.Transparent)
                    .combinedClickable(onClick = { a.selectGroup(i); a.column = if (g.kind == Kind.SEARCH) Column.SEARCH else if (a.listLength(g) > 0) Column.LIST else Column.RAIL })
                    .padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                groupIcon(a, g)?.let { (id, tint) -> Icon(id, if (focused && tint == Fg) FocusFg else tint, 18); Spacer(Modifier.width(12.dp)) }
                Text(g.name, color = if (focused) FocusFg else Fg, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Text(groupCount(a, g), color = if (focused) Color(0xFF475569) else Muted, fontSize = 15.sp)
            }
        }
    }
}

@Composable
private fun RailChips(a: MainActivity, c: Catalog) {
    val state = rememberLazyListState()
    val shown = c.groups.withIndex().filter { it.value.kind != Kind.SEARCH && it.value.kind != Kind.SETTINGS } // both are top-bar buttons
    LaunchedEffect(a.gSel) { shown.indexOfFirst { it.index == a.gSel }.takeIf { it >= 0 }?.let { state.animateScrollToItem((it - 1).coerceAtLeast(0)) } }
    LazyRow(Modifier.fadingEdges(state), state = state, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(shown) { (i, g) ->
            val on = i == a.gSel
            Row(
                Modifier.clip(RoundedCornerShape(20.dp)).background(if (on) FocusBg else Panel)
                    .combinedClickable(onClick = { a.selectGroup(i); a.column = Column.LIST })
                    .padding(horizontal = 14.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                groupIcon(a, g)?.let { (id, tint) -> Icon(id, if (on && tint == Fg) FocusFg else tint, 15); Spacer(Modifier.width(6.dp)) }
                Text(g.name, color = if (on) FocusFg else Fg, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

/** Fades a scrolling row out at an edge only while there is more to scroll that way. */
private fun Modifier.fadingEdges(state: LazyListState) = graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
    .drawWithContent {
        drawContent()
        val w = 28.dp.toPx()
        if (state.canScrollBackward) drawRect(Brush.horizontalGradient(listOf(Color.Transparent, Color.Black), 0f, w), size = Size(w, size.height), blendMode = BlendMode.DstIn)
        if (state.canScrollForward) drawRect(Brush.horizontalGradient(listOf(Color.Black, Color.Transparent), size.width - w, size.width), Offset(size.width - w, 0f), Size(w, size.height), blendMode = BlendMode.DstIn)
    }

@Composable
private fun Hero(a: MainActivity, c: Catalog, compact: Boolean) {
    val g = a.group ?: return
    @Suppress("UNUSED_EXPRESSION") a.version // recompose when results change in place
    val tileW = if (compact) 120 else 190 // the selected channel's logo, larger on phones
    val tileH = if (compact) 68 else 108
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp))
            .background(Brush.linearGradient(listOf(Color(0x290EA5E9), Color(0x1FA855F7), Color(0x99161E2C))))
            .border(1.dp, Line, RoundedCornerShape(20.dp)).padding(if (compact) 12.dp else 22.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val ch = if (g.kind == Kind.SETTINGS || a.showingCountries(g) || g.items.isEmpty()) null else c.channels[g.items[a.cSel.coerceIn(0, g.items.size - 1)]]
        when {
            g.kind == Kind.SETTINGS -> Box(Modifier.size(tileW.dp, tileH.dp), contentAlignment = Alignment.Center) {
                Image(painterResource(R.drawable.logo), null, Modifier.size((tileH * 0.9f).dp).clip(RoundedCornerShape(16.dp)))
            }
            g.kind == Kind.SEARCH -> Tile(null, tileW, tileH, R.drawable.ic_search)
            a.showingCountries(g) -> Tile(null, tileW, tileH, R.drawable.ic_globe)
            ch == null && g.kind == Kind.FAV -> Tile(null, tileW, tileH, R.drawable.ic_fav, Gold)
            else -> Tile(ch, tileW, tileH)
        }
        Spacer(Modifier.width(if (compact) 14.dp else 24.dp))
        Column(Modifier.weight(1f)) {
            val (title, meta) = heroText(a, c, g, ch)
            Row(verticalAlignment = Alignment.CenterVertically) {
                val tagged = ch != null && g.kind != Kind.SEARCH // like webOS: the search card shows only the count
                if (tagged && !ch.isShortcut) { LiveBadge(); Spacer(Modifier.width(12.dp)) }
                Text(meta, color = Muted, fontSize = if (compact) 13.sp else 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                if (tagged) { Spacer(Modifier.width(10.dp)); Chip(ch.quality) }
            }
            if (g.kind == Kind.SEARCH) SearchField(a)
            else Text(title, color = Fg, fontWeight = FontWeight.ExtraBold, fontSize = if (compact) 22.sp else 36.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun heroText(a: MainActivity, c: Catalog, g: Group, ch: Channel?): Pair<String, String> = when {
    g.kind == Kind.SETTINGS && a.editingParental -> stringResource(R.string.parental) to stringResource(R.string.parentalHint)
    g.kind == Kind.SETTINGS -> stringResource(R.string.settings) to "MommyTV 0.1.3" // the licence has its own row
    g.kind == Kind.SEARCH -> "" to when {
        g.items.size == 1 -> stringResource(R.string.oneResult)
        g.items.isNotEmpty() -> stringResource(R.string.nResults, g.items.size.toString())
        g.query.isNotEmpty() -> stringResource(R.string.noResults)
        a.isTv -> stringResource(R.string.typeHint) // phones: the field's own placeholder is enough
        else -> ""
    }
    a.showingCountries(g) -> {
        val country = g.countries.getOrNull(a.cSel)
        if (a.column == Column.LIST && country != null) country.name to channelsText(country.items.size) + "  ·  " + stringResource(R.string.openHint)
        else stringResource(R.string.countries) to stringResource(R.string.nCountries, g.countries.size.toString())
    }
    ch == null -> (if (g.kind == Kind.FAV) stringResource(R.string.noFavs) else g.name) to (if (g.kind == Kind.FAV) stringResource(R.string.noFavsHint) else "")
    else -> {
        val where = if (ch.isShortcut) stringResource(R.string.officialApp) else g.country?.name ?: ch.categories.first().ifEmpty { stringResource(R.string.noGroup) }
        ch.title to where + if (c.isPinned(ch)) "  ·  " + stringResource(R.string.favourite) else ""
    }
}

@Composable
private fun channelsText(n: Int) = if (n == 1) stringResource(R.string.oneChannel) else stringResource(R.string.nChannels, n.toString())

/** Touch screens: the search field spans the width, with the result count below it. */
@Composable
private fun TouchSearch(a: MainActivity, c: Catalog) {
    val g = a.group ?: return
    @Suppress("UNUSED_EXPRESSION") a.version // recompose when results change in place
    SearchField(a)
    val count = heroText(a, c, g, null).second
    if (count.isNotEmpty()) Text(count, color = Muted, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 4.dp, top = 6.dp))
    Spacer(Modifier.height(8.dp))
}

@Composable
private fun SearchField(a: MainActivity) {
    val field = remember { FocusRequester() }
    val focus = LocalFocusManager.current
    val g = a.group ?: return
    var text by remember { mutableStateOf(g.query) }
    LaunchedEffect(a.column) { if (a.column == Column.SEARCH) field.requestFocus() else focus.clearFocus() }
    LaunchedEffect(text) { delay(250); if (text != g.query) a.runSearch(text) }
    OutlinedTextField(
        value = text, onValueChange = { text = it }, singleLine = true, placeholder = { Text(stringResource(R.string.searchPlaceholder)) },
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        keyboardActions = KeyboardActions(onSearch = { a.runSearch(text); a.column = if ((a.group?.items?.size ?: 0) > 0) Column.LIST else Column.RAIL }),
        colors = fieldColors(), modifier = Modifier.fillMaxWidth().padding(top = 6.dp).focusRequester(field),
    )
}

@Composable
private fun ChannelList(a: MainActivity, c: Catalog, modifier: Modifier, compact: Boolean = false) {
    val g = a.group ?: return
    val state = rememberLazyListState()
    LaunchedEffect(a.gSel, a.cSel, a.version) { if (a.listLength(g) > 0) state.animateScrollToItem((a.cSel - 2).coerceAtLeast(0)) }
    val n = a.listLength(g)
    val numberWidth = maxOf(36, n.toString().length * 10 + 4).dp // long lists: five digits stay on one line
    LazyColumn(modifier, state = state, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        items(n) { i ->
            val focused = i == a.cSel && a.column == Column.LIST
            val s by animateFloatAsState(if (focused) 1.02f else 1f, label = "row")
            Row(
                Modifier.fillMaxWidth().height(62.dp).scale(s).clip(RoundedCornerShape(14.dp))
                    .background(if (focused) FocusBg else if (i == a.cSel) Panel else Color.Transparent)
                    .border(if (focused) 2.dp else 0.dp, if (focused) Color(0x5938BDF8) else Color.Transparent, RoundedCornerShape(14.dp))
                    .combinedClickable(
                        onClick = { a.column = Column.LIST; a.activate(i) },
                        onLongClick = { if (g.kind != Kind.SETTINGS && !a.showingCountries(g)) a.toggleFavourite(c.channels[g.items[i]]) },
                    ).padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                when {
                    g.kind == Kind.SETTINGS -> SettingsRow(a, i, focused)
                    a.showingCountries(g) -> {
                        val country = g.countries[i]
                        Box(Modifier.size(70.dp, 40.dp).clip(RoundedCornerShape(10.dp)).background(Color(0xFF1E293B)), contentAlignment = Alignment.Center) {
                            Text(country.code, color = Fg, fontWeight = FontWeight.ExtraBold, fontSize = 15.sp)
                        }
                        Spacer(Modifier.width(18.dp))
                        Text(country.name, color = if (focused) FocusFg else Fg, fontSize = 19.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                        Text(channelsText(country.items.size), color = if (focused) Color(0xFF475569) else Muted, fontSize = 15.sp)
                    }
                    else -> {
                        val ch = c.channels[g.items[i]]
                        Tile(ch, 70, 40)
                        Spacer(Modifier.width(14.dp))
                        // phones: no remote to dial numbers, so the name gets the room and up to two lines
                        if (!compact) Text((i + 1).toString(), color = if (focused) Color(0xFF475569) else Muted, fontSize = 15.sp, maxLines = 1, softWrap = false, modifier = Modifier.width(numberWidth))
                        Text(ch.title, color = if (focused) FocusFg else Fg, fontSize = if (compact) 17.sp else 19.sp, lineHeight = if (compact) 20.sp else 24.sp, fontWeight = FontWeight.SemiBold, maxLines = if (compact) 2 else 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                        Spacer(Modifier.width(8.dp))
                        if (c.isPinned(ch)) { Icon(R.drawable.ic_fav, Gold, 17); Spacer(Modifier.width(10.dp)) }
                        Chip(ch.quality, focused)
                    }
                }
            }
        }
    }
}

@Composable
private fun SettingsRow(a: MainActivity, i: Int, focused: Boolean) {
    if (a.editingParental) { ParentalRow(a, i, focused); return }
    val row = a.settingsRows[i]
    val (icon, text) = when (row) {
        Setting.CHANGE -> R.drawable.ic_change to stringResource(R.string.change)
        Setting.DELETE -> R.drawable.ic_trash to stringResource(R.string.deleteList)
        Setting.PARENTAL -> R.drawable.ic_lock to stringResource(if (a.parental.enabled) R.string.parentalIsOn else R.string.parentalIsOff)
        Setting.REMOTE -> R.drawable.ic_phone to stringResource(R.string.remoteTitle)
        Setting.DEDICATION -> R.drawable.ic_heart to stringResource(R.string.dedication)
        Setting.VERSION -> R.drawable.ic_info to "MommyTV 0.1.3 · " + stringResource(R.string.org)
        Setting.LICENSE -> R.drawable.ic_info to stringResource(R.string.license)
        Setting.SOURCE -> R.drawable.ic_info to stringResource(R.string.source)
        Setting.NO_CHANNELS -> R.drawable.ic_info to stringResource(R.string.noChannels)
        Setting.LG_LIB -> R.drawable.ic_info to stringResource(R.string.lgLib)
        Setting.FONT -> R.drawable.ic_info to stringResource(R.string.font)
    }
    val heart = row == Setting.DEDICATION
    val action = row == Setting.CHANGE || row == Setting.DELETE || row == Setting.PARENTAL || row == Setting.REMOTE
    Icon(icon, if (heart) Rose else if (focused) FocusFg else if (action) Sky else Muted, 18)
    Spacer(Modifier.width(14.dp))
    Text(
        text, fontSize = 17.sp, fontWeight = if (heart) FontWeight.ExtraBold else if (action) FontWeight.SemiBold else FontWeight.Normal,
        color = if (heart) (if (focused) Color(0xFFBE123C) else Color(0xFFFECDD3)) else if (focused) FocusFg else Fg,
    )
}

/** The parental editor: one row per category of the list (OK locks or unlocks it), then "turn off". */
@Composable
private fun ParentalRow(a: MainActivity, i: Int, focused: Boolean) {
    val cats = a.catalog?.categories.orEmpty()
    val off = i >= cats.size
    val on = !off && a.parental.locks(cats[i])
    Icon(if (off) R.drawable.ic_trash else if (on) R.drawable.ic_lock else R.drawable.ic_unlock, if (on) Gold else if (focused) FocusFg else Muted, 18)
    Spacer(Modifier.width(14.dp))
    Text(if (off) stringResource(R.string.parentalDisable) else cats[i], fontSize = 17.sp, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal,
        color = if (focused) FocusFg else Fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
}

// ---------- player ----------

@OptIn(UnstableApi::class)
@Composable
private fun PlayerScreen(a: MainActivity) {
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        AndroidView(
            factory = { ctx -> PlayerView(ctx).apply { useController = false; resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT; player = a.playback.player } },
            modifier = Modifier.fillMaxSize().combinedClickable(onClick = { a.showBanner() }, onLongClick = { a.current?.let { a.toggleFavourite(it) } }),
        )
        if (a.buffering) CircularProgressIndicator(Modifier.size(64.dp).align(Alignment.Center), color = Sky, strokeWidth = 5.dp)
        AnimatedVisibility(a.banner, Modifier.align(Alignment.BottomCenter), enter = fadeIn() + slideInVertically { it / 2 }, exit = fadeOut()) {
            val ch = a.current ?: return@AnimatedVisibility
            BoxWithConstraints(Modifier.fillMaxWidth()) {
            val compact = maxWidth < 720.dp
            Row(
                Modifier.fillMaxWidth().background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xD1020617), Color(0xF2020617))))
                    .safeDrawingPadding()
                    .padding(start = if (compact) 16.dp else 40.dp, end = if (compact) 16.dp else 40.dp, top = if (compact) 40.dp else 70.dp, bottom = if (compact) 16.dp else 30.dp),
                verticalAlignment = Alignment.Bottom,
            ) {
                if (compact) Tile(ch, 70, 40) else Tile(ch, 140, 80)
                Text((a.playIdx + 1).toString(), color = Sky, fontWeight = FontWeight.ExtraBold, fontSize = if (compact) 26.sp else 46.sp, modifier = Modifier.padding(horizontal = if (compact) 12.dp else 24.dp))
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        LiveBadge(); Spacer(Modifier.width(12.dp))
                        Text(ch.categories.first(), color = Muted, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false)); Spacer(Modifier.width(10.dp)); Chip(ch.quality)
                        if (!compact) {
                            Spacer(Modifier.weight(1f))
                            Text(stringResource(R.string.holdOkFav), color = Muted, fontSize = 14.sp)
                        }
                    }
                    Text(ch.title, color = Fg, fontWeight = FontWeight.ExtraBold, fontSize = if (compact) 22.sp else 34.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            }
        }
    }
}

// ---------- phone remote ----------

@Composable
private fun RemoteDialog(a: MainActivity) {
    Box(Modifier.fillMaxSize().background(Color(0xD1020617)).safeDrawingPadding(), contentAlignment = Alignment.Center) {
        Column(
            Modifier.widthIn(max = 520.dp).padding(16.dp).clip(RoundedCornerShape(24.dp)).background(Brush.linearGradient(listOf(Color(0xFF1E293B), Color(0xFF0F172A))))
                .border(1.dp, Line, RoundedCornerShape(24.dp)).padding(28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            val center = androidx.compose.ui.text.style.TextAlign.Center
            Icon(R.drawable.ic_tv, Sky, 48)
            Spacer(Modifier.height(12.dp))
            Text(stringResource(R.string.remoteTitle), color = Fg, fontSize = 26.sp, fontWeight = FontWeight.ExtraBold)
            Spacer(Modifier.height(14.dp))
            val name = a.tvName
            val found = a.remoteFound
            when {
                name != null -> {
                    Text(stringResource(R.string.remoteConnected, name), color = Sky, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, textAlign = center)
                    Spacer(Modifier.height(20.dp))
                    DialogButton(stringResource(R.string.sendList), primary = true) { a.sendList() }
                    Spacer(Modifier.height(10.dp))
                    DialogButton(stringResource(R.string.remoteForget), primary = false) { a.forgetRemote() }
                }
                a.remoteBusy -> {
                    Text(a.remoteMsg, color = Muted, fontSize = 16.sp, textAlign = center)
                    Spacer(Modifier.height(18.dp))
                    CircularProgressIndicator(Modifier.size(32.dp), color = Sky, strokeWidth = 3.dp)
                }
                !found.isNullOrEmpty() -> found.forEach { tv ->
                    DialogButton(tv.name, primary = true) { a.pairTv(tv) }
                    Spacer(Modifier.height(10.dp))
                }
                else -> {
                    Text(a.remoteMsg.ifEmpty { stringResource(R.string.remoteIntro) }, color = Muted, fontSize = 16.sp, textAlign = center)
                    Spacer(Modifier.height(18.dp))
                    DialogButton(stringResource(R.string.remoteFind), primary = true) { a.findTvs() }
                }
            }
        }
    }
}

@Composable
private fun DialogButton(text: String, primary: Boolean, onClick: () -> Unit) = Text(
    text, color = Color.White, fontWeight = FontWeight.ExtraBold, fontSize = 17.sp,
    modifier = Modifier.clip(RoundedCornerShape(14.dp))
        .background(if (primary) Brush.linearGradient(listOf(Color(0xFF0EA5E9), Color(0xFF2563EB))) else Brush.linearGradient(listOf(Panel, Panel)))
        .border(1.dp, Line, RoundedCornerShape(14.dp))
        .combinedClickable(onClick = onClick).padding(horizontal = 32.dp, vertical = 12.dp),
)

// ---------- parental PIN ----------

@Composable
private fun PinDialog(a: MainActivity) {
    Box(Modifier.fillMaxSize().background(Color(0xD1020617)), contentAlignment = Alignment.Center) {
        Column(
            Modifier.widthIn(max = 520.dp).clip(RoundedCornerShape(24.dp)).background(Brush.linearGradient(listOf(Color(0xFF1E293B), Color(0xFF0F172A))))
                .border(1.dp, Line, RoundedCornerShape(24.dp)).padding(36.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(R.drawable.ic_lock, Sky, 52)
            Spacer(Modifier.height(12.dp))
            Text(stringResource(R.string.parental), color = Fg, fontSize = 28.sp, fontWeight = FontWeight.ExtraBold)
            Text(a.pinMsg, color = Muted, fontSize = 16.sp, modifier = Modifier.padding(top = 6.dp, bottom = 22.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                repeat(4) { i ->
                    Box(Modifier.size(22.dp).clip(CircleShape).background(if (i < a.pinBuf.length) Sky else Color.Transparent).border(3.dp, if (i < a.pinBuf.length) Sky else Muted, CircleShape))
                }
            }
            // touch screens have no number keys: a small keypad
            Spacer(Modifier.height(22.dp))
            for (row in listOf(listOf(1, 2, 3), listOf(4, 5, 6), listOf(7, 8, 9), listOf(0))) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(vertical = 4.dp)) {
                    row.forEach { d ->
                        Text(d.toString(), color = Fg, fontSize = 20.sp, fontWeight = FontWeight.Bold,
                            modifier = Modifier.size(54.dp, 44.dp).clip(RoundedCornerShape(10.dp)).background(Panel).combinedClickable(onClick = { a.pinDigit(d) }).padding(top = 9.dp),
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                    }
                }
            }
        }
    }
}
