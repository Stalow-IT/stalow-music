package com.jtech.zemer.search

import org.junit.Assert.assertEquals
import org.junit.Test

/** Home lists the artists played most recently first (Stalow). */
class RecentFirstTest {
    private val all = (1..30).map { "a$it" }

    @Test
    fun recentlyPlayedLeadInOrderThenOthers() {
        val out = recentFirst(all, listOf("a7", "unknown", "a3", "a7"), 20) { it }
        assertEquals(listOf("a7", "a3"), out.take(2))
        assertEquals(20, out.size)
        assertEquals(20, out.toSet().size)
    }

    @Test
    fun nothingPlayedGivesAFullRandomRow() {
        assertEquals(20, recentFirst(all, emptyList(), 20) { it }.toSet().size)
    }
}
