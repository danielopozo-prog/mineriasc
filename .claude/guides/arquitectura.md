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

1. `DATA.load()` — carga `data/mining_data.json` y construye índices. Si falla, la app
   muestra error y no sigue.
2. `Finder.init()`, `Locations.init()`, `Inventory.init()`, `Signals.init()` — la app ya
   es usable con datos de juego, sin precios.
3. `DATA.loadUexPrices()` — en segundo plano; al resolver, re-renderiza las vistas que
   muestran precios (`Signals` no depende de UEX — solo lee `scanner_signals`, así que
   no se refresca aquí). Si la API falla, la app sigue funcionando (el header lo indica).
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
