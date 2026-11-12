package com.jtech.zemer.search

import com.jtech.zemer.offline.SubsetNormalize

/**
 * Stalow Music: understands how people actually type artist names, so search finds approved artists from
 * nicknames, initials and loose spellings - "mbd" (Mordechai Ben David), "shwekey", "fried", "mordche",
 * Hebrew names, small typos. Pure (no Android), so it is unit-tested.
 *
 * Matching, strongest first:
 *  1. a nickname from [NICKNAMES];
 *  2. initials of a multi-word name ("mbd", "ybc");
 *  3. every typed word matches a word of the name by spelling skeleton (Hebrew-aware, typo-tolerant; the
 *     same normaliser the original app used, [SubsetNormalize]) - also matches Hebrew to English spellings;
 *  4. plain "contains" on any of the artist's names.
 */
class ArtistMatcher(artists: List<Entry>) {
    data class Entry(val id: String, val names: List<String>)

    private class Indexed(val entry: Entry, val plain: List<List<String>>, val skeletons: List<List<String>>, val initials: Set<String>)

    private val index = artists.map { e ->
        val plain = e.names.map { SubsetNormalize.plainTokens(it) }
        Indexed(
            entry = e,
            plain = plain,
            skeletons = e.names.map { SubsetNormalize.skeletonTokens(it) },
            initials = plain.filter { it.size >= 2 }.map { tokens -> tokens.joinToString("") { it.take(1) } }.toSet(),
        )
    }

    private val byNickname: Map<String, List<Indexed>> = NICKNAMES.mapNotNull { (nick, fullName) ->
        val target = SubsetNormalize.plainTokens(fullName).joinToString(" ")
        val hits = index.filter { ix -> ix.plain.any { it.joinToString(" ") == target } }
        if (hits.isEmpty()) null else SubsetNormalize.plainTokens(nick).joinToString(" ") to hits
    }.groupBy({ it.first }, { it.second }).mapValues { (_, v) -> v.flatten().distinctBy { it.entry.id } }

    /** Approved artists the query refers to, best first (at most [limit]). */
    fun match(query: String, limit: Int = 8): List<Entry> {
        val plainQ = SubsetNormalize.plainTokens(query)
        if (plainQ.isEmpty()) return emptyList()
        val joined = plainQ.joinToString(" ")
        val skelQ = SubsetNormalize.skeletonTokens(query)
        val scored = LinkedHashMap<String, Pair<Entry, Int>>()
        fun add(e: Entry, score: Int) {
            val cur = scored[e.id]
            if (cur == null || cur.second < score) scored[e.id] = e to score
        }
        byNickname[joined]?.forEach { add(it.entry, 100) }
        for (ix in index) {
            if (plainQ.size == 1 && joined.length in 2..5 && joined in ix.initials) add(ix.entry, 90)
            val exact = ix.plain.any { it.joinToString(" ") == joined }
            if (exact) add(ix.entry, 95)
            if (skelQ.isNotEmpty() && ix.skeletons.any { name -> skelQ.all { q -> name.any { w -> wordMatches(q, w) } } }) {
                add(ix.entry, 60 + 5 * skelQ.size)
            }
            if (joined.length >= 3 && ix.plain.any { it.joinToString(" ").contains(joined) }) add(ix.entry, 50)
        }
        val ranked = scored.values.sortedByDescending { it.second }
        val best = ranked.firstOrNull()?.second ?: return emptyList()
        // weak look-alikes are dropped when there is a clearly better match
        return ranked.filter { it.second >= best - 30 }.take(limit).map { it.first }
    }

    private fun wordMatches(q: String, w: String): Boolean = when {
        q == w -> true
        q.length >= 3 && w.startsWith(q) -> true
        maxOf(q.length, w.length) >= 3 && minOf(q.length, w.length) >= 2 -> SubsetNormalize.damerau(q, w, 1) <= 1
        else -> false
    }

    companion object {
        /** Common nicknames -> the artist's name in the approved list (ignored when that artist is not listed). */
        val NICKNAMES: List<Pair<String, String>> = listOf(
            "mbd" to "Mordechai Ben David", "מבד" to "Mordechai Ben David", "מרדכי בן דוד" to "Mordechai Ben David",
            "fried" to "Avraham Fried", "af" to "Avraham Fried", "פריד" to "Avraham Fried", "אברהם פריד" to "Avraham Fried",
            "shwekey" to "Yaakov Shwekey", "schwekey" to "Yaakov Shwekey", "שוואקי" to "Yaakov Shwekey",
            "lipa" to "Lipa Schmeltzer", "ליפא" to "Lipa Schmeltzer",
            "motty" to "Motty Steinmetz", "מוטי" to "Motty Steinmetz",
            "beri" to "Beri Weber", "benny" to "Benny Friedman", "ishay" to "Ishay Ribo", "ישי ריבו" to "Ishay Ribo",
            "carlebach" to "Rabbi Shlomo Carlebach", "קרליבך" to "Rabbi Shlomo Carlebach",
            "shmueli" to "Shmueli Ungar", "abie" to "Abie Rotenberg", "8th day" to "8th Day", "eighth day" to "8th Day",
            "mordechai shapiro" to "Mordechai Shapiro", "ms" to "Mordechai Shapiro",
            "schnitzler" to "Michoel Schnitzler", "yossi green" to "Yossi Green",
            "mbc" to "Miami Boys Choir", "ybc" to "Yeshiva Boys Choir", "shulem" to "Shulem Lemmer", "dedi" to "Dedi Graucher",
        )
    }
}
