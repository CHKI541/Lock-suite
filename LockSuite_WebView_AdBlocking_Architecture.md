# LockSuite Kosher — Arquitectura de Bloqueo de WebViews e Intercepción de Anuncios

Este documento detalla la ingeniería implementada en **LockSuite Kosher** para resolver dos de los desafíos técnicos más importantes en la filtración de dispositivos Android:
1.  **Bloqueo selectivo de navegadores web internos (WebViews)** dentro de aplicaciones autorizadas.
2.  **Filtración global y bloqueo de anuncios publicitarios** a nivel de red.

Para lograrlo, la aplicación implementa una **estrategia híbrida de doble capa**: un filtro de tráfico a nivel de red (mediante un servicio VPN local en la Capa 3) y un supervisor de interfaz de usuario a nivel de aplicación (mediante un Servicio de Accesibilidad en la Capa 4).

---

## 1. Bloqueo de Anuncios y WebViews a Nivel de Red (Capa 3 - KosherVpnService)

La intercepción de tráfico y filtración DNS ocurre dentro de la clase [KosherVpnService](file:///C:/Users/israe/OneDrive/Documentos/Lock%20Suite%20segunda%20version/app/src/main/java/com/ejemplo/locksuite/service/KosherVpnService.kt).

```
[ Tráfico UDP del Dispositivo ] ──> [ Tunel VPN Local (tun0) ] ──> [ Interceptor DNS (Puerto 53) ]
                                                                           │
                                              ┌────────────────────────────┴────────────────────────────┐
                                              ▼                                                         ▼
                                     [ ¿Es un Anuncio? ]                                       [ ¿Es un WebView? ]
                              (Comparación contra blacklist)                              (Se resuelve UID de la app)
                                              │                                                         │
                     ┌────────────────────────┴────────────────────────┐       ┌────────────────────────┴────────────────────────┐
                     ▼                                                 ▼       ▼                                                 ▼
             [ SÍ: Bloquear ]                                      [ NO ]   [ SÍ: Bloquear ]                                 [ NO ]
            (Descarta el paquete,                              (Reenvía por                       (Filtra dominios no             (Reenvía por
             causa DNS Timeout)                                 WiFi/Datos)                        esenciales de la app)           WiFi/Datos)
```

### A. Mecanismo de Inicialización de la VPN
El servicio VPN se establece de manera local y autocontenida (no reenvía el tráfico a un servidor externo, protegiendo la privacidad y velocidad):
*   Se crea un túnel virtual `tun` con la dirección local privada `10.0.0.2/32`.
*   Se asigna un servidor DNS virtual en la dirección `10.0.0.1`.
*   Se configura una ruta exclusiva `10.0.0.1/32` para forzar que **únicamente las consultas de resolución de nombres (DNS) en el puerto 53 UDP** pasen a través de la VPN. El resto del tráfico de datos de las aplicaciones (HTTP, HTTPS, TCP) viaja directamente por la conexión física (WiFi/Datos) sin sobrecargar la CPU del teléfono.

### B. Bucle de Filtrado DNS (`runFilterLoop`)
El servicio lee continuamente del descriptor del archivo del túnel `tun`:
1.  Filtra y decodifica únicamente paquetes con protocolo **UDP** dirigidos al puerto **53** (DNS).
2.  Utiliza la clase [DnsPacketParser](file:///C:/Users/israe/OneDrive/Documentos/Lock%20Suite%20segunda%20version/app/src/main/java/com/ejemplo/locksuite/util/DnsPacketParser.kt) para extraer en caliente el string del dominio consultado (ej: `ads.doubleclick.net`).

### C. Bloqueo de Anuncios (AdBlocker)
*   Si la política de bloqueo global de anuncios está activa en los ajustes del administrador, el dominio se evalúa contra una base de datos local optimizada cargada asíncronamente en memoria ([AdBlocker](file:///C:/Users/israe/OneDrive/Documentos/Lock%20Suite%20segunda%20version/app/src/main/java/com/ejemplo/locksuite/util/AdBlocker.kt)).
*   Si coincide con un servidor de anuncios, el paquete de consulta **se descarta en silencio (no se responde)**. El cliente de red de la app que solicitó el anuncio experimenta un *timeout DNS*, impidiendo que la publicidad se descargue o se dibuje.

### D. Bloqueo de Red para WebViews
Para bloquear páginas web dentro de aplicaciones nativas sin romper la app entera:
1.  **Resolución del Dueño de la Conexión (`resolveOwnerUid`)**:
    El servicio asocia el puerto de origen de la consulta DNS UDP contra las tablas de sockets activos del sistema operativo mediante la llamada:
    ```kotlin
    connectivityManager.getConnectionOwnerUid(OsConstants.IPPROTO_UDP, localAddress, destAddress)
    ```
    Esto devuelve el **UID de la aplicación** en el sistema que disparó la consulta de red. Mediante el `packageManager`, el UID se traduce al nombre de paquete único de la aplicación (ej: `com.ejemplo.app`).
2.  **Filtrado Inteligente de Dominios (`WebViewPolicy`)**:
    Si la app de origen tiene la política de WebView bloqueada por el administrador, el servicio VPN evalúa el dominio consultado:
    *   **Apps conocidas**: Se utiliza una lista blanca estricta de dominios de infraestructura esenciales (`WebViewPolicy.getCoreDomainsFor`). Por ejemplo, en aplicaciones de transporte como *Waze* o *DiDi*, se permiten los mapas y pasarelas de pago, pero se bloquean dominios genéricos.
    *   **Apps genéricas**: Se aplica una lógica de auto-whitelist dinámica basada en palabras clave estructurales del propio nombre de paquete de la aplicación para permitir llamadas a sus APIs internas pero denegar navegación web externa.
    *   Si el dominio no es esencial, la consulta DNS no se reenvía, bloqueando la carga de páginas web externas dentro del componente web de la app.

---

## 2. Bloqueo de WebViews a Nivel de Interfaz (Capa 4 - LockSuiteAccessibilityService)

Dado que las aplicaciones pueden cachear consultas de red o utilizar IPs duras en el código para evadir la VPN, se implementa una segunda capa de seguridad a nivel visual en la clase [LockSuiteAccessibilityService](file:///C:/Users/israe/OneDrive/Documentos/Lock%20Suite%20segunda%20version/app/src/main/java/com/ejemplo/locksuite/service/LockSuiteAccessibilityService.kt).

### A. Detección por Cambio de Ventana (`TYPE_WINDOW_STATE_CHANGED`)
El servicio rastrea los cambios de foco de pantalla:
*   Mantiene una cola o pila (`appPackageStack`) con los últimos paquetes reales que el usuario abrió y que NO corresponden a navegadores o renderizadores web.
*   Si la pantalla cambia a un renderizador web conocido del sistema (como `com.android.chrome`, `com.google.android.webview`, etc.), la accesibilidad detecta la aplicación de origen (`originApp`) que estaba activa inmediatamente antes en la pila.
*   Si esa aplicación de origen tiene la política de WebView bloqueada, ejecuta el bloqueo de inmediato.

### B. Detección por Inspección del Árbol de Nodos (`containsWebView`)
Cuando una app con WebView bloqueado está activa, la accesibilidad inspecciona recursivamente la jerarquía visual de la pantalla en busca de elementos que coincidan con clases de renderizado:
*   Busca nombres de clase como `"android.webkit.WebView"`, `"android.view.SurfaceView"`, `"chromium"`, `"renderframe"`, `"geckoview"`, etc.
*   Esta búsqueda se realiza tanto al cargarse la ventana (`immediate = true`) como de forma diferida programando reintentos asíncronos en los siguientes milisegundos (`+200ms`, `+500ms`, `+900ms`, `+1500ms`, `+2500ms`) mediante un `Handler`. Esto evita que las aplicaciones carguen páginas web con retraso para evadir el escaneo inicial.

### C. Ejecución del Bloqueo (`triggerBlock`)
Si se detecta la presencia de un WebView o un navegador en una app prohibida:
1.  Muestra un mensaje emergente en pantalla: `"Navegador interno bloqueado por políticas del MDM"`.
2.  Inyecta la acción del sistema de retroceso: `performGlobalAction(GLOBAL_ACTION_BACK)` para cerrar o descartar la actividad del navegador/WebView.
3.  Establece un seguro post-bloqueo: 700 milisegundos después, comprueba si el usuario sigue en la pantalla bloqueada con el WebView abierto. Si la app ignoró el retroceso (ej: diálogos modales persistentes), inyecta la acción de inicio: `performGlobalAction(GLOBAL_ACTION_HOME)` para forzar la salida del usuario al escritorio del celular de forma segura.
