# Guía Completa de Implementación: LockSuite MDM

**Plataforma:** Android (Kotlin) | **API Target:** 34 | **API Mínima:** 23

---

## ⚠️ Aviso Legal y Ético

Esta aplicación utiliza las APIs oficiales de **Android Enterprise** de Google, diseñadas exclusivamente para la gestión de dispositivos corporativos. Su uso está pensado para:

- Dispositivos **propiedad de la empresa o institución** que despliega el MDM.  
- Entornos donde el usuario final es informado explícitamente del monitoreo.  
- Cumplimiento de las leyes laborales y de privacidad locales (GDPR, LFPDPPP, etc.).

**El uso de estas APIs en dispositivos ajenos sin consentimiento puede constituir un delito en la mayoría de jurisdicciones.**

---

## 1\. Análisis de Viabilidad — ¿Es posible construir esta app?

### Veredicto general: ✅ TOTALMENTE VIABLE

Cada característica especificada existe dentro del ecosistema oficial de **Android Enterprise / Device Owner Mode**. No se requiere root ni modificaciones del sistema. La tabla siguiente resume la viabilidad de cada módulo:

| Módulo | Viabilidad | API Utilizada | Dificultad |
| :---- | :---- | :---- | :---- |
| Políticas de sistema (restricciones) | ✅ Completa | `DevicePolicyManager` | Media |
| Control de hardware (cámara, audio) | ✅ Completa | `DevicePolicyManager` | Baja |
| Control de conectividad | ✅ Completa | `DevicePolicyManager` | Baja |
| Ocultar/Suspender apps | ✅ Completa | `DevicePolicyManager` | Baja |
| Servicio de Accesibilidad (monitoreo) | ✅ Factible | `AccessibilityService` | Alta |
| Bloqueo de imágenes con overlay | ⚠️ Parcial | `AccessibilityService` \+ `WindowManager` | Muy Alta |
| Anti-evasión (auto-back en ajustes) | ✅ Factible | `AccessibilityService` | Alta |
| Persistencia en arranque | ✅ Completa | `BroadcastReceiver` | Baja |
| Watchdog en segundo plano | ✅ Completa | `WorkManager` \+ `ForegroundService` | Media |
| Modo Stealth \+ código marcador | ✅ Completa | `PackageManager` \+ `secret_code` | Media |
| Firebase \+ Control Remoto | ✅ Completa | Firebase SDK | Media |
| Purga de emergencia | ✅ Completa | `DevicePolicyManager` | Baja |

### Limitación crítica del módulo de imágenes:

El "bloqueo de imágenes" (renderizar una máscara negra sobre `ImageView` de apps de terceros) **es la característica más compleja** del spec. El `AccessibilityService` puede detectar nodos, pero no puede interceptar el renderizado nativo a nivel de GPU. La aproximación factible es superponer una ventana `TYPE_ACCESSIBILITY_OVERLAY` sobre las regiones donde se detecten nodos de imagen, lo cual funciona bien en apps de UI estándar pero puede fallar en apps con OpenGL/Vulkan (cámaras, juegos).

---

## 2\. Arquitectura del Proyecto

### 2.1 Estructura de Módulos Recomendada

com.ejemplo.locksuite/

├── LockSuiteApplication.kt          \# Application class \+ Firebase init

├── receiver/

│   ├── BootReceiver.kt               \# ACTION\_BOOT\_COMPLETED

│   ├── SecretCodeReceiver.kt         \# \*\#\*\#1234\#\*\#\* y \*\#\*\#9999\#\*\#\*

│   └── DeviceAdminReceiver.kt        \# Receptor de políticas MDM

├── service/

│   ├── LockSuiteAccessibilityService.kt \# Servicio de Accesibilidad

│   ├── WatchdogForegroundService.kt  \# Servicio persistente en 1er plano

│   └── LockSuiteFirebaseService.kt   \# FCM para comandos remotos

├── worker/

│   └── WatchdogWorker.kt             \# WorkManager recurrente

├── ui/

│   ├── auth/

│   │   ├── SetupPinActivity.kt       \# Creación de PIN (primer inicio)

│   │   └── LoginActivity.kt          \# Pantalla de autenticación

│   ├── dashboard/

│   │   └── DashboardActivity.kt      \# Panel principal MDM

│   ├── policies/

│   │   └── PoliciesFragment.kt       \# Fragmento de restricciones

│   ├── apps/

│   │   └── AppManagerFragment.kt     \# Gestión individual de apps

│   └── emergency/

│       └── EmergencyActivity.kt      \# Pantalla de purga de emergencia

├── mdm/

│   ├── PolicyManager.kt              \# Wrapper de DevicePolicyManager

│   └── AppController.kt             \# Control individual de paquetes

├── security/

│   ├── PinManager.kt                 \# Hashing, validación, brute-force

│   └── SessionManager.kt            \# Control de sesión activa

└── util/

    ├── Constants.kt                  \# PIN maestro hash, constantes

    └── PrefsHelper.kt               \# SharedPreferences wrapper

### 2.2 AndroidManifest.xml (secciones clave)

\<manifest xmlns:android="http://schemas.android.com/apk/res/android"

    package="com.ejemplo.locksuite"\>

    \<\!-- PERMISOS REQUERIDOS \--\>

    \<uses-permission android:name="android.permission.RECEIVE\_BOOT\_COMPLETED" /\>

    \<uses-permission android:name="android.permission.FOREGROUND\_SERVICE" /\>

    \<uses-permission android:name="android.permission.FOREGROUND\_SERVICE\_SPECIAL\_USE" /\>

    \<uses-permission android:name="android.permission.REQUEST\_INSTALL\_PACKAGES" /\>

    \<uses-permission android:name="android.permission.SYSTEM\_ALERT\_WINDOW" /\>

    \<application

        android:name=".LockSuiteApplication"

        android:label="Servicio del Sistema"

        android:icon="@mipmap/ic\_system\_icon"\>

        \<\!-- DEVICE ADMIN RECEIVER — núcleo del MDM \--\>

        \<receiver

            android:name=".receiver.DeviceAdminReceiver"

            android:description="@string/device\_admin\_description"

            android:label="LockSuite MDM"

            android:permission="android.permission.BIND\_DEVICE\_ADMIN"

            android:exported="true"\>

            \<meta-data

                android:name="android.app.device\_admin"

                android:resource="@xml/device\_admin\_policies" /\>

            \<intent-filter\>

                \<action android:name="android.app.action.DEVICE\_ADMIN\_ENABLED" /\>

            \</intent-filter\>

        \</receiver\>

        \<\!-- BOOT RECEIVER \--\>

        \<receiver

            android:name=".receiver.BootReceiver"

            android:exported="true"\>

            \<intent-filter android:priority="999"\>

                \<action android:name="android.intent.action.BOOT\_COMPLETED" /\>

                \<action android:name="android.intent.action.LOCKED\_BOOT\_COMPLETED" /\>

            \</intent-filter\>

        \</receiver\>

        \<\!-- SECRET CODE RECEIVER (marcador telefónico) \--\>

        \<receiver

            android:name=".receiver.SecretCodeReceiver"

            android:exported="true"\>

            \<intent-filter\>

                \<action android:name="android.provider.Telephony.SECRET\_CODE" /\>

                \<data android:scheme="android\_secret\_code" android:host="1234" /\> \<\!-- app \--\>

                \<data android:scheme="android\_secret\_code" android:host="9999" /\> \<\!-- emergencia \--\>

            \</intent-filter\>

        \</receiver\>

        \<\!-- ACCESSIBILITY SERVICE \--\>

        \<service

            android:name=".service.LockSuiteAccessibilityService"

            android:permission="android.permission.BIND\_ACCESSIBILITY\_SERVICE"

            android:exported="true"\>

            \<intent-filter\>

                \<action android:name="android.accessibilityservice.AccessibilityService" /\>

            \</intent-filter\>

            \<meta-data

                android:name="android.accessibilityservice"

                android:resource="@xml/accessibility\_service\_config" /\>

        \</service\>

        \<\!-- FOREGROUND SERVICE (Watchdog) \--\>

        \<service

            android:name=".service.WatchdogForegroundService"

            android:foregroundServiceType="specialUse"

            android:exported="false" /\>

        \<\!-- LAUNCHER ALIAS (modo visible — habilitado por defecto) \--\>

        \<activity-alias

            android:name=".LauncherAlias"

            android:targetActivity=".ui.auth.LoginActivity"

            android:enabled="true"

            android:exported="true"\>

            \<intent-filter\>

                \<action android:name="android.intent.action.MAIN" /\>

                \<category android:name="android.intent.category.LAUNCHER" /\>

            \</intent-filter\>

        \</activity-alias\>

        \<\!-- LOGIN ACTIVITY (sin alias para modo stealth) \--\>

        \<activity

            android:name=".ui.auth.LoginActivity"

            android:exported="false"

            android:showWhenLocked="true"

            android:turnScreenOn="true" /\>

        \<activity

            android:name=".ui.emergency.EmergencyActivity"

            android:exported="false"

            android:showWhenLocked="true"

            android:turnScreenOn="true" /\>

    \</application\>

\</manifest\>

### 2.3 Archivo de políticas MDM (res/xml/device\_admin\_policies.xml)

\<device-admin xmlns:android="http://schemas.android.com/apk/res/android"\>

    \<uses-policies\>

        \<limit-password /\>

        \<watch-login /\>

        \<reset-password /\>

        \<force-lock /\>

        \<wipe-data /\>

        \<disable-keyguard-features /\>

        \<disable-camera /\>

        \<disable-screen-capture /\>

    \</uses-policies\>

\</device-admin\>

### 2.4 Configuración del Servicio de Accesibilidad (res/xml/accessibility\_service\_config.xml)

\<accessibility-service

    xmlns:android="http://schemas.android.com/apk/res/android"

    android:accessibilityEventTypes="typeWindowStateChanged|typeWindowContentChanged|typeViewClicked|typeViewTextChanged"

    android:accessibilityFeedbackType="feedbackGeneric"

    android:accessibilityFlags="flagReportViewIds|flagRetrieveInteractiveWindows|flagIncludeNotImportantViews"

    android:canRetrieveWindowContent="true"

    android:canPerformGestures="true"

    android:description="@string/accessibility\_description"

    android:notificationTimeout="100"

    android:settingsActivity=".ui.dashboard.DashboardActivity" /\>

---

## 3\. Módulo Crítico: Configuración como Device Owner

Este es el requisito fundamental. **Sin ser Device Owner, la mayoría de APIs no funcionan.**

### 3.1 Métodos de provisioning (sin root)

**Método A — ADB (más común para desarrollo/despliegue):**

\# 1\. El dispositivo NO debe tener cuentas Google configuradas

\# 2\. Conectar por USB con USB Debugging habilitado

adb shell dpm set-device-owner com.ejemplo.locksuite/.receiver.DeviceAdminReceiver

**Método B — NFC Bump (enterprise, para escala masiva):** Se usa con un dispositivo "programador" que envía el aprovisionamiento NFC a un teléfono recién reseteado al encender.

**Método C — QR Code Provisioning (Android 7+):**

// Generar JSON de aprovisionamiento

val provisioningJson \= """

{

    "android.app.extra.PROVISIONING\_DEVICE\_ADMIN\_COMPONENT\_NAME":

        "com.ejemplo.locksuite/.receiver.DeviceAdminReceiver",

    "android.app.extra.PROVISIONING\_DEVICE\_ADMIN\_PACKAGE\_DOWNLOAD\_LOCATION":

        "https://tu-servidor.com/locksuite.apk",

    "android.app.extra.PROVISIONING\_SKIP\_ENCRYPTION": false,

    "android.app.extra.PROVISIONING\_WIFI\_SSID": "WiFi\_Empresa",

    "android.app.extra.PROVISIONING\_WIFI\_PASSWORD": "contraseña"

}

"""

// Este JSON se convierte en QR y se escanea durante el setup inicial del dispositivo

### 3.2 DeviceAdminReceiver

// receiver/DeviceAdminReceiver.kt

package com.ejemplo.locksuite.receiver

import android.app.admin.DeviceAdminReceiver

import android.content.Context

import android.content.Intent

class DeviceAdminReceiver : DeviceAdminReceiver() {

    override fun onEnabled(context: Context, intent: Intent) {

        super.onEnabled(context, intent)

        // La app acaba de ser habilitada como admin/device owner

        // Aquí se pueden aplicar políticas iniciales

    }

    override fun onDisableRequested(context: Context, intent: Intent): CharSequence {

        return "No se puede deshabilitar el administrador del dispositivo."

    }

    override fun onDisabled(context: Context, intent: Intent) {

        super.onDisabled(context, intent)

        // Solo llega aquí si clearDeviceOwnerApp() fue llamado

    }

}

---

## 4\. Módulo de Seguridad y Autenticación

### 4.1 Manejo del PIN (PinManager.kt)

// security/PinManager.kt

package com.ejemplo.locksuite.security

import android.content.Context

import android.content.SharedPreferences

import androidx.security.crypto.EncryptedSharedPreferences

import androidx.security.crypto.MasterKey

import java.security.MessageDigest

import java.security.SecureRandom

import android.util.Base64

object PinManager {

    private const val PREFS\_NAME \= "locksuite\_secure\_prefs"

    private const val KEY\_PIN\_HASH \= "pin\_hash"

    private const val KEY\_PIN\_SALT \= "pin\_salt"

    private const val LOCKOUT\_COUNT\_KEY \= "lockout\_count"

    private const val LOCKOUT\_TIME\_KEY \= "lockout\_timestamp"

    private const val MAX\_ATTEMPTS \= 5

    private const val LOCKOUT\_DURATION\_MS \= 5 \* 60 \* 1000L // 5 minutos

    // Hash SHA-256 precomputado del PIN maestro \+ salt estático

    // Cambiar antes de compilar para producción:

    // echo \-n "SALT\_ESTATICO\_PINmaestro1234" | sha256sum

    private const val MASTER\_PIN\_SALT \= "MDM\_STATIC\_SALT\_2024\_LS"

    private const val MASTER\_PIN\_HASH \= "a3f1c2b4e5d6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2"

    private fun getPrefs(context: Context): SharedPreferences {

        // Usar EncryptedSharedPreferences para mayor seguridad

        val masterKey \= MasterKey.Builder(context)

            .setKeyScheme(MasterKey.KeyScheme.AES256\_GCM)

            .build()

        return EncryptedSharedPreferences.create(

            context, PREFS\_NAME, masterKey,

            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256\_SIV,

            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256\_GCM

        )

    }

    /\*\* Genera un salt aleatorio de 16 bytes \*/

    private fun generateSalt(): ByteArray {

        val salt \= ByteArray(16)

        SecureRandom().nextBytes(salt)

        return salt

    }

    /\*\* Calcula SHA-256(salt \+ pin) \*/

    private fun hashPin(pin: String, salt: ByteArray): String {

        val digest \= MessageDigest.getInstance("SHA-256")

        digest.update(salt)

        digest.update(pin.toByteArray())

        return Base64.encodeToString(digest.digest(), Base64.NO\_WRAP)

    }

    /\*\* Guarda el PIN del administrador (solo en el setup inicial) \*/

    fun saveAdminPin(context: Context, pin: String) {

        val salt \= generateSalt()

        val hash \= hashPin(pin, salt)

        val prefs \= getPrefs(context)

        prefs.edit()

            .putString(KEY\_PIN\_HASH, hash)

            .putString(KEY\_PIN\_SALT, Base64.encodeToString(salt, Base64.NO\_WRAP))

            .apply()

    }

    /\*\* Verifica si el PIN ingresado es correcto \*/

    fun verifyPin(context: Context, inputPin: String): Boolean {

        // Verificar primero el PIN maestro de emergencia

        if (verifyMasterPin(inputPin)) return true

        val prefs \= getPrefs(context)

        val storedHash \= prefs.getString(KEY\_PIN\_HASH, null) ?: return false

        val saltStr \= prefs.getString(KEY\_PIN\_SALT, null) ?: return false

        val salt \= Base64.decode(saltStr, Base64.NO\_WRAP)

        return hashPin(inputPin, salt) \== storedHash

    }

    /\*\* Verifica el PIN maestro de emergencia \*/

    fun verifyMasterPin(inputPin: String): Boolean {

        val digest \= MessageDigest.getInstance("SHA-256")

        digest.update(MASTER\_PIN\_SALT.toByteArray())

        digest.update(inputPin.toByteArray())

        val hash \= digest.digest().joinToString("") { "%02x".format(it) }

        return hash \== MASTER\_PIN\_HASH

    }

    /\*\* ¿Ya existe un PIN guardado? \*/

    fun isPinConfigured(context: Context): Boolean {

        return try {

            getPrefs(context).contains(KEY\_PIN\_HASH)

        } catch (e: Exception) { false }

    }

    /\*\* Registra intento fallido y retorna si hay lockout activo \*/

    fun recordFailedAttempt(context: Context): LockoutStatus {

        val prefs \= getPrefs(context)

        val count \= prefs.getInt(LOCKOUT\_COUNT\_KEY, 0\) \+ 1

        prefs.edit().putInt(LOCKOUT\_COUNT\_KEY, count).apply()

        return if (count \>= MAX\_ATTEMPTS) {

            prefs.edit().putLong(LOCKOUT\_TIME\_KEY, System.currentTimeMillis()).apply()

            LockoutStatus.LOCKED\_OUT

        } else {

            LockoutStatus.WARNING(MAX\_ATTEMPTS \- count)

        }

    }

    /\*\* Verifica si el lockout sigue activo \*/

    fun getLockoutState(context: Context): LockoutState {

        val prefs \= getPrefs(context)

        val count \= prefs.getInt(LOCKOUT\_COUNT\_KEY, 0\)

        if (count \< MAX\_ATTEMPTS) return LockoutState.OPEN

        val lockTime \= prefs.getLong(LOCKOUT\_TIME\_KEY, 0L)

        val elapsed \= System.currentTimeMillis() \- lockTime

        return if (elapsed \< LOCKOUT\_DURATION\_MS) {

            LockoutState.LOCKED(remainingMs \= LOCKOUT\_DURATION\_MS \- elapsed)

        } else {

            // El lockout expiró: resetear contador

            prefs.edit().putInt(LOCKOUT\_COUNT\_KEY, 0).apply()

            LockoutState.OPEN

        }

    }

    fun resetAttempts(context: Context) {

        getPrefs(context).edit().remove(LOCKOUT\_COUNT\_KEY).remove(LOCKOUT\_TIME\_KEY).apply()

    }

}

sealed class LockoutStatus {

    object LOCKED\_OUT : LockoutStatus()

    data class WARNING(val remainingAttempts: Int) : LockoutStatus()

}

sealed class LockoutState {

    object OPEN : LockoutState()

    data class LOCKED(val remainingMs: Long) : LockoutState()

}

### 4.2 Manejo de Sesión (SessionManager.kt)

// security/SessionManager.kt

object SessionManager {

    private var sessionActive \= false

    fun openSession() { sessionActive \= true }

    fun closeSession() { sessionActive \= false }

    fun isActive(): Boolean \= sessionActive

}

// En LoginActivity.kt — cierre de sesión al salir

override fun onStop() {

    super.onStop()

    SessionManager.closeSession()

}

---

## 5\. Módulo de Políticas MDM (PolicyManager.kt)

// mdm/PolicyManager.kt

package com.ejemplo.locksuite.mdm

import android.app.admin.DevicePolicyManager

import android.content.ComponentName

import android.content.Context

import android.os.UserManager

class PolicyManager(context: Context) {

    private val dpm \= context.getSystemService(Context.DEVICE\_POLICY\_SERVICE) as DevicePolicyManager

    private val adminComponent \= ComponentName(context, DeviceAdminReceiver::class.java)

    // ─────────────────────────────────────────────

    // SECCIÓN A: POLÍTICAS DE SISTEMA

    // ─────────────────────────────────────────────

    fun setFactoryResetBlocked(block: Boolean) \=

        setRestriction(UserManager.DISALLOW\_FACTORY\_RESET, block)

    fun setInstallAppsBlocked(block: Boolean) \=

        setRestriction(UserManager.DISALLOW\_INSTALL\_APPS, block)

    fun setUninstallAppsBlocked(block: Boolean) \=

        setRestriction(UserManager.DISALLOW\_UNINSTALL\_APPS, block)

    fun setDebuggingFeaturesBlocked(block: Boolean) \=

        setRestriction(UserManager.DISALLOW\_DEBUGGING\_FEATURES, block)

    fun setUserSwitchBlocked(block: Boolean) \=

        setRestriction(UserManager.DISALLOW\_USER\_SWITCH, block)

    fun setModifyAccountsBlocked(block: Boolean) \=

        setRestriction(UserManager.DISALLOW\_MODIFY\_ACCOUNTS, block)

    fun setSafeBootBlocked(block: Boolean) \=

        setRestriction(UserManager.DISALLOW\_SAFE\_BOOT, block)

    fun setUnknownSourcesBlocked(block: Boolean) \=

        setRestriction(UserManager.DISALLOW\_INSTALL\_UNKNOWN\_SOURCES, block)

    fun setWifiConfigBlocked(block: Boolean) {

        setRestriction(UserManager.DISALLOW\_CONFIG\_WIFI, block)

        setRestriction(UserManager.DISALLOW\_NETWORK\_RESET, block)

        setRestriction("no\_config\_mobile\_networks", block) // constante interna

    }

    // ─────────────────────────────────────────────

    // SECCIÓN B: HARDWARE Y PANTALLA

    // ─────────────────────────────────────────────

    fun setCameraDisabled(disabled: Boolean) \=

        dpm.setCameraDisabled(adminComponent, disabled)

    fun setScreenCaptureBlocked(block: Boolean) \=

        setRestriction(UserManager.DISALLOW\_SCREEN\_CAPTURE, block)

    fun setStatusBarDisabled(disabled: Boolean) {

        if (android.os.Build.VERSION.SDK\_INT \>= android.os.Build.VERSION\_CODES.P) {

            dpm.setStatusBarDisabled(adminComponent, disabled)

        }

    }

    fun setKeyguardDisabled(disabled: Boolean) \=

        dpm.setKeyguardDisabled(adminComponent, disabled)

    fun setAdjustVolumeBlocked(block: Boolean) \=

        setRestriction(UserManager.DISALLOW\_ADJUST\_VOLUME, block)

    fun setAppsControlBlocked(block: Boolean) \=

        setRestriction(UserManager.DISALLOW\_APPS\_CONTROL, block)

    // ─────────────────────────────────────────────

    // SECCIÓN C: CONECTIVIDAD

    // ─────────────────────────────────────────────

    fun setBluetoothBlocked(block: Boolean) \=

        setRestriction(UserManager.DISALLOW\_BLUETOOTH, block)

    fun setBluetoothSharingBlocked(block: Boolean) \=

        setRestriction(UserManager.DISALLOW\_BLUETOOTH\_SHARING, block)

    fun setExternalMediaBlocked(block: Boolean) \=

        setRestriction(UserManager.DISALLOW\_MOUNT\_PHYSICAL\_MEDIA, block)

    fun setTetheringBlocked(block: Boolean) \=

        setRestriction(UserManager.DISALLOW\_TETHERING, block)

    fun setVpnConfigBlocked(block: Boolean) \=

        setRestriction(UserManager.DISALLOW\_CONFIG\_VPN, block)

    // ─────────────────────────────────────────────

    // HELPER PRIVADO

    // ─────────────────────────────────────────────

    private fun setRestriction(restriction: String, enable: Boolean) {

        if (enable) {

            dpm.addUserRestriction(adminComponent, restriction)

        } else {

            dpm.clearUserRestriction(adminComponent, restriction)

        }

    }

    /\*\* Aplica todas las restricciones según el estado guardado en prefs \*/

    fun reapplyAllRestrictions(context: Context) {

        val prefs \= context.getSharedPreferences("mdm\_state", Context.MODE\_PRIVATE)

        // Iterar sobre todas las restricciones guardadas y re-aplicarlas

        val allRestrictions \= mapOf(

            UserManager.DISALLOW\_FACTORY\_RESET to "block\_factory\_reset",

            UserManager.DISALLOW\_INSTALL\_APPS to "block\_install\_apps",

            UserManager.DISALLOW\_UNINSTALL\_APPS to "block\_uninstall\_apps",

            UserManager.DISALLOW\_DEBUGGING\_FEATURES to "block\_debugging",

            UserManager.DISALLOW\_SAFE\_BOOT to "block\_safe\_boot",

            UserManager.DISALLOW\_ADJUST\_VOLUME to "block\_volume"

            // ... agregar el resto

        )

        allRestrictions.forEach { (restriction, prefKey) \-\>

            if (prefs.getBoolean(prefKey, false)) {

                dpm.addUserRestriction(adminComponent, restriction)

            }

        }

    }

    /\*\* Purga total: elimina TODAS las restricciones aplicadas \*/

    fun clearAllRestrictions() {

        val restrictions \= listOf(

            UserManager.DISALLOW\_FACTORY\_RESET,

            UserManager.DISALLOW\_INSTALL\_APPS,

            UserManager.DISALLOW\_UNINSTALL\_APPS,

            UserManager.DISALLOW\_DEBUGGING\_FEATURES,

            UserManager.DISALLOW\_USER\_SWITCH,

            UserManager.DISALLOW\_MODIFY\_ACCOUNTS,

            UserManager.DISALLOW\_SAFE\_BOOT,

            UserManager.DISALLOW\_INSTALL\_UNKNOWN\_SOURCES,

            UserManager.DISALLOW\_CONFIG\_WIFI,

            UserManager.DISALLOW\_NETWORK\_RESET,

            UserManager.DISALLOW\_SCREEN\_CAPTURE,

            UserManager.DISALLOW\_ADJUST\_VOLUME,

            UserManager.DISALLOW\_APPS\_CONTROL,

            UserManager.DISALLOW\_BLUETOOTH,

            UserManager.DISALLOW\_BLUETOOTH\_SHARING,

            UserManager.DISALLOW\_MOUNT\_PHYSICAL\_MEDIA,

            UserManager.DISALLOW\_TETHERING,

            UserManager.DISALLOW\_CONFIG\_VPN

        )

        restrictions.forEach { dpm.clearUserRestriction(adminComponent, it) }

        dpm.setCameraDisabled(adminComponent, false)

        dpm.setKeyguardDisabled(adminComponent, false)

        if (android.os.Build.VERSION.SDK\_INT \>= android.os.Build.VERSION\_CODES.P) {

            dpm.setStatusBarDisabled(adminComponent, false)

        }

    }

}

---

## 6\. Módulo de Gestión de Aplicaciones (AppController.kt)

// mdm/AppController.kt

package com.ejemplo.locksuite.mdm

import android.app.admin.DevicePolicyManager

import android.content.ComponentName

import android.content.Context

import android.content.pm.ApplicationInfo

import android.content.pm.PackageManager

class AppController(context: Context) {

    private val dpm \= context.getSystemService(Context.DEVICE\_POLICY\_SERVICE) as DevicePolicyManager

    private val pm \= context.packageManager

    private val adminComponent \= ComponentName(context, DeviceAdminReceiver::class.java)

    /\*\* Oculta completamente la app (invisible \+ no consume recursos) \*/

    fun hideApp(packageName: String, hide: Boolean) {

        dpm.setApplicationHidden(adminComponent, packageName, hide)

    }

    /\*\* Suspende la app (ícono grisáceo, no se puede abrir) \*/

    fun suspendApp(packageName: String, suspend: Boolean) {

        val packages \= arrayOf(packageName)

        dpm.setPackagesSuspended(adminComponent, packages, suspend)

    }

    /\*\* Obtiene lista de apps del usuario (excluye sistema esencial \+ launchers) \*/

    fun getUserApps(): List\<AppInfo\> {

        val installedApps \= pm.getInstalledApplications(PackageManager.GET\_META\_DATA)

        val launcherPackages \= getLauncherPackages()

        val systemEssential \= setOf(

            "com.android.systemui", "com.android.settings",

            "com.android.phone", "com.ejemplo.locksuite"

        )

        return installedApps

            .filter { app \-\>

                val isUser \= (app.flags and ApplicationInfo.FLAG\_SYSTEM) \== 0

                val isNotLauncher \= app.packageName \!in launcherPackages

                val isNotEssential \= app.packageName \!in systemEssential

                isUser && isNotLauncher && isNotEssential

            }

            .map { app \-\>

                AppInfo(

                    packageName \= app.packageName,

                    label \= pm.getApplicationLabel(app).toString(),

                    icon \= pm.getApplicationIcon(app),

                    isHidden \= dpm.isApplicationHidden(adminComponent, app.packageName),

                    isSuspended \= (app.flags and ApplicationInfo.FLAG\_SUSPENDED) \!= 0

                )

            }

    }

    private fun getLauncherPackages(): Set\<String\> {

        val intent \= android.content.Intent(android.content.Intent.ACTION\_MAIN)

            .addCategory(android.content.Intent.CATEGORY\_HOME)

        return pm.queryIntentActivities(intent, 0\)

            .map { it.activityInfo.packageName }

            .toSet()

    }

}

data class AppInfo(

    val packageName: String,

    val label: String,

    val icon: android.graphics.drawable.Drawable,

    val isHidden: Boolean,

    val isSuspended: Boolean

)

---

## 7\. Módulo de Servicio de Accesibilidad

### 7.1 Implementación Principal

// service/LockSuiteAccessibilityService.kt

package com.ejemplo.locksuite.service

import android.accessibilityservice.AccessibilityService

import android.content.Context

import android.content.Intent

import android.graphics.PixelFormat

import android.view.Gravity

import android.view.WindowManager

import android.view.accessibility.AccessibilityEvent

import android.view.accessibility.AccessibilityNodeInfo

import android.widget.FrameLayout

import android.graphics.Color

class LockSuiteAccessibilityService : AccessibilityService() {

    private var overlayView: FrameLayout? \= null

    private val windowManager get() \= getSystemService(WINDOW\_SERVICE) as WindowManager

    // Paquetes monitoreados

    private val WHATSAPP\_PKG \= "com.whatsapp"

    private val DIDI\_PKG \= "com.didi.customer" // o el paquete correcto

    // Paquete de ajustes de accesibilidad

    private val SETTINGS\_PKG \= "com.android.settings"

    private val LOCKSUITE\_SETTINGS\_ID \= "com.ejemplo.locksuite"

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {

        val event \= event ?: return

        val packageName \= event.packageName?.toString() ?: return

        when (packageName) {

            WHATSAPP\_PKG \-\> handleWhatsApp(event)

            DIDI\_PKG \-\> handleDiDi(event)

            SETTINGS\_PKG \-\> handleSettingsAntiEvasion(event)

        }

    }

    // ─────────────────────────────────────────────

    // WHATSAPP: Bloquear pestaña "Novedades"

    // ─────────────────────────────────────────────

    private fun handleWhatsApp(event: AccessibilityEvent) {

        val prefs \= getSharedPreferences("app\_controls", Context.MODE\_PRIVATE)

        if (\!prefs.getBoolean("wa\_updates\_blocked", false)) return

        val root \= rootInActiveWindow ?: return

        if (isWhatsAppUpdatesTabActive(root)) {

            showBlockOverlay(Color.RED)

        } else {

            hideBlockOverlay()

        }

    }

    private fun isWhatsAppUpdatesTabActive(root: AccessibilityNodeInfo): Boolean {

        // Buscar por texto de la pestaña seleccionada

        val keywords \= listOf("novedades", "updates", "estados", "status")

        return searchNodeByText(root, keywords, selectedOnly \= true)

    }

    // ─────────────────────────────────────────────

    // DiDi: Bloquear entretenimiento fuera del mapa

    // ─────────────────────────────────────────────

    private fun handleDiDi(event: AccessibilityEvent) {

        val prefs \= getSharedPreferences("app\_controls", Context.MODE\_PRIVATE)

        if (\!prefs.getBoolean("didi\_entertainment\_blocked", false)) return

        val root \= rootInActiveWindow ?: return

        val entertainmentKeywords \= listOf("juego", "game", "video", "entretenimiento", "watch")

        if (searchNodeByText(root, entertainmentKeywords)) {

            showBlockOverlay(Color.RED)

        } else {

            hideBlockOverlay()

        }

    }

    // ─────────────────────────────────────────────

    // ANTI-EVASIÓN: Proteger ajustes de accesibilidad

    // ─────────────────────────────────────────────

    private fun handleSettingsAntiEvasion(event: AccessibilityEvent) {

        val root \= rootInActiveWindow ?: return

        // Detectar si estamos en los ajustes de LockSuite específicamente

        val isInLockSuiteSettings \= searchNodeByText(

            root,

            listOf("locksuite", "lock suite", LOCKSUITE\_SETTINGS\_ID)

        )

        if (\!isInLockSuiteSettings) return

        // Detectar si el usuario intenta presionar "Desactivar" o "Forzar detención"

        val dangerousActions \= listOf(

            "desactivar", "turn off", "disable",

            "forzar detención", "force stop", "deshabilitar"

        )

        val userPressingDanger \= searchNodeByText(root, dangerousActions)

        if (userPressingDanger || event.eventType \== AccessibilityEvent.TYPE\_VIEW\_CLICKED) {

            // 1\. Presionar atrás automáticamente

            performGlobalAction(GLOBAL\_ACTION\_BACK)

            // 2\. Lanzar LockSuite requiriendo PIN (con pequeño delay)

            android.os.Handler(mainLooper).postDelayed({

                val intent \= Intent(this, com.ejemplo.locksuite.ui.auth.LoginActivity::class.java)

                    .addFlags(Intent.FLAG\_ACTIVITY\_NEW\_TASK or Intent.FLAG\_ACTIVITY\_CLEAR\_TOP)

                startActivity(intent)

            }, 300\)

        }

    }

    // ─────────────────────────────────────────────

    // HELPERS: Overlay y búsqueda de nodos

    // ─────────────────────────────────────────────

    private fun showBlockOverlay(color: Int) {

        if (overlayView \!= null) return // Ya existe

        overlayView \= FrameLayout(this).apply {

            setBackgroundColor(color)

            alpha \= 0.92f

        }

        val params \= WindowManager.LayoutParams(

            WindowManager.LayoutParams.MATCH\_PARENT,

            WindowManager.LayoutParams.MATCH\_PARENT,

            WindowManager.LayoutParams.TYPE\_ACCESSIBILITY\_OVERLAY,

            WindowManager.LayoutParams.FLAG\_NOT\_FOCUSABLE or

                    WindowManager.LayoutParams.FLAG\_NOT\_TOUCHABLE or

                    WindowManager.LayoutParams.FLAG\_LAYOUT\_IN\_SCREEN,

            PixelFormat.TRANSLUCENT

        ).apply {

            gravity \= Gravity.TOP or Gravity.START

        }

        windowManager.addView(overlayView, params)

    }

    private fun hideBlockOverlay() {

        overlayView?.let {

            windowManager.removeView(it)

            overlayView \= null

        }

    }

    private fun searchNodeByText(

        root: AccessibilityNodeInfo,

        keywords: List\<String\>,

        selectedOnly: Boolean \= false

    ): Boolean {

        val text \= root.text?.toString()?.lowercase() ?: ""

        val desc \= root.contentDescription?.toString()?.lowercase() ?: ""

        val matchesKeyword \= keywords.any { keyword \-\>

            text.contains(keyword) || desc.contains(keyword)

        }

        val matchesSelection \= \!selectedOnly || root.isSelected || root.isChecked

        if (matchesKeyword && matchesSelection) return true

        for (i in 0 until root.childCount) {

            val child \= root.getChild(i) ?: continue

            if (searchNodeByText(child, keywords, selectedOnly)) return true

        }

        return false

    }

    override fun onInterrupt() {

        hideBlockOverlay()

    }

    override fun onDestroy() {

        super.onDestroy()

        hideBlockOverlay()

    }

}

---

## 8\. Módulo Anti-Evasión y Persistencia

### 8.1 Boot Receiver

// receiver/BootReceiver.kt

package com.ejemplo.locksuite.receiver

import android.content.BroadcastReceiver

import android.content.Context

import android.content.Intent

import com.ejemplo.locksuite.mdm.PolicyManager

import com.ejemplo.locksuite.service.WatchdogForegroundService

class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {

        val action \= intent.action

        if (action \!= Intent.ACTION\_BOOT\_COMPLETED &&

            action \!= "android.intent.action.LOCKED\_BOOT\_COMPLETED") return

        // 1\. Re-aplicar todas las restricciones MDM

        PolicyManager(context).reapplyAllRestrictions(context)

        // 2\. Iniciar el servicio watchdog en primer plano

        val watchdogIntent \= Intent(context, WatchdogForegroundService::class.java)

        if (android.os.Build.VERSION.SDK\_INT \>= android.os.Build.VERSION\_CODES.O) {

            context.startForegroundService(watchdogIntent)

        } else {

            context.startService(watchdogIntent)

        }

        // 3\. Si el modo kiosco estaba activo, relanzar la actividad principal

        val prefs \= context.getSharedPreferences("mdm\_state", Context.MODE\_PRIVATE)

        if (prefs.getBoolean("kiosk\_mode", false)) {

            val kioskIntent \= Intent(context, com.ejemplo.locksuite.ui.auth.LoginActivity::class.java)

                .addFlags(

                    Intent.FLAG\_ACTIVITY\_NEW\_TASK or

                    Intent.FLAG\_ACTIVITY\_CLEAR\_TASK or

                    Intent.FLAG\_ACTIVITY\_NO\_HISTORY

                )

            context.startActivity(kioskIntent)

        }

    }

}

### 8.2 Watchdog (ForegroundService \+ WorkManager)

// service/WatchdogForegroundService.kt

package com.ejemplo.locksuite.service

import android.app.\*

import android.content.Intent

import android.os.IBinder

import androidx.core.app.NotificationCompat

import androidx.work.\*

import java.util.concurrent.TimeUnit

class WatchdogForegroundService : Service() {

    companion object {

        const val NOTIFICATION\_ID \= 9001

        const val CHANNEL\_ID \= "locksuite\_watchdog"

    }

    override fun onCreate() {

        super.onCreate()

        createNotificationChannel()

        startForeground(NOTIFICATION\_ID, buildNotification())

        scheduleWorkManagerWatchdog()

    }

    private fun buildNotification(): Notification {

        return NotificationCompat.Builder(this, CHANNEL\_ID)

            .setContentTitle("Servicio del Sistema")

            .setContentText("Protección activa")

            .setSmallIcon(android.R.drawable.ic\_lock\_lock)

            .setPriority(NotificationCompat.PRIORITY\_MIN)

            .setOngoing(true)

            .build()

    }

    private fun createNotificationChannel() {

        if (android.os.Build.VERSION.SDK\_INT \>= android.os.Build.VERSION\_CODES.O) {

            val channel \= NotificationChannel(

                CHANNEL\_ID,

                "Servicio Sistema",

                NotificationManager.IMPORTANCE\_MIN

            ).apply { setShowBadge(false) }

            getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)

        }

    }

    private fun scheduleWorkManagerWatchdog() {

        val workRequest \= PeriodicWorkRequestBuilder\<WatchdogWorker\>(15, TimeUnit.MINUTES)

            .setConstraints(Constraints.Builder()

                .setRequiredNetworkType(NetworkType.NOT\_REQUIRED)

                .build())

            .build()

        WorkManager.getInstance(this).enqueueUniquePeriodicWork(

            "LockSuiteWatchdog",

            ExistingPeriodicWorkPolicy.KEEP,

            workRequest

        )

    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {

        return START\_STICKY // El sistema lo reinicia si es eliminado

    }

    override fun onBind(intent: Intent?): IBinder? \= null

}

// worker/WatchdogWorker.kt

class WatchdogWorker(context: Context, params: WorkerParameters) : Worker(context, params) {

    override fun doWork(): Result {

        // Verificar y re-aplicar restricciones críticas

        PolicyManager(applicationContext).reapplyAllRestrictions(applicationContext)

        // Verificar que el ForegroundService siga corriendo

        val serviceIntent \= Intent(applicationContext, WatchdogForegroundService::class.java)

        if (android.os.Build.VERSION.SDK\_INT \>= android.os.Build.VERSION\_CODES.O) {

            applicationContext.startForegroundService(serviceIntent)

        }

        return Result.success()

    }

}

### 8.3 Modo Stealth (LauncherAlias)

// En DashboardActivity o en PoliciesFragment

fun setStealthMode(context: Context, enabled: Boolean) {

    val pm \= context.packageManager

    val aliasComponent \= ComponentName(context, "com.ejemplo.locksuite.LauncherAlias")

    val state \= if (enabled) {

        PackageManager.COMPONENT\_ENABLED\_STATE\_DISABLED

    } else {

        PackageManager.COMPONENT\_ENABLED\_STATE\_ENABLED

    }

    pm.setComponentEnabledSetting(

        aliasComponent,

        state,

        PackageManager.DONT\_KILL\_APP

    )

}

### 8.4 Secret Code Receiver

// receiver/SecretCodeReceiver.kt

package com.ejemplo.locksuite.receiver

import android.content.BroadcastReceiver

import android.content.Context

import android.content.Intent

class SecretCodeReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {

        val host \= intent.data?.host ?: return

        when (host) {

            "1234" \-\> {

                // Abrir la app (modo stealth)

                val appIntent \= Intent(context, com.ejemplo.locksuite.ui.auth.LoginActivity::class.java)

                    .addFlags(Intent.FLAG\_ACTIVITY\_NEW\_TASK)

                context.startActivity(appIntent)

            }

            "9999" \-\> {

                // Abrir pantalla de emergencia

                val emergencyIntent \= Intent(context, com.ejemplo.locksuite.ui.emergency.EmergencyActivity::class.java)

                    .addFlags(Intent.FLAG\_ACTIVITY\_NEW\_TASK)

                context.startActivity(emergencyIntent)

            }

        }

    }

}

---

## 9\. Sistema de Escape de Emergencia

// ui/emergency/EmergencyActivity.kt

package com.ejemplo.locksuite.ui.emergency

import android.app.admin.DevicePolicyManager

import android.content.ComponentName

import android.content.Context

import android.os.Bundle

import androidx.appcompat.app.AppCompatActivity

import com.ejemplo.locksuite.mdm.PolicyManager

import com.ejemplo.locksuite.security.PinManager

import com.ejemplo.locksuite.receiver.DeviceAdminReceiver

class EmergencyActivity : AppCompatActivity() {

    private val dpm by lazy {

        getSystemService(Context.DEVICE\_POLICY\_SERVICE) as DevicePolicyManager

    }

    private val adminComponent by lazy {

        ComponentName(this, DeviceAdminReceiver::class.java)

    }

    override fun onCreate(savedInstanceState: Bundle?) {

        super.onCreate(savedInstanceState)

        // setContentView(R.layout.activity\_emergency) — Pantalla roja

    }

    fun onEmergencyPinSubmitted(inputPin: String) {

        if (PinManager.verifyMasterPin(inputPin)) {

            executePurge()

        } else {

            // Mostrar error — no implementar lockout aquí para no bloquear al admin

        }

    }

    private fun executePurge() {

        val policyManager \= PolicyManager(this)

        // 1\. Limpiar paquetes de modo Kiosco

        if (android.os.Build.VERSION.SDK\_INT \>= android.os.Build.VERSION\_CODES.LOLLIPOP) {

            dpm.setLockTaskPackages(adminComponent, emptyArray())

        }

        // 2\. Limpiar TODAS las restricciones

        policyManager.clearAllRestrictions()

        // 3\. Restaurar modo stealth (mostrar ícono)

        setStealthMode(false)

        // 4\. Restaurar barra de estado

        if (android.os.Build.VERSION.SDK\_INT \>= android.os.Build.VERSION\_CODES.P) {

            dpm.setStatusBarDisabled(adminComponent, false)

        }

        // 5\. Revocar Device Owner — ACCIÓN IRREVERSIBLE SIN REINSTALACIÓN

        dpm.clearDeviceOwnerApp(packageName)

        // 6\. Cerrar la actividad

        finishAffinity()

    }

    private fun setStealthMode(enabled: Boolean) {

        val aliasComponent \= ComponentName(this, "com.ejemplo.locksuite.LauncherAlias")

        packageManager.setComponentEnabledSetting(

            aliasComponent,

            if (enabled) android.content.pm.PackageManager.COMPONENT\_ENABLED\_STATE\_DISABLED

            else android.content.pm.PackageManager.COMPONENT\_ENABLED\_STATE\_ENABLED,

            android.content.pm.PackageManager.DONT\_KILL\_APP

        )

    }

}

---

## 10\. Integración Firebase (Control Remoto)

### 10.1 FCM — Procesamiento de Comandos Remotos

// service/LockSuiteFirebaseService.kt

package com.ejemplo.locksuite.service

import com.google.firebase.messaging.FirebaseMessagingService

import com.google.firebase.messaging.RemoteMessage

import com.ejemplo.locksuite.mdm.PolicyManager

class LockSuiteFirebaseService : FirebaseMessagingService() {

    override fun onMessageReceived(message: RemoteMessage) {

        val data \= message.data

        val command \= data\["command"\] ?: return

        val policyManager \= PolicyManager(this)

        when (command) {

            "LOCK\_DEVICE" \-\> {

                // Bloquear pantalla inmediatamente

                val dpm \= getSystemService(DEVICE\_POLICY\_SERVICE) as android.app.admin.DevicePolicyManager

                dpm.lockNow()

            }

            "BLOCK\_INSTALL\_APPS" \-\> policyManager.setInstallAppsBlocked(true)

            "UNBLOCK\_INSTALL\_APPS" \-\> policyManager.setInstallAppsBlocked(false)

            "BLOCK\_WIFI" \-\> policyManager.setWifiConfigBlocked(true)

            "ENABLE\_STEALTH" \-\> setStealthMode(true)

            "FULL\_PURGE" \-\> {

                // Verificar firma del comando antes de purgar

                val signature \= data\["signature"\] ?: return

                if (isValidSignature(signature)) {

                    // Iniciar actividad de emergencia sin PIN (solo desde servidor confiable)

                }

            }

        }

    }

    private fun isValidSignature(signature: String): Boolean {

        // Implementar verificación HMAC con secret compartido

        return true // Placeholder

    }

    override fun onNewToken(token: String) {

        // Enviar nuevo token FCM a la base de datos Firebase

        com.google.firebase.database.FirebaseDatabase.getInstance()

            .getReference("devices/${getDeviceId()}/fcmToken")

            .setValue(token)

    }

    private fun getDeviceId(): String \=

        android.provider.Settings.Secure.getString(contentResolver,

            android.provider.Settings.Secure.ANDROID\_ID)

    private fun setStealthMode(enabled: Boolean) {

        val aliasComponent \= android.content.ComponentName(this,

            "com.ejemplo.locksuite.LauncherAlias")

        packageManager.setComponentEnabledSetting(

            aliasComponent,

            if (enabled) android.content.pm.PackageManager.COMPONENT\_ENABLED\_STATE\_DISABLED

            else android.content.pm.PackageManager.COMPONENT\_ENABLED\_STATE\_ENABLED,

            android.content.pm.PackageManager.DONT\_KILL\_APP

        )

    }

}

### 10.2 Registro de Estado en Realtime Database

// Guardar estado actual del dispositivo en Firebase

fun syncStateToFirebase(context: Context) {

    val deviceId \= android.provider.Settings.Secure.getString(

        context.contentResolver, android.provider.Settings.Secure.ANDROID\_ID)

    val deviceState \= mapOf(

        "deviceId" to deviceId,

        "model" to android.os.Build.MODEL,

        "lastSeen" to System.currentTimeMillis(),

        "restrictions" to getCurrentRestrictionsMap(context)

    )

    com.google.firebase.database.FirebaseDatabase.getInstance()

        .getReference("devices/$deviceId")

        .setValue(deviceState)

}

---

## 11\. Dependencias del Proyecto (app/build.gradle.kts)

dependencies {

    // Android Core

    implementation("androidx.core:core-ktx:1.12.0")

    implementation("androidx.appcompat:appcompat:1.6.1")

    implementation("com.google.android.material:material:1.11.0")

    implementation("androidx.constraintlayout:constraintlayout:2.1.4")

    // Security (EncryptedSharedPreferences)

    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // WorkManager (watchdog)

    implementation("androidx.work:work-runtime-ktx:2.9.0")

    // Lifecycle (viewmodel, livedata)

    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.7.0")

    implementation("androidx.lifecycle:lifecycle-livedata-ktx:2.7.0")

    // Firebase (BoM — versiones unificadas)

    implementation(platform("com.google.firebase:firebase-bom:32.8.0"))

    implementation("com.google.firebase:firebase-analytics-ktx")

    implementation("com.google.firebase:firebase-database-ktx")

    implementation("com.google.firebase:firebase-messaging-ktx")

    // Coroutines

    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")

}

---

## 12\. Checklist de Implementación por Orden de Prioridad

### Fase 1 — Fundamentos (Semana 1-2)

- [ ] Crear proyecto con package name `com.ejemplo.locksuite`  
- [ ] Configurar `DeviceAdminReceiver` y archivo XML de políticas  
- [ ] Implementar `PinManager` con SHA-256 \+ salt  
- [ ] Implementar `LoginActivity` con brute-force protection  
- [ ] Probar provisioning como Device Owner vía ADB  
- [ ] Verificar que `DevicePolicyManager.isDeviceOwnerApp()` retorna `true`

### Fase 2 — Políticas MDM (Semana 2-3)

- [ ] Implementar `PolicyManager` con todas las restricciones  
- [ ] Construir UI del panel (switches para cada política)  
- [ ] Persistir estado de restricciones en SharedPreferences  
- [ ] Probar cada restricción en dispositivo físico

### Fase 3 — Gestión de Apps (Semana 3-4)

- [ ] Implementar `AppController` con listado dinámico  
- [ ] Construir `AppManagerFragment` con RecyclerView  
- [ ] Implementar hide/suspend por app individual  
- [ ] Probar con 10+ apps de usuario

### Fase 4 — Persistencia (Semana 4\)

- [ ] Implementar `BootReceiver` y verificar re-aplicación de políticas  
- [ ] Implementar `WatchdogForegroundService`  
- [ ] Configurar `WorkManager` recurrente  
- [ ] Prueba: reiniciar el dispositivo y verificar que todo persiste

### Fase 5 — Accesibilidad y Anti-Evasión (Semana 5-6)

- [ ] Implementar `LockSuiteAccessibilityService`  
- [ ] Implementar filtro de WhatsApp Updates  
- [ ] Implementar filtro de DiDi  
- [ ] Implementar auto-back en ajustes de accesibilidad  
- [ ] Prueba exhaustiva del anti-evasión

### Fase 6 — Stealth y Emergency (Semana 6\)

- [ ] Implementar `SecretCodeReceiver` para `*#*#1234#*#*`  
- [ ] Implementar modo stealth con LauncherAlias  
- [ ] Implementar `EmergencyActivity` con purga total  
- [ ] Verificar que `clearDeviceOwnerApp` libera el dispositivo correctamente

### Fase 7 — Firebase y Testing (Semana 7-8)

- [ ] Configurar proyecto en Firebase Console  
- [ ] Implementar `LockSuiteFirebaseService` para FCM  
- [ ] Implementar sincronización de estado a Realtime Database  
- [ ] Ejecutar **todos los casos** del Testing Checklist del spec  
- [ ] Prueba de penetración completa

---

## 13\. Puntos Técnicos Críticos a No Olvidar

**1\. El Servicio de Accesibilidad es frágil ante actualizaciones de apps.** WhatsApp y DiDi actualizan sus IDs de recursos frecuentemente. El monitoreo debe basarse en texto visible y semántica, no en resource IDs hardcodeados.

**2\. `clearDeviceOwnerApp` es irreversible sin re-provisioning.** Una vez ejecutado, para volver a ser Device Owner hay que hacer ADB setup o NFC provisioning nuevamente desde cero.

**3\. En Android 10+ (API 29+), las restricciones de background son más estrictas.** El `ForegroundService` con `foregroundServiceType="specialUse"` es necesario y debe declararse en el manifiesto. En Android 14 (API 34\) se requiere permiso en runtime.

**4\. `setStatusBarDisabled` solo funciona como Device Owner.** No funciona como simple Device Admin. Verificar siempre `dpm.isDeviceOwnerApp(packageName)` antes de llamarlo.

**5\. Modo Kiosco (Lock Task) tiene limitaciones.** Si `setLockTaskPackages` solo incluye la app MDM, el usuario queda completamente atrapado. Siempre incluir la app de teléfono de emergencias en la lista de paquetes kiosco.

**6\. El hash del PIN Maestro DEBE cambiarse antes de producción.** El valor en `Constants.kt` es un placeholder. Generar el hash real:

echo \-n "SALT\_ESTATICO\_2024\_LStu\_pin\_maestro" | sha256sum

**7\. Firebase Realtime Database necesita reglas de seguridad.** Por defecto, las reglas abiertas son peligrosas. Configurar autenticación Firebase antes de desplegar en producción.

---

## 14\. Recursos y Referencias Oficiales

- [Android Enterprise — Device Owner Guide](https://developer.android.com/work/device-admin)  
- [DevicePolicyManager API Reference](https://developer.android.com/reference/android/app/admin/DevicePolicyManager)  
- [AccessibilityService Guide](https://developer.android.com/guide/topics/ui/accessibility/service)  
- [Android Enterprise Solutions Directory](https://androidenterprisepartners.withgoogle.com/)  
- [Firebase Android Setup](https://firebase.google.com/docs/android/setup)  
- [WorkManager Guide](https://developer.android.com/topic/libraries/architecture/workmanager)

