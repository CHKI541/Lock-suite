/**
 * LockSuite WebADB Client - Powered by @yume-chan/adb (via esm.sh CDN)
 * Proper WebUSB ADB implementation for browsers.
 */

// NOTE: The actual ADB logic is loaded dynamically via ESM imports in the HTML.
// This file provides the WebADB wrapper class that installer.js uses.

class WebADB {
  constructor() {
    this.adb = null;
    this.connected = false;
  }

  static isSupported() {
    return 'usb' in navigator;
  }

  async requestDevice() {
    if (!WebADB.isSupported()) {
      throw new Error('Tu navegador no soporta WebUSB. Por favor usa Google Chrome, Microsoft Edge o Brave.');
    }
    // Trigger browser device picker - the actual connection happens in connect()
    // We store the permission by requesting it here
    const devices = await navigator.usb.requestDevice({ filters: [{ vendorId: undefined }] });
    return devices;
  }

  async connect() {
    if (!window._adbInstance) {
      throw new Error('La librería ADB no está cargada aún. Recarga la página e intenta de nuevo.');
    }
    this.adb = window._adbInstance;
    this.connected = true;
  }

  async shell(command) {
    if (!this.adb) throw new Error('ADB no conectado');
    const process = await this.adb.subprocess.spawnAndWait(command);
    return process.stdout;
  }

  async getDeviceAccounts() {
    try {
      const output = await this.shell('dumpsys account');
      const accounts = [];
      // Parse Google accounts from dumpsys output
      const regex = /Account\s*\{?\s*name=([^,\}\s]+)[^}]*type=([^\}\s]+)/gi;
      let match;
      while ((match = regex.exec(output)) !== null) {
        const name = match[1].trim();
        const type = match[2].trim();
        if (name && !accounts.some(a => a.name === name)) {
          accounts.push({ name, type });
        }
      }
      // Fallback: look for email patterns
      if (accounts.length === 0) {
        const emailRegex = /name=([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/g;
        while ((match = emailRegex.exec(output)) !== null) {
          const name = match[1];
          if (!accounts.some(a => a.name === name)) {
            accounts.push({ name, type: 'com.google' });
          }
        }
      }
      return accounts;
    } catch (e) {
      console.warn('Error fetching accounts via dumpsys:', e);
      return [];
    }
  }

  async installApk(apkBlob, onProgress) {
    if (!this.adb) throw new Error('ADB no conectado');

    onProgress('Preparando instalación...', 5);

    // Convert blob to ArrayBuffer
    const buffer = await apkBlob.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    onProgress('Subiendo APK al dispositivo...', 10);

    // Push APK to device via sync
    const sync = await this.adb.sync();
    const remotePath = '/data/local/tmp/locksuite_install.apk';

    let lastProgress = 10;
    await sync.write({
      filename: remotePath,
      file: new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        }
      }),
      onProgress: (uploaded) => {
        const p = Math.min(75, 10 + Math.round((uploaded / bytes.length) * 65));
        if (p > lastProgress) {
          lastProgress = p;
          onProgress(`Transfiriendo... ${Math.round((uploaded / bytes.length) * 100)}%`, p);
        }
      }
    });
    sync.dispose();

    onProgress('Instalando en el sistema (pm install)...', 80);
    const installOut = await this.shell(`pm install -r ${remotePath}`);
    await this.shell(`rm -f ${remotePath}`);

    if (installOut.toLowerCase().includes('failure')) {
      throw new Error(`Error de instalación: ${installOut.trim()}`);
    }

    onProgress('Aplicando permisos de Device Owner...', 90);
    const doResult = await this.shell('dpm set-device-owner com.ejemplo.locksuite/.receiver.DeviceAdminReceiver');
    console.log('Device Owner result:', doResult);

    onProgress('Habilitando Servicio de Accesibilidad...', 96);
    await this.shell('settings put secure enabled_accessibility_services com.ejemplo.locksuite/com.ejemplo.locksuite.service.LockSuiteAccessibilityService');
    await this.shell('settings put secure accessibility_enabled 1');

    onProgress('¡Instalación completada con éxito!', 100);
    return doResult;
  }
}

window.WebADB = WebADB;
