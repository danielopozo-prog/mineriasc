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
js/app.js        → arranque: DATA.load() → init de vistas → DATA.loadUexPrices()
```

El orden importa: cada módulo asume que los anteriores existen como globales.

## Flujo de arranque (app.js)

1. `DATA.load()` — carga `data/mining_data.json` y construye índices. Si falla, la app
   muestra error y no sigue.
2. `Finder.init()`, `Locations.init()`, `Inventory.init()` — la app ya es usable con
   datos de juego, sin precios.
3. `DATA.loadUexPrices()` — en segundo plano; al resolver, re-renderiza las vistas que
   muestran precios. Si la API falla, la app sigue funcionando (el header lo indica).
4. `Refinery.render()` solo se ejecuta al entrar en su pestaña (flag `rendered`).

## Convenciones

- Utilidades globales en `data.js`: `fmtNum(n, dec)` (formato es-ES), `esc(s)` (escape
  HTML — obligatorio para todo contenido dinámico), `showToast(msg)`, y los diccionarios
  `LOC_TYPE_ES` / `METHOD_ES` (traducción de tipos y métodos).
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
- Claves de `localStorage`: `mineriasc_inventory` (inventario) y `mineriasc_uex_*`
  (caché de la API con timestamp).
- Los listados laterales (`.side-item`) se regeneran enteros en cada render y
  re-atachan sus listeners; no hay delegación de eventos.
