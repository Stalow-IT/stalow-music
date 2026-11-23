package com.jtech.zemer.accounts

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.util.Base64
import com.jtech.zemer.utils.CatalogOverrides
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import timber.log.Timber
import java.io.File
import java.io.IOException
import java.security.SecureRandom
import java.util.concurrent.TimeUnit

/**
 * Stalow Music accounts: each device signs up with a name and waits until an admin approves it (as a user or an
 * admin). The device proves who it is with a random private key kept on the phone; the server keeps only its hash.
 * The last answer is remembered, so an approved phone keeps working offline.
 * Server: the stalow-accounts function (stalow-music/server/stalow-accounts).
 */
object StalowAccount {
    const val URL = "https://dzrnortzhpnoussbeedv.supabase.co/functions/v1/stalow-accounts"

    enum class Status { NONE, PENDING, APPROVED, BLOCKED }

    data class State(
        val status: Status = Status.NONE,
        val role: String = "user",
        val name: String = "",
        val id: String = "",
    ) {
        val isAdmin get() = status == Status.APPROVED && (role == "admin" || role == "owner")
    }

    class ServerError(message: String, val code: Int) : IOException(message)

    private val http = OkHttpClient.Builder().callTimeout(30, TimeUnit.SECONDS).build()
    private lateinit var prefs: SharedPreferences
    private lateinit var key: String
    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    /** At app start, before anything is shown. */
    fun init(context: Context) {
        if (::prefs.isInitialized) return
        prefs = context.getSharedPreferences("stalow_account", Context.MODE_PRIVATE)
        key = prefs.getString("key", null) ?: newKey().also { prefs.edit().putString("key", it).apply() }
        _state.value = State(
            status = runCatching { Status.valueOf(prefs.getString("status", "NONE")!!) }.getOrDefault(Status.NONE),
            role = prefs.getString("role", "user") ?: "user",
            name = prefs.getString("name", "") ?: "",
            id = prefs.getString("id", "") ?: "",
        )
        CatalogOverrides.load(File(context.filesDir, "stalow_catalog.json"))
        DriveLibrary.load(File(context.filesDir, "stalow_drive.json"))
    }

    private fun newKey(): String {
        val bytes = ByteArray(32).also { SecureRandom().nextBytes(it) }
        return Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
    }

    /** One server call; throws [IOException] (no connection) or [ServerError] (refused). */
    suspend fun call(action: String, extra: JSONObject = JSONObject()): JSONObject = withContext(Dispatchers.IO) {
        val body = JSONObject(extra.toString()).put("action", action).put("key", key)
        val request = Request.Builder().url(URL).post(body.toString().toRequestBody("application/json".toMediaType())).build()
        http.newCall(request).execute().use { res ->
            val text = res.body?.string().orEmpty()
            val json = runCatching { JSONObject(text) }.getOrElse { throw IOException("bad answer (${res.code})") }
            if (!res.isSuccessful || json.has("error")) throw ServerError(json.optString("error", "failed (${res.code})"), res.code)
            json
        }
    }

    private fun apply(json: JSONObject) {
        val status = when (json.optString("status")) {
            "approved" -> Status.APPROVED
            "pending" -> Status.PENDING
            "blocked" -> Status.BLOCKED
            else -> Status.NONE
        }
        val s = State(status, json.optString("role", "user"), json.optString("name", _state.value.name), json.optString("id", ""))
        _state.value = s
        prefs.edit().putString("status", s.status.name).putString("role", s.role).putString("name", s.name).putString("id", s.id).apply()
    }

    private val deviceName get() = "Android: ${Build.MANUFACTURER} ${Build.MODEL}".take(80)

    /** Asks for access under [name]. */
    suspend fun register(name: String) = apply(call("register", JSONObject().put("name", name.trim()).put("device", deviceName)))

    /** The owner's one-time code (given once by the developer): this device becomes the owner. */
    suspend fun claimOwner(name: String, code: String) {
        if (_state.value.status == Status.NONE) register(name)
        apply(call("claimOwner", JSONObject().put("code", code.trim())))
    }

    /** Asks the server for this device's status; without a connection the last answer stays. */
    suspend fun refresh(): Boolean = runCatching { apply(call("status")); true }
        .onFailure { Timber.d(it, "StalowAccount: status check failed") }.getOrDefault(false)

    /** Fetches the admins' channel changes; true when they changed (the lists must be re-imported). */
    suspend fun refreshCatalog(): Boolean {
        if (_state.value.status != Status.APPROVED) return false
        return runCatching { CatalogOverrides.update(call("catalog.get")) }
            .onFailure { Timber.d(it, "StalowAccount: catalog check failed") }.getOrDefault(false)
    }

    // ---- admins ----

    data class Account(val id: String, val name: String, val device: String, val status: String, val role: String, val lastSeen: String)

    suspend fun accounts(): List<Account> {
        val list = call("accounts.list").optJSONArray("accounts") ?: JSONArray()
        return (0 until list.length()).mapNotNull { list.optJSONObject(it) }.map {
            Account(it.optString("id"), it.optString("name"), it.optString("device"), it.optString("status"), it.optString("role"), it.optString("last_seen"))
        }
    }

    suspend fun decide(id: String, status: String? = null, role: String? = null) {
        call("accounts.decide", JSONObject().put("id", id).apply { status?.let { put("status", it) }; role?.let { put("role", it) } })
    }

    data class Found(val id: String, val name: String, val thumbnail: String, val kind: String)

    suspend fun searchChannels(q: String): List<Found> {
        val list = call("catalog.search", JSONObject().put("q", q)).optJSONArray("results") ?: JSONArray()
        return (0 until list.length()).mapNotNull { list.optJSONObject(it) }.map {
            Found(it.optString("id"), it.optString("name"), it.optString("thumbnail"), it.optString("kind"))
        }
    }

    data class Picture(val url: String, val from: String)

    /** Possible pictures for a channel / artist: its pages on YouTube Music and YouTube, and a search for [q]. */
    suspend fun pictures(id: String, q: String): List<Picture> {
        val list = call("catalog.images", JSONObject().put("id", id).put("q", q)).optJSONArray("images") ?: JSONArray()
        return (0 until list.length()).mapNotNull { list.optJSONObject(it) }.map { Picture(it.optString("url"), it.optString("from")) }
            .filter { it.url.startsWith("https://") }
    }

    /** Adds, moves or removes one channel / artist for everyone, then applies it on this phone. */
    suspend fun setEntry(id: String, name: String, thumbnail: String?, category: String, removed: Boolean) {
        call(
            "catalog.set",
            JSONObject().put(
                "entry",
                JSONObject().put("id", id).put("name", name).put("thumbnail", thumbnail.orEmpty()).put("category", category).put("removed", removed),
            ),
        )
        refreshCatalog()
    }
}
