package com.jtech.zemer.accounts

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The shared Google Drive list as the server sends it, and how a Drive file plays. */
class DriveLibraryTest {
    private val json = JSONObject(
        """{"items":[
          {"id":"1FolderIdAAAAAAAAAAAAAAAAAAA","kind":"folder","title":"Shiur series","category":"shiurim","removed":false,
           "files":[{"id":"1FileIdBBBBBBBBBBBBBBBBBBBBB","name":"Part 2 / 03 Lecture.mp3","type":"audio"},
                    {"id":"bad id","name":"x.mp3","type":"audio"},
                    {"id":"1FileIdCCCCCCCCCCCCCCCCCCCCC","name":"clip.mp4","type":"video"}],
           "artistId":null,"year":null},
          {"id":"1AlbumIdDDDDDDDDDDDDDDDDDDDD","kind":"folder","title":"Old album","category":"music","removed":false,
           "files":[],"artistId":"UC1-uPfCV7ZcLCSou9v_Vclw","year":1994},
          {"id":"x","kind":"file","title":"skipped: bad id"}
        ]}""",
    )

    @Test
    fun `items, files, artist albums and bad ids`() {
        val items = DriveLibrary.parse(json)
        assertEquals(listOf("1FolderIdAAAAAAAAAAAAAAAAAAA", "1AlbumIdDDDDDDDDDDDDDDDDDDDD"), items.map { it.id })
        val folder = items[0]
        assertTrue(folder.isFolder)
        assertEquals("shiurim", folder.category)
        assertNull(folder.artistId)
        assertEquals(2, folder.files.size)
        assertEquals("03 Lecture", folder.files[0].title)
        assertTrue(folder.files[1].isVideo)
        assertEquals("UC1-uPfCV7ZcLCSou9v_Vclw", items[1].artistId)
        assertEquals(1994, items[1].year)
    }

    @Test
    fun `a Drive file plays from its download address`() {
        val items = DriveLibrary.parse(json)
        val meta = DriveMedia.metadata(items[0].files[0], items[0])
        assertEquals("drive:1FileIdBBBBBBBBBBBBBBBBBBBBB", meta.id)
        assertEquals("03 Lecture", meta.title)
        assertEquals("Shiur series", meta.artists.single().name)
        assertTrue(DriveMedia.isDrive(meta.id))
        assertFalse(DriveMedia.isDrive("dQw4w9WgXcQ"))
        assertEquals(
            "https://drive.usercontent.google.com/download?id=1FileIdBBBBBBBBBBBBBBBBBBBBB&export=download&confirm=t",
            DriveMedia.streamUrl(meta.id),
        )
    }
}
