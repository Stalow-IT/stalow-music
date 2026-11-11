package com.jtech.zemer.auth

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import javax.inject.Inject
import javax.inject.Singleton

/** The signed-in account for settings sync. Stalow Music has no sync account, so none ever exists. */
data class AuthUser(val uid: String, val email: String?)

/**
 * Stalow Music keeps content-filter settings on the device only. The original app synced them to the
 * original developers' Firebase project; that account system is removed, so this manager always reports
 * "signed out" and sign-in attempts fail with [AccountSyncUnavailable]. Every sync path already treats a
 * signed-out user as "keep settings locally".
 */
@Singleton
class UserAuthManager @Inject constructor(
    @ApplicationContext @Suppress("unused") private val context: Context,
) {
    val currentUser: AuthUser? get() = null
    val isUserSignedIn: Boolean get() = false
    val currentUserId: String? get() = null
    val currentUserEmail: String? get() = null

    val authStateFlow: Flow<AuthState> = flowOf(AuthState.SignedOut)

    @Suppress("UNUSED_PARAMETER")
    suspend fun signInWithGoogle(idToken: String): Result<AuthUser> = Result.failure(AccountSyncUnavailable())

    suspend fun signOut() = Unit

    @Suppress("UNUSED_PARAMETER")
    suspend fun getIdToken(forceRefresh: Boolean = false): Result<String> = Result.failure(AccountSyncUnavailable())
}

class AccountSyncUnavailable : Exception("Settings sync is not available in Stalow Music; settings stay on this device.")
