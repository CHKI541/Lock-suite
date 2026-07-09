# LockSuite Kosher — Dossier Completo de Diagnóstico y Código

Este documento contiene la **arquitectura detallada** y el **código completo de todos los componentes** (Frontend Web, Cloud Functions, Reglas de Firebase y Aplicación Android Kotlin) involucrados en el control remoto y sincronización de dispositivos de **LockSuite Kosher**.

---

## 1. Resumen de Correcciones Aplicadas (2026-07-07)

Hemos corregido los siguientes problemas de compatibilidad y lógica que impedían la sincronización o generaban errores al enviar comandos:

1.  **Doble Escritura de Esquema en Kotlin (`FirebaseDeviceSync.kt`)**: 
    La app móvil ahora escribe todos los campos de estado y la lista de aplicaciones tanto en el nuevo esquema de la raíz (`devices/{deviceId}/`) como en el esquema de compatibilidad heredado (`devices/{deviceId}/info/`).
2.  **Lectura Robusta en Cloud Functions (`index.js`)**: 
    La función `sendCommandV2` ahora utiliza el helper `getDeviceField` que intenta leer el token FCM y las credenciales de PIN de la raíz y cae automáticamente al nodo `info/` si no están en la raíz, asegurando compatibilidad del 100% con teléfonos con versiones viejas y nuevas.
3.  **Normalización de Lecturas en el Frontend (`app.js`)**:
    *   Se implementó la función `field()` para resolver propiedades de la raíz o de `info/`.
    *   Se solucionó el bug donde las aplicaciones no se listaban en teléfonos viejos porque no leía de `info/apps`.
    *   Se corrigió el error en los booleanos que usaban `||`, cambiando a verificaciones explícitas de igualdad `=== true`.
    *   Se corrigieron los textos de los botones de suspensión y se agregó un cuadro de diálogo de confirmación para permitir vaciar la lista de aplicaciones permitidas (`allowedPackages`) de forma segura.
    *   Se agregó la clase de estado `"Sin FCM"` para diferenciar dispositivos que están conectados pero no pueden recibir notificaciones push.
4.  **Confirmación de Comandos (Command ACK)**:
    *   Cloud Functions ahora genera un `commandId` (UUID) y lo envía en el data payload de FCM.
    *   `LockSuiteFirebaseService.kt` recibe el `commandId`, ejecuta la política y escribe el resultado (`applied` / `failed`) en `devices/{deviceId}/commandAcks/{commandId}`.

---

## 2. Códigos del Panel Web (Frontend)

### 📄 index.html
Ubicación: `admin-backend/public/index.html`
```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>LockSuite Kosher — Panel de administración</title>
  <link rel="stylesheet" href="styles.css?v=2" />
</head>
<body>

  <div id="login-screen" class="screen">
    <div class="card login-card">
      <h1>LockSuite <span class="accent">Kosher</span></h1>
      <p class="subtitle">Panel de administración remota</p>
      <input type="email" id="email-input" placeholder="Email" autocomplete="username" />
      <input type="password" id="password-input" placeholder="Contraseña" autocomplete="current-password" />
      <button id="login-button">Iniciar sesión</button>
      
      <div class="divider"><span>o</span></div>
      
      <button id="google-login-button" class="google-btn">
        <svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.77c-.98.66-2.23 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
        </svg>
        Iniciar sesión con Google
      </button>

      <p id="login-error" class="error-text"></p>
      <p class="hint">Las cuentas de administrador se crean desde Firebase Console → Authentication.</p>
    </div>
  </div>

  <div id="dashboard-screen" class="screen hidden">
    <div class="dashboard-layout">
      <div class="main-content">
        <header>
          <h1>LockSuite <span class="accent">Kosher</span></h1>
          <div class="header-actions">
            <button id="refresh-button" class="secondary">Actualizar</button>
            <button id="logout-button" class="secondary">Cerrar sesión</button>
          </div>
        </header>
        <p id="global-error" class="error-text"></p>
        <main id="devices-container">
          <p class="loading-text">Cargando dispositivos…</p>
        </main>
      </div>
      
      <!-- Sidebar de administración de dispositivo -->
      <div id="device-sidebar" class="sidebar hidden">
        <div class="sidebar-header">
          <div>
            <h2 id="sidebar-device-name">Cargando...</h2>
            <p id="sidebar-device-id" class="device-id"></p>
          </div>
          <button id="sidebar-close-btn" class="close-btn">&times;</button>
        </div>

        <div class="sidebar-tabs">
          <button class="tab-btn active" data-tab="panel-policies">Políticas</button>
          <button class="tab-btn" data-tab="panel-apps">Aplicaciones</button>
          <button class="tab-btn" data-tab="panel-actions">Acciones</button>
        </div>

        <div class="sidebar-content">
          <!-- Pestaña 1: Políticas -->
          <div id="panel-policies" class="tab-panel active">
            <!-- Nombre del celular -->
            <div class="sidebar-card">
              <h3>Identificación</h3>
              <div class="input-group">
                <input type="text" id="device-name-input" placeholder="Nombre personalizado (ej: Celular Eli)" />
                <button id="save-name-btn" class="action-btn">Guardar</button>
              </div>
            </div>

            <!-- Políticas de Sistema -->
            <div class="sidebar-card">
              <h3>Políticas de Sistema (Device Owner)</h3>
              <div class="toggle-list">
                <label class="toggle-row"><span>Bloquear Restauración de Fábrica</span><input type="checkbox" class="policy-switch" data-policy="factoryResetBlocked" /></label>
                <label class="toggle-row"><span>Bloquear Instalación de Apps</span><input type="checkbox" class="policy-switch" data-policy="installAppsBlocked" /></label>
                <label class="toggle-row"><span>Bloquear Desinstalación de Apps</span><input type="checkbox" class="policy-switch" data-policy="uninstallAppsBlocked" /></label>
                <label class="toggle-row"><span>Bloquear ADB y Opciones de Desarrollador</span><input type="checkbox" class="policy-switch" data-policy="adbBlocked" /></label>
                <label class="toggle-row"><span>Bloquear Cambio de Usuario</span><input type="checkbox" class="policy-switch" data-policy="userSwitchBlocked" /></label>
                <label class="toggle-row"><span>Bloquear Modificación de Cuentas</span><input type="checkbox" class="policy-switch" data-policy="modifyAccountsBlocked" /></label>
                <label class="toggle-row"><span>Bloquear Reinicio Seguro (Safe Boot)</span><input type="checkbox" class="policy-switch" data-policy="safeBootBlocked" /></label>
                <label class="toggle-row"><span>Bloquear Orígenes Desconocidos (APK)</span><input type="checkbox" class="policy-switch" data-policy="unknownSourcesBlocked" /></label>
                <label class="toggle-row"><span>Bloquear Ajustes de Red / WiFi / Datos</span><input type="checkbox" class="policy-switch" data-policy="wifiBlocked" /></label>
                <label class="toggle-row"><span>Bloquear Ajustes de VPN</span><input type="checkbox" class="policy-switch" data-policy="vpnBlocked" /></label>
                <label class="toggle-row"><span>Bloquear Control de Apps</span><input type="checkbox" class="policy-switch" data-policy="appsControlBlocked" /></label>
                <label class="toggle-row"><span>Bloquear Ajuste de Volumen</span><input type="checkbox" class="policy-switch" data-policy="adjustVolumeBlocked" /></label>
              </div>
            </div>

            <!-- Control de Hardware y Pantalla -->
            <div class="sidebar-card">
              <h3>Control de Hardware y Pantalla</h3>
              <div class="toggle-list">
                <label class="toggle-row"><span>Deshabilitar Cámara Física</span><input type="checkbox" class="policy-switch" data-policy="cameraDisabled" /></label>
                <label class="toggle-row"><span>Bloquear Captura de Pantalla</span><input type="checkbox" class="policy-switch" data-policy="screenCaptureBlocked" /></label>
                <label class="toggle-row"><span>Deshabilitar Barra de Estado</span><input type="checkbox" class="policy-switch" data-policy="statusBarDisabled" /></label>
                <label class="toggle-row"><span>Deshabilitar Bloqueo de Pantalla (Keyguard)</span><input type="checkbox" class="policy-switch" data-policy="keyguardDisabled" /></label>
              </div>
            </div>

            <!-- Conectividad y Filtros -->
            <div class="sidebar-card">
              <h3>Conectividad y Filtros</h3>
              <div class="toggle-list">
                <label class="toggle-row"><span>Bloquear Todo el Internet</span><input type="checkbox" class="policy-switch" data-policy="internetBlocked" /></label>
                <label class="toggle-row"><span>Bloquear Bluetooth</span><input type="checkbox" class="policy-switch" data-policy="bluetoothBlocked" /></label>
                <label class="toggle-row"><span>Bloquear Compartir por Bluetooth</span><input type="checkbox" class="policy-switch" data-policy="bluetoothSharingBlocked" /></label>
                <label class="toggle-row"><span>Bloquear Montaje de Medios Externos</span><input type="checkbox" class="policy-switch" data-policy="externalMediaBlocked" /></label>
                <label class="toggle-row"><span>Bloquear Zona WiFi / Tethering</span><input type="checkbox" class="policy-switch" data-policy="tetheringBlocked" /></label>
                <label class="toggle-row"><span>Filtro de Anuncios DNS (AdBlock)</span><input type="checkbox" class="policy-switch" data-policy="adBlockingEnabled" /></label>
              </div>
            </div>
          </div>

          <!-- Pestaña 2: Aplicaciones -->
          <div id="panel-apps" class="tab-panel">
            <!-- Google Play Store (Control Separado Principal) -->
            <div class="sidebar-card playstore-card">
              <div class="playstore-header">
                <h3>Google Play Store</h3>
                <span class="badge kiosk-badge active">Control Principal</span>
              </div>
              <div class="toggle-list">
                <label class="toggle-row"><span>Bloqueo Total (Ocultar)</span><input type="checkbox" id="playstore-hidden" /></label>
                <label class="toggle-row"><span>Suspensión</span><input type="checkbox" id="playstore-suspended" /></label>
              </div>
            </div>

            <!-- Buscador de Apps -->
            <div class="search-box">
              <input type="text" id="app-search-input" placeholder="Buscar app por nombre o paquete..." />
            </div>

            <!-- Contenedor de lista de apps instaladas -->
            <div id="sidebar-apps-list" class="apps-list-container">
              <p class="loading-text">Cargando aplicaciones del dispositivo…</p>
            </div>

            <!-- Campo de paquetes permitidos -->
            <div class="sidebar-card">
              <h3>Apps permitidas (paquetes separados por coma)</h3>
              <textarea id="sidebar-allowlist-input" rows="2" placeholder="com.whatsapp, com.android.dialer"></textarea>
              <button id="sidebar-allowlist-btn" class="action-btn secondary">Actualizar lista</button>
            </div>
          </div>

          <!-- Pestaña 3: Acciones -->
          <div id="panel-actions" class="tab-panel">
            <div class="sidebar-card">
              <h3>Comandos Directos</h3>
              <button id="sidebar-lock-btn" class="action-btn lock-btn">🔒 Bloquear dispositivo ahora</button>
            </div>
            <div class="sidebar-card">
              <h3>Seguridad y PIN</h3>
              <p id="sidebar-trust-status"></p>
              <button id="sidebar-forget-pin-btn" class="action-btn secondary">Olvidar confianza del PIN</button>
            </div>
          </div>
          
          <p id="sidebar-status-msg" class="card-status"></p>
        </div>
      </div>
    </div>
  </div>

  <!-- Plantilla de una tarjeta de dispositivo (se clona por JS) -->
  <template id="device-card-template">
    <div class="card device-card">
      <div class="device-header">
        <div>
          <h2 class="device-name"></h2>
          <p class="device-model-label"></p>
          <p class="device-id"></p>
        </div>
        <span class="badge status-badge"></span>
      </div>
      <p class="last-seen"></p>
      <div class="card-action-bar">
        <button class="action-btn view-details-btn">⚙️ Administrar Celular</button>
      </div>
    </div>
  </template>

  <!-- Modal de PIN -->
  <div id="pin-modal" class="modal-overlay hidden">
    <div class="card modal-card">
      <h2>PIN de administrador del celular</h2>
      <p class="modal-device-name subtitle"></p>
      <input type="password" id="pin-modal-input" placeholder="PIN configurado en ese celular" autocomplete="off" inputmode="numeric" />
      <label class="toggle-row remember-row">
        <span>No volver a pedirlo en este dispositivo</span>
        <input type="checkbox" id="pin-modal-remember" />
      </label>
      <p id="pin-modal-error" class="error-text"></p>
      <div class="modal-actions">
        <button id="pin-modal-cancel" class="secondary">Cancelar</button>
        <button id="pin-modal-confirm">Confirmar</button>
      </div>
    </div>
  </div>

  <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-functions-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js"></script>
  <script src="firebase-config.js"></script>
  <script src="app.js?v=2"></script>
</body>
</html>
```

---

### 📄 app.js (Corregido y optimizado)
Ubicación: `admin-backend/public/app.js`
```javascript
const auth = firebase.auth(),
    database = firebase.database(),
    functionsRef = firebase.functions(),
    loginScreen = document.getElementById("login-screen"),
    dashboardScreen = document.getElementById("dashboard-screen"),
    emailInput = document.getElementById("email-input"),
    passwordInput = document.getElementById("password-input"),
    loginButton = document.getElementById("login-button"),
    googleLoginButton = document.getElementById("google-login-button"),
    loginError = document.getElementById("login-error"),
    logoutButton = document.getElementById("logout-button"),
    refreshButton = document.getElementById("refresh-button"),
    devicesContainer = document.getElementById("devices-container"),
    globalError = document.getElementById("global-error"),
    cardTemplate = document.getElementById("device-card-template"),
    sidebar = document.getElementById("device-sidebar"),
    sidebarCloseBtn = document.getElementById("sidebar-close-btn"),
    sidebarDeviceName = document.getElementById("sidebar-device-name"),
    sidebarDeviceId = document.getElementById("sidebar-device-id"),
    sidebarTabButtons = document.querySelectorAll(".sidebar-tabs .tab-btn"),
    sidebarTabPanels = document.querySelectorAll(".tab-panel"),
    deviceNameInput = document.getElementById("device-name-input"),
    saveNameBtn = document.getElementById("save-name-btn"),
    sidebarAppsList = document.getElementById("sidebar-apps-list"),
    appSearchInput = document.getElementById("app-search-input"),
    sidebarAllowlistInput = document.getElementById("sidebar-allowlist-input"),
    sidebarAllowlistBtn = document.getElementById("sidebar-allowlist-btn"),
    sidebarLockBtn = document.getElementById("sidebar-lock-btn"),
    sidebarTrustStatus = document.getElementById("sidebar-trust-status"),
    sidebarForgetPinBtn = document.getElementById("sidebar-forget-pin-btn"),
    sidebarStatusMsg = document.getElementById("sidebar-status-msg"),
    playstoreHidden = document.getElementById("playstore-hidden"),
    playstoreSuspended = document.getElementById("playstore-suspended"),
    pinModal = document.getElementById("pin-modal"),
    pinModalDeviceName = document.querySelector(".modal-device-name"),
    pinModalInput = document.getElementById("pin-modal-input"),
    pinModalRemember = document.getElementById("pin-modal-remember"),
    pinModalError = document.getElementById("pin-modal-error"),
    pinModalCancel = document.getElementById("pin-modal-cancel"),
    pinModalConfirm = document.getElementById("pin-modal-confirm");

let selectedDeviceId = null,
    currentDevicesData = {},
    activeTabId = "panel-policies",
    devicesListener = null;

function field(device, key, fallback = null) {
    if (device && device[key] !== undefined && device[key] !== null) return device[key];
    if (device && device.info && device.info[key] !== undefined && device.info[key] !== null) {
        return device.info[key];
    }
    return fallback;
}

function appsOf(device) {
    return field(device, "apps", {});
}

function arrayOrCsv(value) {
    if (Array.isArray(value)) return value.join(", ");
    return value || "";
}

function startRealtimeSync() {
    devicesListener && database.ref("devices").off("value", devicesListener), devicesListener = database.ref("devices").on("value", e => {
        const t = e.val() || {};
        currentDevicesData = t, renderDevicesList(t), selectedDeviceId && t[selectedDeviceId] && updateSidebarUI(selectedDeviceId, t[selectedDeviceId])
    }, e => {
        globalError.textContent = "Error de sincronización en tiempo real: " + e.message
    })
}

function stopRealtimeSync() {
    devicesListener && (database.ref("devices").off("value", devicesListener), devicesListener = null)
}

function renderDevicesList(e) {
    devicesContainer.innerHTML = "";
    const t = Object.entries(e);
    0 !== t.length ? (t.sort((e, t) => {
        const n = field(e[1], "lastSeen", 0);
        return field(t[1], "lastSeen", 0) - n
    }), t.forEach(([e, t]) => {
        const n = cardTemplate.content.cloneNode(!0),
            a = n.querySelector(".device-card"),
            i = field(t, "deviceName", "Dispositivo sin nombre"),
            d = field(t, "model", "Modelo desconocido"),
            s = field(t, "lastSeen", null),
            fcm = field(t, "fcmToken", ""),
            o = s && Date.now() - s < 12e4;
        n.querySelector(".device-name").textContent = i, n.querySelector(".device-model-label").textContent = d, n.querySelector(".device-id").textContent = e;
        const c = n.querySelector(".status-badge");
        if (o && fcm) {
            c.textContent = "En línea";
            c.className = "badge active";
        } else if (o && !fcm) {
            c.textContent = "Sin FCM";
            c.className = "badge warning";
        } else {
            c.textContent = "Desconectado";
            c.className = "badge inactive";
        }
        n.querySelector(".last-seen").textContent = s ? "Última conexión: " + new Date(s).toLocaleString("es-AR") : "Sin conexión registrada";
        const r = () => openDeviceSidebar(e, t);
        a.addEventListener("click", r), n.querySelector(".view-details-btn").addEventListener("click", e => {
            e.stopPropagation(), r()
        }), devicesContainer.appendChild(n)
    })) : devicesContainer.innerHTML = '<p class="loading-text">Todavía no hay dispositivos registrados.</p>'
}

function openDeviceSidebar(e, t) {
    selectedDeviceId = e, sidebar.classList.remove("hidden"), updateSidebarUI(e, t)
}

function closeDeviceSidebar() {
    selectedDeviceId = null, sidebar.classList.add("hidden")
}

function updateSidebarUI(e, t) {
    const n = field(t, "deviceName", ""),
        a = field(t, "model", "Celular");
    sidebarDeviceName.textContent = n || a || "Celular sin nombre", sidebarDeviceId.textContent = e, document.activeElement !== deviceNameInput && (deviceNameInput.value = n);
    sidebar.querySelectorAll(".policy-switch").forEach(e => {
        const n = e.getAttribute("data-policy");
        e.checked = field(t, n, false) === true;
    });
    const apps = appsOf(t);
    const i = apps.com_android_vending || null,
        d = field(t, "installAppsBlocked", false) === true;
    playstoreHidden.checked = i ? i.isHidden === true : d, playstoreSuspended.checked = i ? i.isSuspended === true : d;
    renderAppsList(apps), document.activeElement !== sidebarAllowlistInput && (sidebarAllowlistInput.value = arrayOrCsv(field(t, "allowedPackages", "")));
    const s = !!(field(t, "pinHash") && field(t, "pinSalt")),
        o = auth.currentUser ? auth.currentUser.uid : "",
        c = !!field(t, "trustedAdmins", {})[o];
    s ? (sidebarForgetPinBtn.classList.remove("hidden"), sidebarTrustStatus.textContent = c ? "🔓 PIN de administrador recordado en esta sesión." : "🔒 Se requerirá el PIN para realizar acciones críticas.") : (sidebarForgetPinBtn.classList.add("hidden"), sidebarTrustStatus.textContent = "Ese celular todavía no configuró un PIN de administrador.")
}
sidebarCloseBtn.addEventListener("click", closeDeviceSidebar), sidebarTabButtons.forEach(e => {
    e.addEventListener("click", () => {
        sidebarTabButtons.forEach(e => e.classList.remove("active")), sidebarTabPanels.forEach(e => e.classList.remove("active")), e.classList.add("active"), activeTabId = e.getAttribute("data-tab"), document.getElementById(activeTabId).classList.add("active")
    })
});
let currentSearchQuery = "";

function renderAppsList(e) {
    sidebarAppsList.innerHTML = "";
    const t = Object.values(e).filter(e => "com.android.vending" !== e.packageName);
    if (0 === t.length) return void(sidebarAppsList.innerHTML = '<p class="loading-text">No hay aplicaciones reportadas por la app.</p>');
    const n = t.filter(e => (e.label || "").toLowerCase().includes(currentSearchQuery) || (e.packageName || "").toLowerCase().includes(currentSearchQuery));
    0 !== n.length ? n.forEach(e => {
        const t = document.createElement("div");
        t.className = "app-item", e.isCritical && (t.style.borderLeft = "3px solid #7F8C8D");
        
        t.style.flexDirection = "column";
        t.style.alignItems = "stretch";
        t.style.gap = "8px";

        const mainRow = document.createElement("div");
        mainRow.className = "app-main-row";
        mainRow.style.display = "flex";
        mainRow.style.alignItems = "center";
        mainRow.style.justifyContent = "space-between";
        mainRow.style.width = "100%";
        mainRow.style.gap = "10px";
        t.appendChild(mainRow);

        const n = document.createElement("div");
        n.className = "app-meta";
        const a = document.createElement("p");
        a.className = "app-title", a.textContent = e.label || e.packageName;
        const i = document.createElement("p");
        i.className = "app-pkg", i.textContent = e.packageName, n.appendChild(a), n.appendChild(i), mainRow.appendChild(n);
        
        const d = document.createElement("div");
        d.className = "app-toggles";
        if (e.isCritical) {
            const e = document.createElement("span");
            e.className = "badge inactive", e.textContent = "Crítica", d.appendChild(e);
            mainRow.appendChild(d);
        } else {
            const tBtn = document.createElement("button");
            tBtn.className = "app-toggle-btn" + (e.isHidden ? " active-block" : ""), tBtn.textContent = e.isHidden ? "Bloqueada" : "Bloquear", tBtn.addEventListener("click", () => {
                const n = e.isHidden ? "UNHIDE_APP" : "HIDE_APP";
                runCommandOnDevice(selectedDeviceId, n, [e.packageName], tBtn)
            });
            const nBtn = document.createElement("button");
            nBtn.className = "app-toggle-btn" + (e.isSuspended ? " active-suspend" : ""), nBtn.textContent = e.isSuspended ? "Suspendida" : "Suspender", nBtn.addEventListener("click", () => {
                const t = e.isSuspended ? "UNSUSPEND_APP" : "SUSPEND_APP";
                runCommandOnDevice(selectedDeviceId, t, [e.packageName], nBtn)
            });
            const aBtn = document.createElement("button");
            aBtn.className = "app-toggle-btn" + (e.isWebViewBlocked ? " active-webview" : ""), aBtn.textContent = e.isWebViewBlocked ? "Sin Web" : "Bloquear Web", aBtn.addEventListener("click", () => {
                const t = e.isWebViewBlocked ? "UNBLOCK_WEBVIEW" : "BLOCK_WEBVIEW";
                runCommandOnDevice(selectedDeviceId, t, [e.packageName], aBtn)
            });
            
            const gearBtn = document.createElement("button");
            gearBtn.className = "app-toggle-btn gear-btn";
            gearBtn.textContent = "⚙️";
            gearBtn.style.padding = "4px 6px";
            gearBtn.style.fontSize = "12px";
            if (e.imageBlockingMode && e.imageBlockingMode !== "none") {
                gearBtn.style.borderColor = "var(--accent-orange)";
                gearBtn.style.color = "var(--accent-orange)";
                gearBtn.style.boxShadow = "0 0 5px rgba(241, 196, 15, 0.4)";
            }

            d.appendChild(tBtn), d.appendChild(nBtn), d.appendChild(aBtn), d.appendChild(gearBtn);
            mainRow.appendChild(d);

            const advancedPanel = document.createElement("div");
            advancedPanel.className = "advanced-settings hidden";
            advancedPanel.style.marginTop = "6px";
            advancedPanel.style.padding = "8px 12px";
            advancedPanel.style.backgroundColor = "rgba(0, 0, 0, 0.25)";
            advancedPanel.style.borderRadius = "8px";
            advancedPanel.style.border = "1px solid rgba(255, 255, 255, 0.05)";
            advancedPanel.style.width = "100%";
            advancedPanel.style.display = "flex";
            advancedPanel.style.alignItems = "center";
            advancedPanel.style.justifyContent = "space-between";

            const label = document.createElement("span");
            label.textContent = "Bloqueo de imágenes:";
            label.style.fontSize = "11px";
            label.style.color = "var(--text-gray)";

            const select = document.createElement("select");
            select.style.padding = "3px 6px";
            select.style.borderRadius = "6px";
            select.style.backgroundColor = "var(--navy-dark)";
            select.style.color = "var(--text-light)";
            select.style.border = "1px solid var(--navy-light)";
            select.style.fontSize = "11px";
            select.style.cursor = "pointer";

            const optionsList = [
                { value: "none", text: "Desactivado" },
                { value: "layer1", text: "Capa 1: Nodos" },
                { value: "layer2", text: "Capa 2: IA (Siluetas)" },
                { value: "both", text: "Ambas Capas (Nodos + IA)" }
            ];

            optionsList.forEach(opt => {
                const o = document.createElement("option");
                o.value = opt.value;
                o.textContent = opt.text;
                if ((e.imageBlockingMode || "none") === opt.value) {
                    o.selected = true;
                }
                select.appendChild(o);
            });

            select.addEventListener("change", () => {
                let cmd = "SET_IMAGE_BLOCK_NONE";
                if (select.value === "layer1") cmd = "SET_IMAGE_BLOCK_LAYER_1";
                else if (select.value === "layer2") cmd = "SET_IMAGE_BLOCK_LAYER_2";
                else if (select.value === "both") cmd = "SET_IMAGE_BLOCK_BOTH";
                
                select.disabled = true;
                runCommandOnDevice(selectedDeviceId, cmd, [e.packageName], select);
            });

            gearBtn.addEventListener("click", (evt) => {
                evt.stopPropagation();
                advancedPanel.classList.toggle("hidden");
            });

            advancedPanel.appendChild(label);
            advancedPanel.appendChild(select);
            t.appendChild(advancedPanel);
        }
        t.appendChild(d), sidebarAppsList.appendChild(t)
    }) : sidebarAppsList.innerHTML = '<p class="loading-text">Ninguna aplicación coincide con la búsqueda.</p>'
}
async function runCommandOnDevice(e, t, n = null, a = null, i = null) {
    a && (a.disabled = !0), sidebarStatusMsg.textContent = "Enviando comando al celular...";
    let d = null,
        s = !1,
        o = "";
    const c = currentDevicesData[e],
        r = c && (c.model || c.info && c.info.model) || "Celular";
    for (;;) try {
        const a = functionsRef.httpsCallable("sendCommandV2");
        await a({
            deviceId: e,
            command: t,
            packages: n,
            devicePin: d,
            rememberDevice: s
        }), sidebarStatusMsg.textContent = "✓ Comando enviado", setTimeout(() => {
            "✓ Comando enviado" === sidebarStatusMsg.textContent && (sidebarStatusMsg.textContent = "")
        }, 4e3);
        break
    } catch (e) {
        if ("PIN_REQUIRED" === e.message || "PIN_INCORRECT" === e.message) {
            o = "PIN_INCORRECT" === e.message ? "PIN incorrecto. Intentá de nuevo." : "";
            const t = await showPinModal(r, o);
            if (!t) {
                sidebarStatusMsg.textContent = "Cancelado — PIN requerido.", i && i();
                break
            }
            d = t.pin, s = t.remember;
            continue
        }
        sidebarStatusMsg.textContent = "✗ Error: " + (e.message || "desconocido"), i && i();
        break
    }
    a && (a.disabled = !1)
}

function showPinModal(e, t) {
    return new Promise(n => {
        function a() {
            pinModalConfirm.removeEventListener("click", i), pinModalCancel.removeEventListener("click", d), pinModalInput.removeEventListener("keydown", s), pinModal.classList.add("hidden")
        }

        function i() {
            const e = pinModalInput.value.trim();
            e ? (a(), n({
                pin: e,
                remember: pinModalRemember.checked
            })) : pinModalError.textContent = "Ingresá el PIN."
        }

        function d() {
            a(), n(null)
        }

        @Suppress("JSUnusedLocalSymbols")
        function s(e) {
            "Enter" === e.key && i(), "Escape" === e.key && d()
        }
        pinModalDeviceName.textContent = e, pinModalInput.value = "", pinModalRemember.checked = !1, pinModalError.textContent = t || "", pinModal.classList.remove("hidden"), pinModalInput.focus(), pinModalConfirm.addEventListener("click", i), pinModalCancel.addEventListener("click", d), pinModalInput.addEventListener("keydown", s)
    })
}

function traducirErrorAuth(e) {
    return {
        "auth/invalid-email": "Email inválido.",
        "auth/user-not-found": "No existe una cuenta con ese email.",
        "auth/wrong-password": "Contraseña incorrecta.",
        "auth/invalid-credential": "Email o contraseña incorrectos.",
        "auth/too-many-requests": "Demasiados intentos. Probá de nuevo en unos minutos."
    } [e] || "No se pudo iniciar sesión."
}
appSearchInput.addEventListener("input", e => {
    currentSearchQuery = e.target.value.toLowerCase(), selectedDeviceId && currentDevicesData[selectedDeviceId] && renderAppsList(appsOf(currentDevicesData[selectedDeviceId]))
}), saveNameBtn.addEventListener("click", async () => {
    if (!selectedDeviceId) return;
    const e = deviceNameInput.value.trim();
    saveNameBtn.disabled = !0, sidebarStatusMsg.textContent = "Guardando nombre...";
    try {
        await database.ref(`devices/${selectedDeviceId}`).update({
            deviceName: e
        }), await database.ref(`devices/${selectedDeviceId}/info`).update({
            deviceName: e
        }).catch(() => {}), sidebarStatusMsg.textContent = "✓ Nombre guardado con éxito.", setTimeout(() => {
            sidebarStatusMsg.textContent.includes("✓") && (sidebarStatusMsg.textContent = "")
        }, 4e3)
    } catch (e) {
        sidebarStatusMsg.textContent = "✗ Error al guardar: " + e.message
    } finally {
        saveNameBtn.disabled = !1
    }
}), sidebar.addEventListener("change", e => {
    if (!e.target.classList.contains("policy-switch")) return;
    const t = e.target,
        n = t.getAttribute("data-policy"),
        a = t.checked,
        i = {
            factoryResetBlocked: ["BLOCK_FACTORY_RESET", "UNBLOCK_FACTORY_RESET"],
            installAppsBlocked: ["BLOCK_INSTALL_APPS", "UNBLOCK_INSTALL_APPS"],
            uninstallAppsBlocked: ["BLOCK_UNINSTALL_APPS", "UNBLOCK_UNINSTALL_APPS"],
            adbBlocked: ["BLOCK_ADB", "UNBLOCK_ADB"],
            userSwitchBlocked: ["BLOCK_USER_SWITCH", "UNBLOCK_USER_SWITCH"],
            modifyAccountsBlocked: ["BLOCK_MODIFY_ACCOUNTS", "UNBLOCK_MODIFY_ACCOUNTS"],
            safeBootBlocked: ["BLOCK_SAFE_BOOT", "UNBLOCK_SAFE_BOOT"],
            unknownSourcesBlocked: ["BLOCK_UNKNOWN_SOURCES", "UNBLOCK_UNKNOWN_SOURCES"],
            wifiBlocked: ["BLOCK_WIFI", "UNBLOCK_WIFI"],
            vpnBlocked: ["BLOCK_VPN", "UNBLOCK_VPN"],
            appsControlBlocked: ["BLOCK_APPS_CONTROL", "UNBLOCK_APPS_CONTROL"],
            adjustVolumeBlocked: ["BLOCK_VOLUME", "UNBLOCK_VOLUME"],
            cameraDisabled: ["DISABLE_CAMERA", "ENABLE_CAMERA"],
            screenCaptureBlocked: ["BLOCK_SCREEN_CAPTURE", "UNBLOCK_SCREEN_CAPTURE"],
            statusBarDisabled: ["DISABLE_STATUSBAR", "ENABLE_STATUSBAR"],
            keyguardDisabled: ["DISABLE_KEYGUARD", "ENABLE_KEYGUARD"],
            internetBlocked: ["BLOCK_INTERNET", "UNBLOCK_INTERNET"],
            bluetoothBlocked: ["BLOCK_BLUETOOTH", "UNBLOCK_BLUETOOTH"],
            bluetoothSharingBlocked: ["BLOCK_BLUETOOTH_SHARING", "UNBLOCK_BLUETOOTH_SHARING"],
            externalMediaBlocked: ["BLOCK_EXTERNAL_MEDIA", "UNBLOCK_EXTERNAL_MEDIA"],
            tetheringBlocked: ["BLOCK_TETHERING", "UNBLOCK_TETHERING"],
            adBlockingEnabled: ["ENABLE_ADBLOCK", "DISABLE_ADBLOCK"],
            aiModeEnabled: ["ENABLE_AI_MODE", "DISABLE_AI_MODE"]
        } [n];
    if (!i) return;
    const d = a ? i[0] : i[1];
    t.disabled = !0, runCommandOnDevice(selectedDeviceId, d, null, t, () => {
        t.checked = !a
    })
}), playstoreHidden.addEventListener("change", () => {
    const e = playstoreHidden.checked,
        t = e ? "HIDE_APP" : "UNHIDE_APP";
    playstoreHidden.disabled = !0, runCommandOnDevice(selectedDeviceId, t, ["com.android.vending"], playstoreHidden, () => {
        playstoreHidden.checked = !e
    })
}), playstoreSuspended.addEventListener("change", () => {
    const e = playstoreSuspended.checked,
        t = e ? "SUSPEND_APP" : "UNSUSPEND_APP";
    playstoreSuspended.disabled = !0, runCommandOnDevice(selectedDeviceId, t, ["com.android.vending"], playstoreSuspended, () => {
        playstoreSuspended.checked = !e
    })
}), sidebarAllowlistBtn.addEventListener("click", () => {
    const e = sidebarAllowlistInput.value.split(",").map(e => e.trim()).filter(Boolean);
    if (e.length === 0) {
        if (!confirm("¿Seguro que querés vaciar la lista de aplicaciones permitidas? Esto bloqueará el acceso a todas las aplicaciones no esenciales.")) {
            return;
        }
    }
    sidebarAllowlistBtn.disabled = !0, runCommandOnDevice(selectedDeviceId, "UPDATE_ALLOWLIST", e, sidebarAllowlistBtn);
}), sidebarLockBtn.addEventListener("click", () => {
    sidebarLockBtn.disabled = !0, runCommandOnDevice(selectedDeviceId, "LOCK_DEVICE", null, sidebarLockBtn)
}), sidebarForgetPinBtn.addEventListener("click", async () => {
    if (selectedDeviceId) {
        sidebarForgetPinBtn.disabled = !0, sidebarStatusMsg.textContent = "Olvidando confianza del PIN...";
        try {
            const e = functionsRef.httpsCallable("forgetDeviceTrust");
            await e({
                deviceId: selectedDeviceId
            }), sidebarStatusMsg.textContent = "Confianza del PIN olvidada."
        } catch (e) {
            sidebarStatusMsg.textContent = "Error al olvidar confianza: " + e.message
        } finally {
            sidebarForgetPinBtn.disabled = !1
        }
    }
}), auth.onAuthStateChanged(async e => {
    if (e) {
        loginError.textContent = "Verificando permisos...";
        try {
            const t = await database.ref(`authorizedAdminsUids/${e.uid}`).once("value");
            if (!t.exists() || !0 !== t.val()) {
                const t = e.email.toLowerCase().replace(/[.@]/g, "_"),
                    n = await database.ref(`authorizedAdmins/${t}`).once("value");
                if (!n.exists() || !0 !== n.val()) return loginError.textContent = `Acceso denegado: El correo ${e.email} no está autorizado.`, void auth.signOut()
            }
            loginError.textContent = "", loginScreen.classList.add("hidden"), dashboardScreen.classList.remove("hidden"), startRealtimeSync()
        } catch (e) {
            loginError.textContent = "Error al verificar permisos: " + e.message, auth.signOut()
        }
    } else stopRealtimeSync(), closeDeviceSidebar(), dashboardScreen.classList.add("hidden"), loginScreen.classList.remove("hidden")
}), loginButton.addEventListener("click", async () => {
    loginError.textContent = "";
    try {
        await auth.signInWithEmailAndPassword(emailInput.value.trim(), passwordInput.value)
    } catch (e) {
        loginError.textContent = traducirErrorAuth(e.code)
    }
}), googleLoginButton.addEventListener("click", async () => {
    loginError.textContent = "";
    try {
        const e = new firebase.auth.GoogleAuthProvider;
        await auth.signInWithPopup(e)
    } catch (e) {
        loginError.textContent = "Error al iniciar sesión con Google: " + e.message
    }
}), logoutButton.addEventListener("click", () => auth.signOut()), refreshButton.addEventListener("click", () => {
    devicesListener && database.ref("devices").once("value").then(e => {
        currentDevicesData = e.val() || {}, renderDevicesList(currentDevicesData)
    })
});
```

---

### 📄 firebase-config.js
Ubicación: `admin-backend/public/firebase-config.js`
```javascript
const firebaseConfig = {
  apiKey: "AIzaSyAwrQjtHDC0YKfPWCHnCnQL2Dg7prwEyfw",
  authDomain: "locksuite-nueva.firebaseapp.com",
  databaseURL: "https://locksuite-nueva-default-rtdb.firebaseio.com",
  projectId: "locksuite-nueva",
  storageBucket: "locksuite-nueva.firebasestorage.app",
  messagingSenderId: "687828714595",
  appId: "1:687828714595:web:220bf9b3ba93c12a8e2456"
};

firebase.initializeApp(firebaseConfig);
```

---

## 3. Códigos de Cloud Functions y Seguridad de Red

### 📄 index.js (Cloud Functions)
Ubicación: `admin-backend/functions/index.js`
```javascript
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const crypto = require("crypto");

admin.initializeApp({
  databaseURL: "https://locksuite-nueva-default-rtdb.firebaseio.com"
});

// Lista blanca de comandos válidos — cualquier otro valor se rechaza.
const ALLOWED_COMMANDS = new Set([
  "LOCK_DEVICE",
  "BLOCK_INSTALL_APPS",
  "UNBLOCK_INSTALL_APPS",
  "BLOCK_UNINSTALL_APPS",
  "UNBLOCK_UNINSTALL_APPS",
  "BLOCK_FACTORY_RESET",
  "UNBLOCK_FACTORY_RESET",
  "BLOCK_ADB",
  "UNBLOCK_ADB",
  "BLOCK_USER_SWITCH",
  "UNBLOCK_USER_SWITCH",
  "BLOCK_MODIFY_ACCOUNTS",
  "UNBLOCK_MODIFY_ACCOUNTS",
  "BLOCK_SAFE_BOOT",
  "UNBLOCK_SAFE_BOOT",
  "BLOCK_UNKNOWN_SOURCES",
  "UNBLOCK_UNKNOWN_SOURCES",
  "BLOCK_VOLUME",
  "UNBLOCK_VOLUME",
  "BLOCK_APPS_CONTROL",
  "UNBLOCK_APPS_CONTROL",
  "BLOCK_BLUETOOTH_SHARING",
  "UNBLOCK_BLUETOOTH_SHARING",
  "BLOCK_EXTERNAL_MEDIA",
  "UNBLOCK_EXTERNAL_MEDIA",
  "BLOCK_TETHERING",
  "UNBLOCK_TETHERING",
  "BLOCK_WIFI",
  "UNBLOCK_WIFI",
  "BLOCK_BLUETOOTH",
  "UNBLOCK_BLUETOOTH",
  "BLOCK_VPN",
  "UNBLOCK_VPN",
  "DISABLE_CAMERA",
  "ENABLE_CAMERA",
  "BLOCK_SCREEN_CAPTURE",
  "UNBLOCK_SCREEN_CAPTURE",
  "DISABLE_STATUSBAR",
  "ENABLE_STATUSBAR",
  "DISABLE_KEYGUARD",
  "ENABLE_KEYGUARD",
  "BLOCK_INTERNET",
  "UNBLOCK_INTERNET",
  "ENABLE_ADBLOCK",
  "DISABLE_ADBLOCK",
  "HIDE_APP",
  "UNHIDE_APP",
  "SUSPEND_APP",
  "UNSUSPEND_APP",
  "BLOCK_WEBVIEW",
  "UNBLOCK_WEBVIEW",
  "UPDATE_ALLOWLIST",
  "SET_IMAGE_BLOCK_NONE",
  "SET_IMAGE_BLOCK_LAYER_1",
  "SET_IMAGE_BLOCK_LAYER_2",
  "SET_IMAGE_BLOCK_BOTH",
  "ENABLE_AI_MODE",
  "DISABLE_AI_MODE",
]);

// Función para verificar que el usuario tenga privilegios de administrador.
async function checkAdminAuth(auth) {
  if (!auth) {
    throw new functions.https.HttpsError("unauthenticated", "Necesitás iniciar sesión.");
  }
  const email = auth.token.email;
  if (!email) {
    throw new functions.https.HttpsError("permission-denied", "Acceso denegado: Correo electrónico inválido.");
  }
  
  const emailKey = email.toLowerCase().replace(/[.@]/g, "_");
  
  const snap = await admin.database().ref(`authorizedAdmins/${emailKey}`).once("value");
  if (!snap.exists() || snap.val() !== true) {
    throw new functions.https.HttpsError("permission-denied", `Acceso denegado: El correo ${email} no está autorizado como administrador.`);
  }
}

/**
 * Replica exactamente el esquema de PinManager.kt en Android
 */
function hashPinServerSide(pin, saltBase64) {
  const saltBytes = Buffer.from(saltBase64, "base64");
  const hash = crypto.createHash("sha256");
  hash.update(saltBytes);
  hash.update(Buffer.from(pin, "utf8"));
  return hash.digest("base64");
}

function getDeviceField(device, field, fallback = null) {
  if (device && device[field] !== undefined && device[field] !== null) {
    return device[field];
  }
  if (device && device.info && device.info[field] !== undefined && device.info[field] !== null) {
    return device.info[field];
  }
  return fallback;
}

async function verifyDevicePinOrThrow(deviceRef, deviceData, adminUid, devicePin, rememberDevice) {
  const trustedAdmins = getDeviceField(deviceData, "trustedAdmins", {});
  if (trustedAdmins[adminUid] === true) {
    return;
  }

  const pinHash = getDeviceField(deviceData, "pinHash");
  const pinSalt = getDeviceField(deviceData, "pinSalt");

  if (!pinHash || !pinSalt) {
    return;
  }

  if (!devicePin) {
    throw new functions.https.HttpsError("failed-precondition", "PIN_REQUIRED");
  }

  const computedHash = hashPinServerSide(devicePin, pinSalt);
  if (computedHash !== pinHash) {
    throw new functions.https.HttpsError("permission-denied", "PIN_INCORRECT");
  }

  if (rememberDevice) {
    await deviceRef.child(`trustedAdmins/${adminUid}`).set(true);
    await deviceRef.child(`info/trustedAdmins/${adminUid}`).set(true).catch(() => {});
  }
}

/**
 * Envía un comando a un dispositivo puntual. (Gen 1)
 */
exports.sendCommandV2 = functions.https.onCall(async (data, context) => {
  await checkAdminAuth(context.auth);
  console.log("Remote command requested:", { command: data ? data.command : null });

  const { deviceId, command, packages, devicePin, rememberDevice } = data || {};
  
  if (!deviceId || typeof deviceId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "Falta deviceId.");
  }
  if (!ALLOWED_COMMANDS.has(command)) {
    throw new functions.https.HttpsError("invalid-argument", `Comando no reconocido: ${command}`);
  }

  const deviceRef = admin.database().ref(`devices/${deviceId}`);
  const deviceSnap = await deviceRef.once("value");
  const deviceData = deviceSnap.val();

  if (!deviceData) {
    throw new functions.https.HttpsError("not-found", "Ese dispositivo no está registrado.");
  }

  await verifyDevicePinOrThrow(deviceRef, deviceData, context.auth.uid, devicePin, rememberDevice);

  const token = getDeviceField(deviceData, "fcmToken");
  if (!token) {
    throw new functions.https.HttpsError(
      "not-found",
      "Ese dispositivo no tiene un token FCM registrado todavía (¿tiene la app abierta al menos una vez con internet?)."
    );
  }

  const commandId = crypto.randomUUID();
  const payload = { command, commandId };

  if (command === "UPDATE_ALLOWLIST") {
    if (!Array.isArray(packages)) {
      throw new functions.https.HttpsError("invalid-argument", "Falta la lista de paquetes permitidos.");
    }
    const cleanPackages = packages
      .map((p) => String(p).trim())
      .filter((p) => /^[a-zA-Z0-9_.]+$/.test(p));
    payload.packages = cleanPackages.join(",");
  } else if (Array.isArray(packages) && packages.length > 0) {
    const cleanPackages = packages
      .map((p) => String(p).trim())
      .filter((p) => /^[a-zA-Z0-9_.]+$/.test(p));
    if (cleanPackages.length > 0) {
      payload.packages = cleanPackages.join(",");
    }
  }

  await admin.messaging().send({
    token,
    data: payload,
    android: { priority: "high" },
  });

  await admin.database().ref(`commandLog/${deviceId}`).push({
    command,
    commandId,
    packages: payload.packages || null,
    sentBy: context.auth.uid,
    sentAt: admin.database.ServerValue.TIMESTAMP,
  });

  return { success: true, commandId };
});

/**
 * Le hace olvidar confianza de PIN (Gen 1)
 */
exports.forgetDeviceTrust = functions.https.onCall(async (data, context) => {
  await checkAdminAuth(context.auth);
  console.log("Forgetting device trust:", { deviceId: data ? data.deviceId : null });
  
  const { deviceId } = data || {};
  if (!deviceId || typeof deviceId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "Falta deviceId.");
  }
  await admin.database().ref(`devices/${deviceId}/trustedAdmins/${context.auth.uid}`).remove();
  await admin.database().ref(`devices/${deviceId}/info/trustedAdmins/${context.auth.uid}`).remove().catch(() => {});
  return { success: true };
});

/**
 * Devuelve metadata de todos los dispositivos registrados (Gen 1)
 */
exports.listDevices = functions.https.onCall(async (data, context) => {
  await checkAdminAuth(context.auth);

  const snap = await admin.database().ref("devices").once("value");
  const devices = snap.val() || {};
  const adminUid = context.auth.uid;

  return {
    devices: Object.entries(devices).map(([id, info]) => {
      const pinHash = getDeviceField(info, "pinHash");
      const pinSalt = getDeviceField(info, "pinSalt");
      const trustedAdmins = getDeviceField(info, "trustedAdmins", {});
      return {
        id,
        model: getDeviceField(info, "model", "Desconocido"),
        isDeviceOwner: !!getDeviceField(info, "isDeviceOwner"),
        kioskEnabled: !!getDeviceField(info, "kioskEnabled"),
        allowedAppCount: getDeviceField(info, "allowedAppCount", 0),
        wifiBlocked: !!getDeviceField(info, "wifiBlocked"),
        bluetoothBlocked: !!getDeviceField(info, "bluetoothBlocked"),
        vpnBlocked: !!getDeviceField(info, "vpnBlocked"),
        installAppsBlocked: !!getDeviceField(info, "installAppsBlocked"),
        lastSeen: getDeviceField(info, "lastSeen"),
        hasToken: !!getDeviceField(info, "fcmToken"),
        hasPinConfigured: !!(pinHash && pinSalt),
        trustedForMe: !!trustedAdmins[adminUid],
      };
    }),
  };
});
```

---

### 📄 database.rules.json
Ubicación: `admin-backend/database.rules.json`
```json
{
  "rules": {
    "devices": {
      ".read": "auth != null && auth.token.admin === true",
      "$device_id": {
        ".read": "auth != null && auth.token.admin === true",
        ".write": "true"
      }
    },
    "authorizedAdmins": {
      ".read": "auth != null",
      ".write": "false"
    },
    "authorizedAdminsUids": {
      ".read": "auth != null",
      ".write": "false"
    },
    "commandLog": {
      ".read": "auth != null && auth.token.admin === true",
      ".write": "false"
    }
  }
}
```

---

## 4. Códigos de la App Móvil (Kotlin)

### 📄 FirebaseDeviceSync.kt
Ubicación: `app/src/main/java/com/ejemplo/locksuite/util/FirebaseDeviceSync.kt`
```kotlin
package com.ejemplo.locksuite.util

import android.content.Context
import android.os.Build
import android.provider.Settings
import com.ejemplo.locksuite.mdm.PolicyManager
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.database.ServerValue

object FirebaseDeviceSync {

    fun deviceId(context: Context): String =
        Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)

    fun syncToken(context: Context, token: String) {
        withAuth {
            val ref = FirebaseDatabase.getInstance().getReference("devices/${deviceId(context)}")
            ref.updateChildren(mapOf("fcmToken" to token, "info/fcmToken" to token))
        }
    }

    fun syncPinCredentials(context: Context, pinHash: String, pinSalt: String) {
        withAuth {
            val ref = FirebaseDatabase.getInstance().getReference("devices/${deviceId(context)}")
            ref.updateChildren(
                mapOf(
                    "pinHash" to pinHash,
                    "info/pinHash" to pinHash,
                    "pinSalt" to pinSalt,
                    "info/pinSalt" to pinSalt
                )
            )
        }
    }

    /**
     * Reporta el estado actual de las políticas a la base de datos de Firebase.
     * Mantiene compatibilidad total con los campos requeridos por el panel web.
     */
    fun syncDeviceInfo(context: Context) {
        val policyManager = PolicyManager(context)
        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as android.app.admin.DevicePolicyManager
        val prefs = PrefsHelper.getMdmPrefs(context)
        val deviceName = prefs.getString("device_name", "") ?: ""

        // Obtener y sincronizar el token FCM actual por si no se llamó a onNewToken
        try {
            com.google.firebase.messaging.FirebaseMessaging.getInstance().token
                .addOnCompleteListener { task ->
                    if (task.isSuccessful) {
                        task.result?.let { token ->
                            syncToken(context, token)
                        }
                    }
                }
        } catch (e: Exception) {
            e.printStackTrace()
        }

        withAuth {
            writeFields(
                context,
                mapOf(
                    "deviceName" to deviceName,
                    "model" to "${Build.MANUFACTURER} ${Build.MODEL}",
                    "isDeviceOwner" to dpm.isDeviceOwnerApp(context.packageName),
                    "kioskEnabled" to false,
                    "allowedAppCount" to 0,
                    
                    // Conectividad y Sistema (16 políticas en SharedPreferences)
                    "wifiBlocked" to policyManager.isRestrictionEnabled(android.os.UserManager.DISALLOW_CONFIG_WIFI),
                    "bluetoothBlocked" to policyManager.isRestrictionEnabled(android.os.UserManager.DISALLOW_BLUETOOTH),
                    "vpnBlocked" to policyManager.isRestrictionEnabled(android.os.UserManager.DISALLOW_CONFIG_VPN),
                    "installAppsBlocked" to policyManager.isRestrictionEnabled(android.os.UserManager.DISALLOW_INSTALL_APPS),
                    "uninstallAppsBlocked" to policyManager.isRestrictionEnabled(android.os.UserManager.DISALLOW_UNINSTALL_APPS),
                    "factoryResetBlocked" to policyManager.isRestrictionEnabled(android.os.UserManager.DISALLOW_FACTORY_RESET),
                    "adbBlocked" to policyManager.isRestrictionEnabled(android.os.UserManager.DISALLOW_DEBUGGING_FEATURES),
                    "userSwitchBlocked" to policyManager.isRestrictionEnabled(android.os.UserManager.DISALLOW_USER_SWITCH),
                    "modifyAccountsBlocked" to policyManager.isRestrictionEnabled(android.os.UserManager.DISALLOW_MODIFY_ACCOUNTS),
                    "safeBootBlocked" to policyManager.isRestrictionEnabled(android.os.UserManager.DISALLOW_SAFE_BOOT),
                    "unknownSourcesBlocked" to policyManager.isRestrictionEnabled(android.os.UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES),
                    "adjustVolumeBlocked" to policyManager.isRestrictionEnabled(android.os.UserManager.DISALLOW_ADJUST_VOLUME),
                    "appsControlBlocked" to policyManager.isRestrictionEnabled(android.os.UserManager.DISALLOW_APPS_CONTROL),
                    "bluetoothSharingBlocked" to policyManager.isRestrictionEnabled(android.os.UserManager.DISALLOW_BLUETOOTH_SHARING),
                    "externalMediaBlocked" to policyManager.isRestrictionEnabled(android.os.UserManager.DISALLOW_MOUNT_PHYSICAL_MEDIA),
                    "tetheringBlocked" to policyManager.isRestrictionEnabled(android.os.UserManager.DISALLOW_CONFIG_TETHERING),
                    
                    // Hardware y Especiales
                    "cameraDisabled" to policyManager.isCameraDisabled(),
                    "screenCaptureBlocked" to policyManager.isScreenCaptureBlocked(),
                    "statusBarDisabled" to policyManager.isStatusBarDisabled(),
                    "keyguardDisabled" to policyManager.isKeyguardDisabled(),
                    "internetBlocked" to policyManager.isInternetBlocked(),
                    "adBlockingEnabled" to policyManager.isAdBlockingEnabled(),
                    "aiModeEnabled" to com.ejemplo.locksuite.mdm.ImageBlockManager.isGlobalAiEnabled(context)
                )
            )
            syncAppsListInternal(context)
        }
    }

    private fun syncAppsListInternal(context: Context) {
        try {
            val appController = com.ejemplo.locksuite.mdm.AppController(context)
            val apps = appController.getUserApps()
            val appsMap = mutableMapOf<String, Any>()
            for (app in apps) {
                val safePackageName = app.packageName.replace(".", "_")
                appsMap[safePackageName] = mapOf(
                    "packageName" to app.packageName,
                    "label" to app.label,
                    "isHidden" to app.isHidden,
                    "isSuspended" to app.isSuspended,
                    "isWebViewBlocked" to app.isWebViewBlocked,
                    "imageBlockingMode" to app.imageBlockingMode,
                    "appType" to app.appType,
                    "isCritical" to app.isCritical
                )
            }
            val baseRef = FirebaseDatabase.getInstance().reference
            val deviceId = deviceId(context)
            baseRef.child("devices/$deviceId/apps").setValue(appsMap)
            baseRef.child("devices/$deviceId/info/apps").setValue(appsMap)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun writeFields(context: Context, fields: Map<String, Any>) {
        val ref = FirebaseDatabase.getInstance().getReference("devices/${deviceId(context)}")
        val payload = mutableMapOf<String, Any>()
        fields.forEach { (key, value) ->
            payload[key] = value
            payload["info/$key"] = value
        }
        payload["lastSeen"] = ServerValue.TIMESTAMP
        payload["info/lastSeen"] = ServerValue.TIMESTAMP
        try {
            ref.updateChildren(payload)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun withAuth(action: () -> Unit) {
        val auth = FirebaseAuth.getInstance()
        if (auth.currentUser != null) {
            action()
            return
        }
        auth.signInAnonymously()
            .addOnSuccessListener { action() }
            .addOnFailureListener { it.printStackTrace() }
    }
}
```

---

### 📄 LockSuiteFirebaseService.kt
Ubicación: `app/src/main/java/com/ejemplo/locksuite/service/LockSuiteFirebaseService.kt`
```kotlin
package com.ejemplo.locksuite.service

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.provider.Settings
import com.ejemplo.locksuite.mdm.PolicyManager
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import android.util.Base64
import java.security.MessageDigest

class LockSuiteFirebaseService : FirebaseMessagingService() {

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        val command = data["command"] ?: return
        val commandId = data["commandId"]
        
        val policyManager = PolicyManager(this)

        val signature = data["signature"]
        val timestamp = data["timestamp"]

        if (signature != null && timestamp != null) {
            if (!verifyFcmSignature(command, timestamp, signature)) {
                return
            }
        }

        val packagesStr = data["packages"]
        val packagesList = packagesStr?.split(",")?.map { it.trim() }?.filter { it.isNotEmpty() } ?: emptyList()

        var success = true
        try {
            when (command) {
                "LOCK_DEVICE" -> {
                    val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
                    try {
                        dpm.lockNow()
                    } catch (e: Exception) {
                        e.printStackTrace()
                        success = false
                    }
                }
                "BLOCK_INSTALL_APPS" -> policyManager.setInstallAppsBlocked(true)
                "UNBLOCK_INSTALL_APPS" -> policyManager.setInstallAppsBlocked(false)
                "BLOCK_UNINSTALL_APPS" -> policyManager.setUninstallAppsBlocked(true)
                "UNBLOCK_UNINSTALL_APPS" -> policyManager.setUninstallAppsBlocked(false)
                "BLOCK_FACTORY_RESET" -> policyManager.setFactoryResetBlocked(true)
                "UNBLOCK_FACTORY_RESET" -> policyManager.setFactoryResetBlocked(false)
                "BLOCK_ADB" -> policyManager.setDebuggingFeaturesBlocked(true)
                "UNBLOCK_ADB" -> policyManager.setDebuggingFeaturesBlocked(false)
                "BLOCK_USER_SWITCH" -> policyManager.setUserSwitchBlocked(true)
                "UNBLOCK_USER_SWITCH" -> policyManager.setUserSwitchBlocked(false)
                "BLOCK_MODIFY_ACCOUNTS" -> policyManager.setModifyAccountsBlocked(true)
                "UNBLOCK_MODIFY_ACCOUNTS" -> policyManager.setModifyAccountsBlocked(false)
                "BLOCK_SAFE_BOOT" -> policyManager.setSafeBootBlocked(true)
                "UNBLOCK_SAFE_BOOT" -> policyManager.setSafeBootBlocked(false)
                "BLOCK_UNKNOWN_SOURCES" -> policyManager.setUnknownSourcesBlocked(true)
                "UNBLOCK_UNKNOWN_SOURCES" -> policyManager.setUnknownSourcesBlocked(false)
                "BLOCK_VOLUME" -> policyManager.setAdjustVolumeBlocked(true)
                "UNBLOCK_VOLUME" -> policyManager.setAdjustVolumeBlocked(false)
                "BLOCK_APPS_CONTROL" -> policyManager.setAppsControlBlocked(true)
                "UNBLOCK_APPS_CONTROL" -> policyManager.setAppsControlBlocked(false)
                "BLOCK_BLUETOOTH_SHARING" -> policyManager.setBluetoothSharingBlocked(true)
                "UNBLOCK_BLUETOOTH_SHARING" -> policyManager.setBluetoothSharingBlocked(false)
                "BLOCK_EXTERNAL_MEDIA" -> policyManager.setExternalMediaBlocked(true)
                "UNBLOCK_EXTERNAL_MEDIA" -> policyManager.setExternalMediaBlocked(false)
                "BLOCK_TETHERING" -> policyManager.setTetheringBlocked(true)
                "UNBLOCK_TETHERING" -> policyManager.setTetheringBlocked(false)
                
                "BLOCK_WIFI" -> policyManager.setWifiConfigBlocked(true)
                "UNBLOCK_WIFI" -> policyManager.setWifiConfigBlocked(false)
                "BLOCK_BLUETOOTH" -> policyManager.setBluetoothBlocked(true)
                "UNBLOCK_BLUETOOTH" -> policyManager.setBluetoothBlocked(false)
                "BLOCK_VPN" -> policyManager.setVpnConfigBlocked(true)
                "UNBLOCK_VPN" -> policyManager.setVpnConfigBlocked(false)
                "ENABLE_STEALTH" -> setStealthMode(true)
                "DISABLE_STEALTH" -> setStealthMode(false)
                
                "DISABLE_CAMERA" -> policyManager.setCameraDisabled(true)
                "ENABLE_CAMERA" -> policyManager.setCameraDisabled(false)
                "BLOCK_SCREEN_CAPTURE" -> policyManager.setScreenCaptureBlocked(true)
                "UNBLOCK_SCREEN_CAPTURE" -> policyManager.setScreenCaptureBlocked(false)
                "DISABLE_STATUSBAR" -> policyManager.setStatusBarDisabled(true)
                "ENABLE_STATUSBAR" -> policyManager.setStatusBarDisabled(false)
                "DISABLE_KEYGUARD" -> policyManager.setKeyguardDisabled(true)
                "ENABLE_KEYGUARD" -> policyManager.setKeyguardDisabled(false)
                "BLOCK_INTERNET" -> policyManager.setInternetBlocked(true)
                "UNBLOCK_INTERNET" -> policyManager.setInternetBlocked(false)
                "ENABLE_ADBLOCK" -> policyManager.setAdBlockingEnabled(true)
                "DISABLE_ADBLOCK" -> policyManager.setAdBlockingEnabled(false)

                "HIDE_APP" -> {
                    val appController = com.ejemplo.locksuite.mdm.AppController(this)
                    packagesList.forEach { appController.hideApp(it, true) }
                }
                "UNHIDE_APP" -> {
                    val appController = com.ejemplo.locksuite.mdm.AppController(this)
                    packagesList.forEach { appController.hideApp(it, false) }
                }
                "SUSPEND_APP" -> {
                    val appController = com.ejemplo.locksuite.mdm.AppController(this)
                    packagesList.forEach { appController.suspendApp(it, true) }
                }
                "UNSUSPEND_APP" -> {
                    val appController = com.ejemplo.locksuite.mdm.AppController(this)
                    packagesList.forEach { appController.suspendApp(it, false) }
                }
                "BLOCK_WEBVIEW" -> {
                    packagesList.forEach { com.ejemplo.locksuite.mdm.WebViewBlockManager.setBlocked(this, it, true) }
                }
                "UNBLOCK_WEBVIEW" -> {
                    packagesList.forEach { com.ejemplo.locksuite.mdm.WebViewBlockManager.setBlocked(this, it, false) }
                }
                "SET_IMAGE_BLOCK_NONE" -> {
                    packagesList.forEach { com.ejemplo.locksuite.mdm.ImageBlockManager.setMode(this, it, "none") }
                }
                "SET_IMAGE_BLOCK_LAYER_1" -> {
                    packagesList.forEach { com.ejemplo.locksuite.mdm.ImageBlockManager.setMode(this, it, "layer1") }
                }
                "SET_IMAGE_BLOCK_LAYER_2" -> {
                    packagesList.forEach { com.ejemplo.locksuite.mdm.ImageBlockManager.setMode(this, it, "layer2") }
                }
                "SET_IMAGE_BLOCK_BOTH" -> {
                    packagesList.forEach { com.ejemplo.locksuite.mdm.ImageBlockManager.setMode(this, it, "both") }
                }
                "ENABLE_AI_MODE" -> {
                    com.ejemplo.locksuite.mdm.ImageBlockManager.setGlobalAiEnabled(this, true)
                }
                "DISABLE_AI_MODE" -> {
                    com.ejemplo.locksuite.mdm.ImageBlockManager.setGlobalAiEnabled(this, false)
                    com.ejemplo.locksuite.service.AIContentGate.releaseAll()
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
            success = false
        }

        // Registrar confirmación de ejecución del comando (Command ACK)
        if (!commandId.isNullOrBlank()) {
            try {
                val deviceId = com.ejemplo.locksuite.util.FirebaseDeviceSync.deviceId(this)
                val baseRef = FirebaseDatabase.getInstance().reference
                val status = if (success) "applied" else "failed"
                
                val ackData = mapOf(
                    "status" to status,
                    "command" to command,
                    "timestamp" to com.google.firebase.database.ServerValue.TIMESTAMP
                )
                baseRef.child("devices/$deviceId/commandAcks/$commandId").setValue(ackData)
                baseRef.child("devices/$deviceId/info/commandAcks/$commandId").setValue(ackData).addOnFailureListener {}
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }

        try {
            com.ejemplo.locksuite.util.FirebaseDeviceSync.syncDeviceInfo(this)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun verifyFcmSignature(command: String, timestamp: String, signature: String): Boolean {
        return try {
            val timeMs = timestamp.toLongOrNull() ?: return false
            if (Math.abs(System.currentTimeMillis() - timeMs) > 5 * 60 * 1000L) {
                return false
            }

            val secret = com.ejemplo.locksuite.util.Constants.getFcmSecret()
            val mac = Mac.getInstance("HmacSHA256")
            val secretKey = SecretKeySpec(secret.toByteArray(), "HmacSHA256")
            mac.init(secretKey)
            
            val message = "$command:$timestamp"
            val expectedBytes = mac.doFinal(message.toByteArray())
            val expectedSig = Base64.encodeToString(expectedBytes, Base64.NO_WRAP)

            MessageDigest.isEqual(expectedSig.toByteArray(), signature.toByteArray())
        } catch (e: Exception) {
            e.printStackTrace()
            false
        }
    }

    override fun onNewToken(token: String) {
        try {
            com.ejemplo.locksuite.util.FirebaseDeviceSync.syncToken(this, token)
            com.ejemplo.locksuite.util.FirebaseDeviceSync.syncDeviceInfo(this)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun setStealthMode(enabled: Boolean) {
        val aliasComponent = ComponentName(this, "com.ejemplo.locksuite.LauncherAlias")
        val state = if (enabled) {
            PackageManager.COMPONENT_ENABLED_STATE_DISABLED
        } else {
            PackageManager.COMPONENT_ENABLED_STATE_ENABLED
        }
        try {
            packageManager.setComponentEnabledSetting(
                aliasComponent,
                state,
                PackageManager.DONT_KILL_APP
            )
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }
}
```

---

### 📄 PolicyManager.kt
Ubicación: `app/src/main/java/com/ejemplo/locksuite/mdm/PolicyManager.kt`
```kotlin
package com.ejemplo.locksuite.mdm

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.UserManager
import android.net.VpnService
import android.os.Bundle
import com.ejemplo.locksuite.receiver.DeviceAdminReceiver
import com.ejemplo.locksuite.util.PrefsHelper

class PolicyManager(private val context: Context) {

    private val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    private val adminComponent = ComponentName(context, DeviceAdminReceiver::class.java)

    private companion object {
        private const val GOOGLE_PLAY_SERVICES_PACKAGE = "com.google.android.gms"
        private const val FRP_CONFIG_CHANGED_ACTION = "com.google.android.gms.auth.FRP_CONFIG_CHANGED"

        private val LEGACY_FRP_ACCOUNT_KEYS = listOf(
            "factoryResetProtectionAccounts",
            "factoryResetProtectionAdmin",
            "factoryResetProtectionAdmins"
        )
    }

    private fun setRestriction(restriction: String, enable: Boolean): Boolean {
        return try {
            if (enable) {
                dpm.addUserRestriction(adminComponent, restriction)
            } else {
                dpm.clearUserRestriction(adminComponent, restriction)
            }
            saveState(restriction, enable)
            true
        } catch (e: SecurityException) {
            e.printStackTrace()
            false
        }
    }

    private fun saveState(restriction: String, enabled: Boolean) {
        val prefs = PrefsHelper.getMdmPrefs(context)
        prefs.edit().putBoolean(restriction, enabled).apply()
    }

    fun setFactoryResetBlocked(block: Boolean) =
        setRestriction(UserManager.DISALLOW_FACTORY_RESET, block)

    fun setInstallAppsBlocked(block: Boolean): Boolean {
        val success = setRestriction(UserManager.DISALLOW_INSTALL_APPS, block)
        try {
            dpm.setPackagesSuspended(adminComponent, arrayOf("com.android.vending"), block)
        } catch (e: Exception) {
            e.printStackTrace()
        }
        return success
    }

    fun setUninstallAppsBlocked(block: Boolean) =
        setRestriction(UserManager.DISALLOW_UNINSTALL_APPS, block)

    fun setDebuggingFeaturesBlocked(block: Boolean) =
        setRestriction(UserManager.DISALLOW_DEBUGGING_FEATURES, block)

    fun setUserSwitchBlocked(block: Boolean) =
        setRestriction(UserManager.DISALLOW_USER_SWITCH, block)

    fun setModifyAccountsBlocked(block: Boolean) =
        setRestriction(UserManager.DISALLOW_MODIFY_ACCOUNTS, block)

    fun setSafeBootBlocked(block: Boolean) =
        setRestriction(UserManager.DISALLOW_SAFE_BOOT, block)

    fun setUnknownSourcesBlocked(block: Boolean) =
        setRestriction(UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES, block)

    fun setWifiConfigBlocked(block: Boolean): Boolean {
        val r1 = setRestriction(UserManager.DISALLOW_CONFIG_WIFI, block)
        val r2 = setRestriction(UserManager.DISALLOW_NETWORK_RESET, block)
        val r3 = setRestriction("no_config_mobile_networks", block)
        return r1 && r2 && r3
    }

    fun setCameraDisabled(disabled: Boolean): Boolean {
        return try {
            dpm.setCameraDisabled(adminComponent, disabled)
            PrefsHelper.getMdmPrefs(context).edit().putBoolean("camera_disabled", disabled).apply()
            true
        } catch (e: SecurityException) {
            e.printStackTrace()
            false
        }
    }

    fun isCameraDisabled(): Boolean {
        return PrefsHelper.getMdmPrefs(context).getBoolean("camera_disabled", false)
    }

    fun setScreenCaptureBlocked(block: Boolean): Boolean {
        return try {
            dpm.setScreenCaptureDisabled(adminComponent, block)
            PrefsHelper.getMdmPrefs(context).edit().putBoolean("screen_capture_blocked", block).apply()
            true
        } catch (e: SecurityException) {
            e.printStackTrace()
            false
        }
    }

    fun isScreenCaptureBlocked(): Boolean {
        return PrefsHelper.getMdmPrefs(context).getBoolean("screen_capture_blocked", false)
    }

    fun setStatusBarDisabled(disabled: Boolean): Boolean {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                dpm.setStatusBarDisabled(adminComponent, disabled)
                PrefsHelper.getMdmPrefs(context).edit().putBoolean("statusbar_disabled", disabled).apply()
                true
            } else {
                false
            }
        } catch (e: SecurityException) {
            e.printStackTrace()
            false
        }
    }

    fun isStatusBarDisabled(): Boolean {
        return PrefsHelper.getMdmPrefs(context).getBoolean("statusbar_disabled", false)
    }

    fun setKeyguardDisabled(disabled: Boolean): Boolean {
        return try {
            dpm.setKeyguardDisabled(adminComponent, disabled)
            PrefsHelper.getMdmPrefs(context).edit().putBoolean("keyguard_disabled", disabled).apply()
            true
        } catch (e: Exception) {
            e.printStackTrace()
            false
        }
    }

    fun isKeyguardDisabled(): Boolean {
        return PrefsHelper.getMdmPrefs(context).getBoolean("keyguard_disabled", false)
    }

    fun setAdjustVolumeBlocked(block: Boolean) =
        setRestriction(UserManager.DISALLOW_ADJUST_VOLUME, block)

    fun setAppsControlBlocked(block: Boolean) =
        setRestriction(UserManager.DISALLOW_APPS_CONTROL, block)

    fun setBluetoothBlocked(block: Boolean) =
        setRestriction(UserManager.DISALLOW_BLUETOOTH, block)

    fun setBluetoothSharingBlocked(block: Boolean) =
        setRestriction(UserManager.DISALLOW_BLUETOOTH_SHARING, block)

    fun setExternalMediaBlocked(block: Boolean) =
        setRestriction(UserManager.DISALLOW_MOUNT_PHYSICAL_MEDIA, block)

    fun setTetheringBlocked(block: Boolean) =
        setRestriction(UserManager.DISALLOW_CONFIG_TETHERING, block)

    fun setVpnConfigBlocked(block: Boolean): Boolean {
        return try {
            if (block) {
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                        dpm.setAlwaysOnVpnPackage(adminComponent, context.packageName, false)
                    }
                } catch (e: Exception) {
                    android.util.Log.w("PolicyManager", "No se pudo configurar Always-on VPN: ${e.message}")
                }
                setRestriction(UserManager.DISALLOW_CONFIG_VPN, true)
            } else {
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                        dpm.setAlwaysOnVpnPackage(adminComponent, null, false)
                    }
                } catch (e: Exception) {
                    e.printStackTrace()
                }
                setRestriction(UserManager.DISALLOW_CONFIG_VPN, false)
            }
            true
        } catch (e: Exception) {
            e.printStackTrace()
            false
        }
    }

    fun setAdBlockingEnabled(enabled: Boolean): Boolean {
        return try {
            PrefsHelper.getMdmPrefs(context).edit().putBoolean("global_ad_blocking", enabled).apply()
            
            if (enabled) {
                try {
                    val prepareIntent = VpnService.prepare(context)
                    if (prepareIntent == null) {
                        val startServiceIntent = Intent(context, com.ejemplo.locksuite.service.KosherVpnService::class.java)
                        context.startService(startServiceIntent)
                        
                        if (isRestrictionEnabled(UserManager.DISALLOW_CONFIG_VPN)) {
                            setVpnConfigBlocked(true)
                        }
                    }
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            } else {
                if (WebViewBlockManager.getBlockedPackages(context).isEmpty()) {
                    val stopServiceIntent = Intent(context, com.ejemplo.locksuite.service.KosherVpnService::class.java).apply {
                        action = "STOP_VPN"
                    }
                    context.startService(stopServiceIntent)
                }
            }
            true
        } catch (e: Exception) {
            e.printStackTrace()
            false
        }
    }

    fun isAdBlockingEnabled(): Boolean {
        return PrefsHelper.getMdmPrefs(context).getBoolean("global_ad_blocking", false)
    }

    fun setInternetBlocked(block: Boolean): Boolean {
        return try {
            if (block) {
                val proxyInfo = android.net.ProxyInfo.buildDirectProxy("127.0.0.1", 9999)
                dpm.setRecommendedGlobalProxy(adminComponent, proxyInfo)
            } else {
                dpm.setRecommendedGlobalProxy(adminComponent, null)
            }
            PrefsHelper.getMdmPrefs(context).edit().putBoolean("internet_blocked", block).apply()
            true
        } catch (e: Exception) {
            e.printStackTrace()
            false
        }
    }

    fun isInternetBlocked(): Boolean {
        return PrefsHelper.getMdmPrefs(context).getBoolean("internet_blocked", false)
    }

    fun isRestrictionEnabled(restriction: String): Boolean {
        return PrefsHelper.getMdmPrefs(context).getBoolean(restriction, false)
    }

    fun reapplyAllRestrictions() {
        val restrictions = listOf(
            UserManager.DISALLOW_FACTORY_RESET,
            UserManager.DISALLOW_INSTALL_APPS,
            UserManager.DISALLOW_UNINSTALL_APPS,
            UserManager.DISALLOW_DEBUGGING_FEATURES,
            UserManager.DISALLOW_USER_SWITCH,
            UserManager.DISALLOW_MODIFY_ACCOUNTS,
            UserManager.DISALLOW_SAFE_BOOT,
            UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES,
            UserManager.DISALLOW_CONFIG_WIFI,
            UserManager.DISALLOW_NETWORK_RESET,
            "no_config_mobile_networks",
            UserManager.DISALLOW_ADJUST_VOLUME,
            UserManager.DISALLOW_APPS_CONTROL,
            UserManager.DISALLOW_BLUETOOTH,
            UserManager.DISALLOW_BLUETOOTH_SHARING,
            UserManager.DISALLOW_MOUNT_PHYSICAL_MEDIA,
            UserManager.DISALLOW_CONFIG_TETHERING,
            UserManager.DISALLOW_CONFIG_VPN
        )

        restrictions.forEach { restriction ->
            if (isRestrictionEnabled(restriction)) {
                try {
                    dpm.addUserRestriction(adminComponent, restriction)
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }
        }

        try {
            dpm.setUninstallBlocked(adminComponent, context.packageName, true)
        } catch (e: Exception) {
            e.printStackTrace()
        }

        if (isCameraDisabled()) setCameraDisabled(true)
        if (isKeyguardDisabled()) setKeyguardDisabled(true)
        if (isStatusBarDisabled()) setStatusBarDisabled(true)
        if (isScreenCaptureBlocked()) setScreenCaptureBlocked(true)
        if (isInternetBlocked()) setInternetBlocked(true)

        if (isRestrictionEnabled(UserManager.DISALLOW_INSTALL_APPS)) {
            try {
                dpm.setPackagesSuspended(adminComponent, arrayOf("com.android.vending"), true)
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }

        if (isFrpEnabled()) {
            setFrpPolicy(getFrpAccounts(), useDefaultFrp(), true)
        }
        if (areBrowsersSuspended()) {
            setBrowsersSuspended(true)
        }
        if (isSystemWebViewSuspended()) {
            setSystemWebViewSuspended(true)
        }
    }

    fun clearAllRestrictions() {
        val restrictions = listOf(
            UserManager.DISALLOW_FACTORY_RESET,
            UserManager.DISALLOW_INSTALL_APPS,
            UserManager.DISALLOW_UNINSTALL_APPS,
            UserManager.DISALLOW_DEBUGGING_FEATURES,
            UserManager.DISALLOW_USER_SWITCH,
            UserManager.DISALLOW_MODIFY_ACCOUNTS,
            UserManager.DISALLOW_SAFE_BOOT,
            UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES,
            UserManager.DISALLOW_CONFIG_WIFI,
            UserManager.DISALLOW_NETWORK_RESET,
            "no_config_mobile_networks",
            UserManager.DISALLOW_ADJUST_VOLUME,
            UserManager.DISALLOW_APPS_CONTROL,
            UserManager.DISALLOW_BLUETOOTH,
            UserManager.DISALLOW_BLUETOOTH_SHARING,
            UserManager.DISALLOW_MOUNT_PHYSICAL_MEDIA,
            UserManager.DISALLOW_CONFIG_TETHERING,
            UserManager.DISALLOW_CONFIG_VPN
        )

        restrictions.forEach { restriction ->
            try {
                dpm.clearUserRestriction(adminComponent, restriction)
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }

        try {
            dpm.setUninstallBlocked(adminComponent, context.packageName, false)
        } catch (e: Exception) {
            e.printStackTrace()
        }

        setCameraDisabled(false)
        setKeyguardDisabled(false)
        setStatusBarDisabled(false)
        setScreenCaptureBlocked(false)
        setInternetBlocked(false)
        clearFrpPolicy()

        try {
            dpm.setPackagesSuspended(adminComponent, arrayOf("com.android.vending"), false)
        } catch (e: Exception) {
            e.printStackTrace()
        }

        setBrowsersSuspended(false)
        setSystemWebViewSuspended(false)
        WebViewBlockManager.clearAll(context)
        PrefsHelper.getMdmPrefs(context).edit().clear().apply()
    }

    private val KNOWN_BROWSER_PACKAGES = listOf(
        "com.android.chrome",
        "com.chrome.beta",
        "org.mozilla.firefox",
        "org.mozilla.focus",
        "com.opera.browser",
        "com.opera.mini.native",
        "com.microsoft.emmx",
        "com.sec.android.app.sbrowser",
        "com.brave.browser",
        "com.duckduckgo.mobile.android",
        "com.android.browser",
        "com.UCMobile.intl",
        "com.kiwibrowser.browser"
    )

    private fun getInstalledBrowserPackages(): Set<String> {
        val pm = context.packageManager
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com"))
        val list = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            pm.queryIntentActivities(intent, PackageManager.ResolveInfoFlags.of(PackageManager.MATCH_ALL.toLong()))
        } else {
            @Suppress("DEPRECATION")
            pm.queryIntentActivities(intent, PackageManager.MATCH_ALL)
        }
        return list.map { it.activityInfo.packageName }
            .filterNot { it == context.packageName }
            .toSet()
    }

    fun suspendAllKnownBrowsers(suspend: Boolean) {
        val pm = context.packageManager
        val dynamicBrowsers = getInstalledBrowserPackages()
        val allBrowsers = (dynamicBrowsers + KNOWN_BROWSER_PACKAGES).filter { pkg ->
            try {
                pm.getPackageInfo(pkg, 0)
                true
            } catch (e: Exception) {
                false
            }
        }.toSet()

        if (allBrowsers.isNotEmpty()) {
            try {
                dpm.setPackagesSuspended(adminComponent, allBrowsers.toTypedArray(), suspend)
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    fun setBrowsersSuspended(suspend: Boolean): Boolean {
        return try {
            suspendAllKnownBrowsers(suspend)
            PrefsHelper.getMdmPrefs(context).edit().putBoolean("browsers_suspended", suspend).apply()
            true
        } catch (e: Exception) {
            e.printStackTrace()
            false
        }
    }

    fun areBrowsersSuspended(): Boolean {
        return PrefsHelper.getMdmPrefs(context).getBoolean("browsers_suspended", false)
    }

    fun setSystemWebViewSuspended(suspend: Boolean): Boolean {
        val packages = listOf("com.google.android.webview", "com.android.webview")
        val pm = context.packageManager
        val installed = packages.filter { pkg ->
            try {
                pm.getPackageInfo(pkg, 0)
                true
            } catch (e: Exception) {
                false
            }
        }
        if (installed.isEmpty()) return false
        return try {
            dpm.setPackagesSuspended(adminComponent, installed.toTypedArray(), suspend)
            PrefsHelper.getMdmPrefs(context).edit().putBoolean("system_webview_suspended", suspend).apply()
            true
        } catch (e: Exception) {
            e.printStackTrace()
            false
        }
    }

    fun isSystemWebViewSuspended(): Boolean {
        return PrefsHelper.getMdmPrefs(context).getBoolean("system_webview_suspended", false)
    }

    fun setFrpPolicy(accountsList: List<String>, useDefault: Boolean, enabled: Boolean): Boolean {
        return try {
            val finalAccounts = if (useDefault && enabled) {
                listOf(com.ejemplo.locksuite.util.Constants.getDefaultFrpAccountId())
            } else {
                accountsList.map { it.trim() }.filter { it.isNotEmpty() }
            }

            if (enabled && !useDefault && finalAccounts.isEmpty()) {
                return false
            }

            var success = false

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                try {
                    applyOfficialFrpPolicy(finalAccounts, enabled)
                    success = true
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }

            if (!success) {
                try {
                    applyLegacyFrpPolicy(finalAccounts, enabled)
                    success = true
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }

            if (success) {
                setLegacyFrpHardening(enabled)

                val prefs = PrefsHelper.getMdmPrefs(context)
                prefs.edit()
                    .putBoolean("frp_enabled", enabled)
                    .putBoolean("frp_use_default", useDefault)
                    .putStringSet("frp_accounts", accountsList.toSet())
                    .apply()
            }
            success
        } catch (e: Exception) {
            e.printStackTrace()
            false
        }
    }

    private fun applyOfficialFrpPolicy(accounts: List<String>, enabled: Boolean) {
        if (enabled && accounts.isNotEmpty()) {
            val policy = android.app.admin.FactoryResetProtectionPolicy.Builder()
                .setFactoryResetProtectionAccounts(accounts)
                .setFactoryResetProtectionEnabled(true)
                .build()
            dpm.setFactoryResetProtectionPolicy(adminComponent, policy)
        } else {
            dpm.setFactoryResetProtectionPolicy(adminComponent, null)
        }
    }

    private fun applyLegacyFrpPolicy(accounts: List<String>, enabled: Boolean) {
        val bundle = try {
            dpm.getApplicationRestrictions(adminComponent, GOOGLE_PLAY_SERVICES_PACKAGE)
        } catch (e: Exception) {
            Bundle()
        }

        if (enabled && accounts.isNotEmpty()) {
            val accountsArray = accounts.toTypedArray()
            LEGACY_FRP_ACCOUNT_KEYS.forEach { key ->
                bundle.putStringArray(key, accountsArray)
            }
            bundle.putBoolean("factoryResetProtectionEnabled", true)
            bundle.putBoolean("disableFactoryResetProtectionAdmin", false)
        } else {
            LEGACY_FRP_ACCOUNT_KEYS.forEach { key ->
                bundle.remove(key)
            }
            bundle.putBoolean("factoryResetProtectionEnabled", false)
            bundle.putBoolean("disableFactoryResetProtectionAdmin", true)
        }

        dpm.setApplicationRestrictions(adminComponent, GOOGLE_PLAY_SERVICES_PACKAGE, bundle)
        notifyLegacyFrpChanged()
    }

    private fun clearFrpPolicy() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                dpm.setFactoryResetProtectionPolicy(adminComponent, null)
            }
            applyLegacyFrpPolicy(emptyList(), false)
            setLegacyFrpHardening(false)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun notifyLegacyFrpChanged() {
        val intent = Intent(FRP_CONFIG_CHANGED_ACTION).apply {
            setPackage(GOOGLE_PLAY_SERVICES_PACKAGE)
        }
        context.sendBroadcast(intent)
    }

    private fun setLegacyFrpHardening(enabled: Boolean) {
        listOf(
            UserManager.DISALLOW_FACTORY_RESET,
            UserManager.DISALLOW_MODIFY_ACCOUNTS,
            UserManager.DISALLOW_SAFE_BOOT
        ).forEach { restriction ->
            try {
                if (enabled) {
                    dpm.addUserRestriction(adminComponent, restriction)
                } else if (!isRestrictionEnabled(restriction)) {
                    dpm.clearUserRestriction(adminComponent, restriction)
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    fun isFrpEnabled(): Boolean = PrefsHelper.getMdmPrefs(context).getBoolean("frp_enabled", false)
    fun useDefaultFrp(): Boolean = PrefsHelper.getMdmPrefs(context).getBoolean("frp_use_default", true)
    fun getFrpAccounts(): List<String> {
        val set = PrefsHelper.getMdmPrefs(context).getStringSet("frp_accounts", null)
        return if (set != null && set.isNotEmpty()) set.toList() else emptyList()
    }
}
```

---

### 📄 AndroidManifest.xml
Ubicación: `app/src/main/AndroidManifest.xml`
```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://tools.android.com/tools">

    <!-- PERMISOS REQUERIDOS -->
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_SPECIAL_USE" />
    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />
    <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" />
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.DELETE_PACKAGES" />
    <uses-permission android:name="android.permission.QUERY_ALL_PACKAGES" tools:ignore="QueryAllPackagesPermission" />
    <uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />

    <application
        android:name=".LockSuiteApplication"
        android:allowBackup="false"
        android:icon="@drawable/ic_logo"
        android:label="LockSuite MDM"
        android:roundIcon="@drawable/ic_logo"
        android:supportsRtl="true"
        android:theme="@style/Theme.LockSuite"
        tools:replace="android:allowBackup,android:icon,android:roundIcon">

        <receiver
            android:name=".receiver.DeviceAdminReceiver"
            android:description="@string/device_admin_description"
            android:label="LockSuite MDM Admin"
            android:permission="android.permission.BIND_DEVICE_ADMIN"
            android:exported="true">
            <meta-data
                android:name="android.app.device_admin"
                android:resource="@xml/device_admin_policies" />
            <intent-filter>
                <action android:name="android.app.action.DEVICE_ADMIN_ENABLED" />
            </intent-filter>
        </receiver>

        <receiver
            android:name=".receiver.BootReceiver"
            android:exported="true">
            <intent-filter android:priority="999">
                <action android:name="android.intent.action.BOOT_COMPLETED" />
                <action android:name="android.intent.action.LOCKED_BOOT_COMPLETED" />
            </intent-filter>
        </receiver>

        <receiver
            android:name=".receiver.SecretCodeReceiver"
            android:exported="true">
            <intent-filter>
                <action android:name="android.provider.Telephony.SECRET_CODE" />
                <data android:scheme="android_secret_code" android:host="1234" />
                <data android:scheme="android_secret_code" android:host="9999" />
            </intent-filter>
        </receiver>

        <service
            android:name=".service.WatchdogForegroundService"
            android:foregroundServiceType="specialUse"
            android:exported="false" />

        <service
            android:name=".service.LockSuiteFirebaseService"
            android:exported="false">
            <intent-filter>
                <action android:name="com.google.firebase.MESSAGING_EVENT" />
            </intent-filter>
        </service>

        <service
            android:name="com.ejemplo.locksuite.service.LockSuiteAccessibilityService"
            android:permission="android.permission.BIND_ACCESSIBILITY_SERVICE"
            android:exported="true">
            <intent-filter>
                <action android:name="android.view.accessibility.AccessibilityService" />
            </intent-filter>
            <meta-data
                android:name="android.accessibilityservice"
                android:resource="@xml/accessibility_service_config" />
        </service>

        <service
            android:name="com.ejemplo.locksuite.service.KosherVpnService"
            android:permission="android.permission.BIND_VPN_SERVICE"
            android:exported="false">
            <intent-filter>
                <action android:name="android.net.VpnService" />
            </intent-filter>
        </service>

        <service
            android:name=".service.LockSuiteTileService"
            android:icon="@drawable/ic_logo"
            android:label="LockSuite MDM"
            android:permission="android.permission.BIND_QUICK_SETTINGS_TILE"
            android:exported="true">
            <intent-filter>
                <action android:name="android.service.quicksettings.action.QS_TILE" />
            </intent-filter>
        </service>

        <activity-alias
            android:name=".LauncherAlias"
            android:targetActivity=".ui.auth.LoginActivity"
            android:enabled="true"
            android:icon="@drawable/ic_logo"
            android:label="LockSuite MDM"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity-alias>

        <activity
            android:name=".ui.auth.LoginActivity"
            android:exported="true"
            android:showWhenLocked="true"
            android:turnScreenOn="true">
            <intent-filter>
                <action android:name="android.intent.action.APPLICATION_PREFERENCES" />
                <category android:name="android.intent.category.DEFAULT" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.MANAGE_APP_SETTINGS" />
                <category android:name="android.intent.category.DEFAULT" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="locksuite" android:host="open" />
            </intent-filter>
        </activity>

        <activity
            android:name=".ui.auth.SetupPinActivity"
            android:exported="false"
            android:showWhenLocked="true"
            android:turnScreenOn="true" />

        <activity
            android:name=".ui.dashboard.DashboardActivity"
            android:exported="false" />

        <activity
            android:name=".ui.emergency.EmergencyActivity"
            android:exported="false"
            android:showWhenLocked="true"
            android:turnScreenOn="true" />

        <activity
            android:name=".ui.emergency.BlockAccessibilityActivity"
            android:exported="false"
            android:showWhenLocked="true"
            android:turnScreenOn="true" />

        <receiver
            android:name=".receiver.UninstallReceiver"
            android:exported="false" />

    </application>
</manifest>
```

---

## 5. Muestra de JSON Real de Dispositivo (Firebase Realtime Database)

```json
{
  "deviceName": "Celular Eli Pro",
  "model": "Qin F21 Pro",
  "lastSeen": 1783440000000,
  "fcmToken": "fcm_token_example_123456789",
  "pinHash": "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
  "pinSalt": "abcde12345==",
  "installAppsBlocked": false,
  "uninstallAppsBlocked": true,
  "factoryResetBlocked": true,
  "cameraDisabled": false,
  "allowedPackages": [
    "com.whatsapp",
    "com.android.dialer"
  ],
  "apps": {
    "com_whatsapp": {
      "packageName": "com.whatsapp",
      "label": "WhatsApp",
      "isHidden": false,
      "isSuspended": false,
      "isWebViewBlocked": false,
      "imageBlockingMode": "none",
      "appType": "user",
      "isCritical": false
    }
  },
  "info": {
    "deviceName": "Celular Eli Pro",
    "model": "Qin F21 Pro",
    "lastSeen": 1783440000000,
    "fcmToken": "fcm_token_example_123456789",
    "pinHash": "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
    "pinSalt": "abcde12345==",
    "installAppsBlocked": false,
    "uninstallAppsBlocked": true,
    "factoryResetBlocked": true,
    "cameraDisabled": false,
    "apps": {
      "com_whatsapp": {
        "packageName": "com.whatsapp",
        "label": "WhatsApp",
        "isHidden": false,
        "isSuspended": false,
        "isWebViewBlocked": false,
        "imageBlockingMode": "none",
        "appType": "user",
        "isCritical": false
      }
    }
  }
}
```
