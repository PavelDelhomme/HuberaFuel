package com.gasoiltracking.app

import android.Manifest
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * GPS natif → JS. Expo / Fused ignorent souvent le provider labo `huberalab`.
 * Même contrat que Maps LocationBridge : mock gagne ~120 s.
 */
class HuberaLocationModule(
    ctx: ReactApplicationContext,
) : ReactContextBaseJavaModule(ctx), LocationListener {
    private val main = Handler(Looper.getMainLooper())
    @Volatile private var watching = false
    @Volatile private var last: Location? = null
    private val poll = object : Runnable {
        override fun run() {
            if (!watching) return
            pushLastKnown()
            main.postDelayed(this, 900)
        }
    }

    override fun getName(): String = "HuberaLocation"

    @ReactMethod
    fun addListener(eventName: String?) = Unit

    @ReactMethod
    fun removeListeners(count: Int) = Unit

    @ReactMethod
    fun startWatch() {
        main.post { startWatchUi() }
    }

    @ReactMethod
    fun stopWatch() {
        main.post { stopWatchUi() }
    }

    private fun hasFine(): Boolean {
        return ContextCompat.checkSelfPermission(
            reactApplicationContext,
            Manifest.permission.ACCESS_FINE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
    }

    private fun startWatchUi() {
        if (watching) return
        if (!hasFine()) return
        val lm = reactApplicationContext.getSystemService(LocationManager::class.java) ?: return
        watching = true
        for (p in providersOf(lm)) {
            runCatching {
                lm.requestLocationUpdates(p, 700L, 0f, this, Looper.getMainLooper())
            }.onFailure { Log.w(TAG, "watch $p: ${it.message}") }
        }
        pushLastKnown()
        main.removeCallbacks(poll)
        main.post(poll)
    }

    private fun stopWatchUi() {
        if (!watching) return
        watching = false
        main.removeCallbacks(poll)
        val lm = reactApplicationContext.getSystemService(LocationManager::class.java) ?: return
        runCatching { lm.removeUpdates(this) }
    }

    private fun providersOf(lm: LocationManager): List<String> {
        return lm.allProviders.filter { it.isNotBlank() }
    }

    private fun pushLastKnown() {
        val lm = reactApplicationContext.getSystemService(LocationManager::class.java) ?: return
        val fixes = providersOf(lm).mapNotNull { p ->
            runCatching { lm.getLastKnownLocation(p) }.getOrNull()
        }
        val mock = fixes.filter { isMock(it) }.maxByOrNull { it.time }
        val real = fixes.filter { !isMock(it) }.maxByOrNull { it.time }
        val chosen = when {
            mock != null && System.currentTimeMillis() - mock.time < 120_000L -> mock
            real != null -> real
            else -> return
        }
        push(chosen)
    }

    override fun onLocationChanged(location: Location) {
        val cur = last
        if (cur != null && isMock(cur) && !isMock(location) && location.time - cur.time < 60_000L) {
            return
        }
        push(location)
    }

    @Deprecated("Deprecated in Java")
    override fun onLocationChanged(locations: MutableList<Location>) {
        locations.lastOrNull()?.let { onLocationChanged(it) }
    }

    @Deprecated("Deprecated in Java")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit

    override fun onProviderEnabled(provider: String) = Unit

    override fun onProviderDisabled(provider: String) = Unit

    private fun isMock(loc: Location): Boolean {
        return if (Build.VERSION.SDK_INT >= 31) loc.isMock else @Suppress("DEPRECATION") loc.isFromMockProvider
    }

    private fun push(loc: Location) {
        val prev = last
        if (prev != null &&
            prev.latitude == loc.latitude &&
            prev.longitude == loc.longitude &&
            isMock(prev) == isMock(loc) &&
            loc.time - prev.time < 400
        ) {
            return
        }
        last = loc
        val mock = isMock(loc)
        Log.i(TAG, "fix ${loc.latitude},${loc.longitude} acc=${loc.accuracy} mock=$mock p=${loc.provider}")
        val params = Arguments.createMap()
        params.putDouble("latitude", loc.latitude)
        params.putDouble("longitude", loc.longitude)
        params.putDouble("accuracy", loc.accuracy.toDouble())
        params.putBoolean("mocked", mock)
        params.putString("provider", loc.provider ?: "")
        params.putDouble("timestamp", loc.time.toDouble())
        runCatching {
            reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("huberaFix", params)
        }
    }

    companion object {
        private const val TAG = "HuberaLoc"
    }
}
