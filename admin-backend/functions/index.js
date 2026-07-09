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
  "ENABLE_MAPS_IMAGE_BLOCKING",
  "DISABLE_MAPS_IMAGE_BLOCKING",
  "BLOCK_WHATSAPP_STATUS",
  "UNBLOCK_WHATSAPP_STATUS",
  "BLOCK_WHATSAPP_CHANNELS",
  "UNBLOCK_WHATSAPP_CHANNELS",
  "CHANGE_PIN",
  "ENABLE_STEALTH",
  "DISABLE_STEALTH",
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
  
  // Codificar el email reemplazando puntos Y @ por guiones bajos
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

async function verifyDevicePinOrThrow(deviceId, deviceRef, deviceData, adminUid, devicePin, rememberDevice) {
  const trustedAdmins = getDeviceField(deviceData, "trustedAdmins", {});
  if (trustedAdmins[adminUid] === true) {
    return;
  }

  // Intentar leer de la ruta segura deviceSecrets
  const secretsSnap = await admin.database().ref(`deviceSecrets/${deviceId}`).once("value");
  const secrets = secretsSnap.val() || {};
  let pinHash = secrets.pinHash;
  let pinSalt = secrets.pinSalt;

  // Fallback retrocompatible si aún está en la ruta pública
  if (!pinHash || !pinSalt) {
    pinHash = getDeviceField(deviceData, "pinHash");
    pinSalt = getDeviceField(deviceData, "pinSalt");
  }

  if (!pinHash || !pinSalt) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "DEVICE_PIN_NOT_ENROLLED"
    );
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

  await verifyDevicePinOrThrow(deviceId, deviceRef, deviceData, context.auth.uid, devicePin, rememberDevice);

  const token = getDeviceField(deviceData, "fcmToken");
  if (!token) {
    throw new functions.https.HttpsError(
      "not-found",
      "Ese dispositivo no tiene un token FCM registrado todavía (¿tiene la app abierta al menos una vez con internet?)."
    );
  }

  const commandId = crypto.randomUUID();
  const payload = { command, commandId };

  if (command === "CHANGE_PIN") {
    const { newPin } = data || {};
    if (!newPin || typeof newPin !== "string" || !/^\d{4,16}$/.test(newPin)) {
      throw new functions.https.HttpsError("invalid-argument", "El PIN debe ser puramente numérico y tener entre 4 y 16 dígitos.");
    }
    const saltBytes = crypto.randomBytes(16);
    const pinSalt = saltBytes.toString("base64");
    const pinHash = hashPinServerSide(newPin, pinSalt);

    payload.pinHash = pinHash;
    payload.pinSalt = pinSalt;

    // Guardar en la ruta secreta
    await admin.database().ref(`deviceSecrets/${deviceId}`).set({ pinHash, pinSalt });

    // Actualizar hasPinConfigured en la ruta pública y remover hashes viejos
    await deviceRef.child("hasPinConfigured").set(true);
    await deviceRef.child("info/hasPinConfigured").set(true).catch(() => {});
    await deviceRef.child("pinHash").remove().catch(() => {});
    await deviceRef.child("pinSalt").remove().catch(() => {});
    await deviceRef.child("info/pinHash").remove().catch(() => {});
    await deviceRef.child("info/pinSalt").remove().catch(() => {});

    // Limpiar sesiones recordadas antiguas para forzar re-ingreso del PIN
    await deviceRef.child("trustedAdmins").remove().catch(() => {});
    await deviceRef.child("info/trustedAdmins").remove().catch(() => {});
  } else if (command === "UPDATE_ALLOWLIST") {
    if (!Array.isArray(packages)) {
      throw new functions.https.HttpsError("invalid-argument", "Falta la lista de paquetes permitidos.");
    }
    const cleanPackages = packages
      .map((p) => String(p).trim())
      .filter((p) => /^[a-zA-Z0-9_.]+$/.test(p));
    payload.packages = cleanPackages.join(",");
    
    await deviceRef.child("allowedPackages").set(cleanPackages);
    await deviceRef.child("info/allowedPackages").set(cleanPackages).catch(() => {});
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

  // Guardar el log de comandos
  await admin.database().ref(`commandLog/${deviceId}`).push({
    command,
    commandId,
    packages: payload.packages || null,
    sentBy: context.auth.uid,
    sentAt: admin.database.ServerValue.TIMESTAMP,
  });

  // Inicializar el nodo de ACK como "sent" para rastreo en tiempo real
  const ackData = {
    status: "sent",
    command,
    timestamp: admin.database.ServerValue.TIMESTAMP
  };
  await deviceRef.child(`commandAcks/${commandId}`).set(ackData);
  await deviceRef.child(`info/commandAcks/${commandId}`).set(ackData).catch(() => {});

  return { success: true, commandId };
});

exports.sendCommandV3 = exports.sendCommandV2;

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
  await Promise.all([
    admin.database().ref(`devices/${deviceId}/trustedAdmins/${context.auth.uid}`).remove(),
    admin.database().ref(`devices/${deviceId}/info/trustedAdmins/${context.auth.uid}`).remove()
  ]);
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
        hasPinConfigured: !!(getDeviceField(info, "hasPinConfigured") || pinHash && pinSalt),
        trustedForMe: !!trustedAdmins[adminUid],
      };
    }),
  };
});
