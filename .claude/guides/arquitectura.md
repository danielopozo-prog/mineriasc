# Arquitectura de la app

Sitio 100 % estático: HTML + CSS + JS vanilla, sin build. Se sirve con cualquier
servidor estático (`python -m http.server 8123`); `fetch` impide abrirlo con doble clic.

## Orden de carga (index.html)

```
js/uex.js        → objeto UEX (cliente API, sin dependencias)
js/data.js       → objeto DATA (carga JSON, índices) + utilidades globales
js/finder.js     → objeto Finder (pestaña Buscador)
js/locations.js  → objeto Locations (pestaña Ubicaciones)
js/refinery.js   → objeto Refinery (pestaña Refinería, render perezoso)
js/inventory.js  → objeto Inventory (pestaña Inventario)
js/signals.js    → objeto Signals (pestaña Señales, múltiplos de escáner,
                   búsqueda inversa y favoritos de mineral)
js/app.js        → arranque: DATA.load() → init de vistas → DATA.loadUexPrices()
```

El orden importa: cada módulo asume que los anteriores existen como globales.

## Flujo de arranque (app.js)

1. `DATA.load()` — carga `data/mining_data.json` y construye índices; si falla, la app
   muestra error y no sigue. A continuación carga también `data/uex_locations.json`
   (catálogo ampliado de ciudades/estaciones/outposts, vendorizado desde UEX — ver
   `.claude/guides/datos-juego.md`) envuelto en `try/catch`: si falta o está corrupto,
   `DATA.uexLocations` queda `[]` y `DATA.allLocations()` sigue funcionando solo con las
   zonas de minado de `mining_data.json`, sin bloquear el arranque.
2. `Finder.init()`, `Locations.init()`, `Inventory.init()`, `Signals.init()` — la app ya
   es usable con datos de juego, sin precios. Cualquier vista que necesite el listado
   COMPLETO de ubicaciones (no solo zonas de minado) usa `DATA.allLocations()` — síncrona,
   ya resuelta tras `await DATA.load()`, sin fetch adicional.
3. `DATA.loadUexPrices()` — en segundo plano; al resolver, re-renderiza las vistas que
   muestran precios (`Signals` no depende de UEX — solo lee `scanner_signals`, así que
   no se refresca aquí). Si la API falla, la app sigue funcionando (el header lo indica).
4. `Refinery.render()` solo se ejecuta al entrar en su pestaña (flag `rendered`).

## Convenciones

- Utilidades globales en `data.js`: `fmtNum(n, dec)` (formato es-ES), `esc(s)` (escape
  HTML — obligatorio para todo contenido dinámico), `showToast(msg)`, y los diccionarios
  `LOC_TYPE_ES` / `METHOD_ES` (traducción de tipos y métodos) / `RARITY_ES` +
  `RARITY_ORDER` (rareza, ver `DATA.rarityFor()` abajo).
- `DATA.rarityFor(oreKey)` → `{tier, label}` o `null` (rareza no disponible para ese
  mineral). `DATA.bestRefineryFor(oreKey, limit=3)` → `[{station, system, bonusPct}]`
  ordenado descendente, `[]` si no hay dato. Ambos son síncronos y están disponibles
  justo tras `await DATA.load()` (dato 100% local, sin dependencia de la API en vivo de
  UEX) — detalle de la fuente y sus huecos en `.claude/guides/datos-juego.md`.
- Sistema visual (`css/styles.css`): tema negro casi puro (`--bg: #0a0a0a`) con acento
  rojo carmesí (`--accent: #d81f2b`, sustituye al ámbar histórico) y acento secundario
  naranja (`--accent-2`) para kickers de sección (`.kicker`, texto pequeño en mayúsculas
  tipo "STAR CITIZEN · ..."). Titulares (`.brand h1`, `.panel-head h2`, `.detail h3/h4`)
  usan `--font-display` (Teko); controles/tablas usan `--font-ui` (Saira Condensed).
  Ambas fuentes están vendorizadas como `.woff2` en `assets/fonts/` con `@font-face` —
  nunca CDN de Google Fonts (el gate lo comprueba en `index.html` y `css/styles.css`).
  Los paneles `.detail` llevan esquinas HUD (pseudo-elementos `::before`/`::after` con
  borde rojo) como detalle decorativo sutil.
- Cada vista es un objeto literal con `init()` / `render*()`; estado en propiedades
  (`selected`, `groupBy`…). Sin clases, sin módulos ES.
- Claves de `localStorage`: `mineriasc_inventory` (inventario), `mineriasc_uex_*`
  (caché de la API con timestamp) y `mineriasc_favorites` (array de claves de
  mineral marcadas como favoritas en la pestaña Señales).
- Los listados laterales (`.side-item`) se regeneran enteros en cada render y
  re-atachan sus listeners; no hay delegación de eventos.
- Pestaña Señales (`js/signals.js`): además de la tabla de múltiplos por
  mineral (×1…×15), tiene dos añadidos:
  - **Jerarquía visual de múltiplos**: cada bloque de valor base separa las
    tarjetas en dos grupos — `.mult-grid-main` (×1-5, cifra grande,
    protagonista) y `.mult-grid-rest` (×6-15, cifra ~mitad de tamaño,
    compacta), con un separador sutil `.mult-sep` entre ambos. El tamaño de
    cifra escala junto con la media query de `css/styles.css` (base móvil,
    ≥700px, ≥1100px) manteniendo siempre la proporción ~2:1 entre grupos.
  - **Búsqueda inversa** (`#sig-reverse-input` → `Signals.renderReverse`):
    el jugador teclea la cifra que le muestra el escáner (acepta puntos de
    miles, se limpia con un regex a solo dígitos) y la vista calcula, para
    cada valor base de señal, el múltiplo (1..15) más cercano
    (`Signals.bestCandidatesPerGroup` — un candidato por mineral/valor, no
    los 15 múltiplos sueltos, para que un favorito no acapare el top con
    tiros lejanos). Si hay coincidencia exacta (`diff === 0`) se listan
    todas; si no, las 5 más cercanas por desviación absoluta.
  - **Favoritos** (estrella `.fav-star` en cada `.side-item` y en la
    cabecera del detalle, con `stopPropagation` para no disparar la
    selección): persisten en `mineriasc_favorites`, se listan agrupados
    bajo "Favoritos" arriba de la lista lateral, y se priorizan (antes que
    la cercanía) al ordenar los resultados de la búsqueda inversa.

## Página hermana: `contadores.html`

El sitio tiene una segunda página estática, independiente de la de arriba: temporizadores
de Star Citizen (Hangar Ejecutivo, impresoras de tarjetas, bóveda, loot, Compboards),
portada del proyecto hermano `star-citizen-timers` y retemada a la paleta/tipografía de
este sitio (mismo `assets/fonts/*.woff2`, sin CDN).

- Carga: `contadores.html` → `css/contadores.css` (propio, no comparte cascada con
  `css/styles.css`) → `js/contadores.js` (IIFE autocontenida, sin dependencia de
  `DATA`/`UEX`/otros módulos de arriba).
- Estado propio en `localStorage['pyro-ops-v1']` (namespace ajeno a `mineriasc_*`,
  verificado sin colisión). La vista activa vive en `location.hash`, nunca en el
  estado guardado (dos pestañas del navegador no deben arrastrarse la sección visible
  la una a la otra).
- `js/contadores.js` no usa `getElementById`: usa un helper `$('#id')`
  (`querySelector`) — el gate lo busca con una segunda expresión regular además de
  `getElementById(...)`.
- Paleta duplicada en JS: `FAVICON_TONES` (pinta el favicon en `<canvas>`, sin acceso a
  la cascada CSS) debe coincidir con `--ok/--info/--warn/--accent/--dim` de
  `css/contadores.css`; el gate lo compara.
- Navegación cruzada: `index.html` enlaza a `contadores.html` (botón «⏱ Contadores» en
  la cabecera) y `contadores.html` enlaza de vuelta a `index.html` (both en la
  cabecera y en el pie); el gate comprueba que ambos `href` existan.

## Verificación real en navegador (`.claude/scripts/browser_check.py`)

El gate (`gate.py`) es estático: comprueba texto y estructura de archivos, no que la
app funcione de verdad en un navegador. Para eso existe `browser_check.py`, que
encapsula el patrón de Chrome headless + DevTools Protocol para que ningún agente
tenga que reinventarlo:

1. Sirve la carpeta del proyecto en `http://localhost:8123` (reutiliza un servidor ya
   levantado en ese puerto si lo encuentra; si no, arranca uno temporal con
   `python -m http.server` y lo cierra al terminar).
2. Lanza Chrome headless con remote debugging (autodetecta `chrome.exe`; admite
   `--chrome` o la variable de entorno `CHROME_PATH` como overrides). Requiere el flag
   `--remote-allow-origins=*` — sin él, Chrome moderno rechaza el handshake websocket
   del CDP con 403 (hardening post CVE-2022-3699); ya viene incluido en el script.
3. Abre la página indicada (`--path`, por defecto `/index.html`).
4. Si se pasa `--wait "<expresión JS>"`, hace polling hasta que sea verdadera o
   agota `--timeout` (por defecto 10 s).
5. Evalúa cada `--eval "<expresión JS>"` (repetible) vía `Runtime.evaluate` y
   vuelca un JSON por stdout con los valores/errores; sale con código 0 si todo
   fue bien, 1 si `--wait` no se cumplió o alguna expresión lanzó excepción.
6. Cierra Chrome siempre; el servidor solo si lo arrancó él mismo (nunca mata uno
   que ya estaba corriendo).

**Viewport de escritorio (`--width`/`--height`)**: sin estos flags, Chrome headless
abre con su tamaño de ventana por defecto (~758px de ancho), insuficiente para
verificar breakpoints de escritorio — la web tiene `max-width: 1600px` y el split a
1 columna solo colapsa por debajo de 800px, así que a ~758px siempre se ve el layout
móvil aunque el cambio sea de escritorio. Pasa ambos juntos (`--width 1900 --height
950`) para aplicar `Emulation.setDeviceMetricsOverride` antes de navegar; si se omiten
los dos, el comportamiento es idéntico al de antes de este flag.

**Orden real de ejecución, no el de la línea de comandos**: el script siempre resuelve
`--wait` primero y solo *después* corre todos los `--eval`, sin importar en qué orden
los intercalaste al invocarlo. Si la condición de `--wait` depende de una acción que tú
mismo disparas con un `--eval` (p. ej. un clic de pestaña que dispara un `fetch`), ese
`--eval` todavía no se ha ejecutado cuando el `--wait` empieza a hacer polling, así que
nunca se cumple. Solución: mete el clic y el polling en un único `--eval` async:

```bash
python .claude/scripts/browser_check.py --path index.html \
  --eval "(async () => { document.querySelector('[data-tab=\"refineria\"]').click();
    const t0 = Date.now();
    while (Date.now() - t0 < 12000 && !document.querySelector('#refinery-methods .stars')) {
      await new Promise(r => setTimeout(r, 200));
    }
    return document.querySelectorAll('#refinery-methods .stars').length; })()"
```

Ejemplo real (usado para verificar que `marketplaceAveragesAll` sirve datos):

```bash
python .claude/scripts/browser_check.py \
    --wait "DATA.marketplaceReady === true" \
    --eval "DATA.marketplaceAvgFor('COPPER').find(t => t.qualityTier === 5).priceAvgScu"
```

No sustituye a probar las pestañas a ojo cuando el cambio es de interacción/visual —
para eso sigue haciendo falta abrir el navegador de verdad — pero cubre la
comprobación reproducible de "esta expresión/dato es correcto en tiempo de
ejecución", útil tanto para `web-ui` (ids, render, `DATA`/`UEX` ya cargados) como
para `datos-uex` (forma de los datos, ausencia de errores de carga).

**Trampa de Git Bash/MSYS con `--path`**: pasa la ruta sin barra inicial
(`--path index.html`, no `--path /index.html`). MSYS reescribe argumentos que
parecen paths absolutos Unix a paths de Windows antes de que Python los vea
(`/index.html` → `file:///C:/Program Files/Git/index.html`), así que Chrome
navega a un archivo inexistente y todo `--wait`/`--eval` falla con
`chrome-error://chromewebdata/`. Alternativa: exportar `MSYS_NO_PATHCONV=1`
para esa llamada si necesitas conservar la barra inicial.
