package com.jtech.zemer.auth

import javax.inject.Inject
import javax.inject.Singleton

/** The original app's anonymous sync account. Not available in Stalow Music (see [UserAuthManager]). */
@Singleton
class WebViewGoogleAuthManager @Inject constructor() {
    suspend fun signInAnonymously(): Result<AuthUser> = Result.failure(AccountSyncUnavailable())
}
