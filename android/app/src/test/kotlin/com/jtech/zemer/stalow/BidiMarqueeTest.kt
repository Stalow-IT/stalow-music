package com.jtech.zemer.stalow

import com.jtech.zemer.ui.component.isRtlText
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** A scrolling title moves the way its own text reads: by its first Hebrew or Latin letter. */
class BidiMarqueeTest {
    @Test
    fun `direction by the first strong letter`() {
        assertTrue(isRtlText("ונצעק - Vanitz"))
        assertTrue(isRtlText("  1. מוטי אילוביץ"))
        assertTrue(isRtlText("\"שירי שבת\" Vol 2"))
        assertFalse(isRtlText("Vanitz - ונצעק"))
        assertFalse(isRtlText("Motty Ilowitz"))
        assertFalse(isRtlText("2026 - 12:30"))
        assertFalse(isRtlText(""))
    }
}
