# Arquitectura de la app

Sitio 100 % estático: HTML + CSS + JS vanilla, sin build. Se sirve con cualquier
servidor estático (`python -m http.server 8123`); `fetch` impide abrirlo con doble clic.

## Orden de carga (index.html)

```
js/uex.js        → objeto UEX (cliente API, sin dependencias)
js/data.js       → objeto DATA (carga JSON, índices) + utilidades globales
js/searchselect.js → objeto SearchSelect (combo con buscador, ver más abajo)
js/finder.js     → objeto Finder (pestaña Buscador)
js/locations.js  → objeto Locations (pestaña Ubicaciones)
js/refinery.js   → objeto Refinery (pestaña Refinería, render perezoso)
js/inventory.js  → objeto Inventory (pestaña Inventario)
js/signals.js    → objeto Signals (pestaña Señales, múltiplos de escáner,
                   búsqueda inversa y favoritos de mineral)
js/crafting.js   → objeto Crafting (pestaña Crafteo, búsqueda inversa de
                   blueprints por material, ver más abajo)
js/app.js        → arranque: DATA.load() → init de vistas → DATA.loadUexPrices()
```

El orden importa: cada módulo asume que los anteriores existen como globales.

## Flujo de arranque (app.js)

1. `DATA.load()` — carga `data/mining_data.json` y construye índices; si falla, la app
   muestra error y no sigue. A continuación carga también `data/uex_locations.json`
   (catálogo ampliado de ciudades/estaciones/outposts, vendorizado desde UEX — ver
   `.claude/guides/datos-juego.md`) y `data/craft_blueprints.json` (planos de fabricación,
   vendorizados desde sc-craft.tools), ambos envueltos en `try/catch`: si faltan o están
   corruptos, `DATA.uexLocations`/`DATA.craft.blueprints` quedan `[]` y el resto de la app
   (incluida la pestaña Crafteo, con su propio mensaje de estado) sigue funcionando sin
   bloquear el arranque.
2. `Finder.init()`, `Locations.init()`, `Inventory.init()`, `Signals.init()`,
   `Crafting.init()` — la app ya es usable con datos de juego, sin precios. Cualquier
   vista que necesite el listado COMPLETO de ubicaciones (no solo zonas de minado) usa
   `DATA.allLocations()` — síncrona, ya resuelta tras `await DATA.load()`, sin fetch
   adicional. `Crafting.init()` no depende de UEX en absoluto (100% datos locales, igual
   que `DATA.craftBlueprints()`/`DATA.craftByMaterial()`).
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
  (caché de la API con timestamp), `mineriasc_favorites` (array de claves de
  mineral marcadas como favoritas en la pestaña Señales), y el criterio de orden
  de cada lista ordenable (ver más abajo): `mineriasc_finder_sort`,
  `mineriasc_locations_sort`, `mineriasc_crafting_sort`.
- **Listas ordenables** (Buscador, Ubicaciones, Crafteo): un `<select>` pequeño
  (≤5 opciones, nunca envuelto con `SearchSelect`) junto al buscador/filtro de
  cada pestaña, dentro de un contenedor `.panel-head-actions`. Mismo patrón en
  las tres vistas — estado `sortBy`/`SORT_KEY`, `loadSort()`/`saveSort()`
  (try/catch por si `localStorage` no está disponible, igual que el resto de
  la app) y el `<select>`.value ya sirve de indicador del criterio activo, sin
  marcado extra. Criterios numéricos: descendente por defecto, valores sin
  dato SIEMPRE van al final (nunca se inventan) empatando por nombre. Cuando
  el criterio depende de datos en vivo (Buscador: precio refinado/P2P, solo
  disponibles tras `DATA.uexReady`/`DATA.marketplaceReady`), el propio
  `<option>` se marca "(cargando…)" mientras tanto y el orden cae al empate
  alfabético sin romper — se recalcula solo cuando `app.js` vuelve a llamar a
  `renderList()` tras `loadUexPrices()`/`loadMarketplaceAverages()`.
  `js/crafting.js` reordena las `<option>` del propio `#craft-material-select`
  (un `SearchSelect`) en vez de añadir una API nueva a `js/searchselect.js`:
  reasignar `sel.innerHTML` + restaurar `sel.value` + `sel._sselApi.sync()`
  basta, porque el `MutationObserver` interno de `SearchSelect` ya refresca el
  panel de opciones solo si estaba abierto. El criterio "rareza" de Crafteo
  (`craftMaterialRarity`) resuelve el material al mineral de `DATA.ores` vía
  `DATA.oreKeyForCraftMaterial(rawName)` — resolutor INVERSO de la
  normalización que ya usa `craftByMaterial` (`CRAFT_NAME_OVERRIDES` +
  `craftBaseName`), expuesto por datos-uex a petición de esta vista (antes
  `crafting.js` reimplementaba un match exacto de `display_name` que solo
  cubría 34 de 36 materiales; ver contrato en `.claude/guides/datos-juego.md`).
  Cubre los 36 materiales reales del parche actual, incluidos Aluminum/
  Quantainium (grafía distinta a mining_data.json). Solo queda sin rareza
  "Pressurized Ice" (no es el `ICE` de minería, no tiene entrada en `ores` —
  caso real, no un hueco de cobertura) y cualquier mineral sin tier fiable en
  `mining_data.json` (`DATA.rarityFor` ya devuelve `null` en ese caso); ambos
  van al final del orden, igual que el resto de "sin dato".
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

## Combo con buscador (`js/searchselect.js`)

`SearchSelect.enhance(select, {placeholder})` envuelve un `<select>` de 6+
opciones en un desplegable con un cuadro de texto que filtra en vivo
(insensible a mayúsculas/acentos vía `normalize("NFD")` +
`replace(/[\u0300-\u036f]/g, "")`). Se usa en Inventario (`#inv-ore`,
`#inv-category`, `#inv-loc`) y en Señales (`#sig-loc-select`); selects de ≤5
opciones (p. ej. `#inv-entry-type`) se quedan como `<select>` nativo — el
criterio de cuándo envolver uno lo decide quien llama a `enhance()`, no el
módulo.

Diseño clave: el `<select>` original **nunca se quita del DOM** — se mueve
dentro de un `<div class="ssel">`, queda invisible (`opacity: 0`) pero
superpuesto exactamente al botón visible (`.ssel-trigger`, mismo `inset: 0`),
y sigue siendo la única fuente de verdad (`value`, `required`, `disabled`,
`hidden`). Elegir una opción del panel hace `select.value = ...` y dispara un
evento `"change"` nativo sobre él, así que ningún módulo que ya escuchaba
`change` o leía `.value` con `getElementById` tuvo que cambiar. Dos huecos a
tener en cuenta si se reutiliza en una vista nueva:

- Si algo asigna `select.value` **por código** (no por click del usuario) —
  como `Signals.clearLocation()` — hay que llamar después a
  `select._sselApi.sync()`: asignar `.value` no dispara `change`, así que la
  etiqueta del botón no se actualiza sola.
- Un `MutationObserver` interno vigila `hidden`/`disabled`/`required` y los
  hijos (`<option>`/`<optgroup>`) del `<select>` original, así que código que
  alterna `oreSel.hidden = ...` (como `Inventory.updateEntryTypeUI()`) sigue
  funcionando sin llamar a nada del combo explícitamente.

CSS en `css/styles.css` bajo `/* Combo con buscador */`: incluye
`.ssel[hidden] { display: none; }` porque una regla de autor con `[hidden]`
gana siempre a la hoja de estilos del user-agent (mismo motivo que
`.split[hidden]`/`.inv-box-body[hidden]`, comentado más arriba en el propio
CSS) y `.ssel-panel .ssel-search` con especificidad reforzada para no perder
frente a `.inv-form input`.

## Pestaña Crafteo (`js/crafting.js`)

Búsqueda inversa de planos de fabricación: en vez de "¿dónde vendo este
mineral?" (Buscador), "¿para qué sirve?". Datos 100% locales
(`DATA.craftBlueprints()`/`DATA.craftByMaterial()`, ver `js/data.js` y
`.claude/guides/datos-juego.md`), ya resueltos tras `await DATA.load()` —
`Crafting.init()` no depende de ninguna API en vivo, a diferencia de
Finder/Locations (precios UEX).

Flujo (mismo patrón `.split` de side-list + detail que el resto de pestañas,
más un selector de material arriba en vez de un buscador de texto libre):

1. **Selector de material** (`#craft-material-select`, envuelto con
   `SearchSelect.enhance` — 36 materiales, muy por encima del umbral de 5-6
   del combo con buscador). Las opciones se derivan de
   `Crafting.materialsIndex()`, que recorre `DATA.craftBlueprints()` en vez
   de `DATA.ores`: no todo material de sc-craft.tools es un mineral de
   mining_data.json (`"Pressurized Ice"`, ver `CRAFT_NAME_OVERRIDES` en
   `js/data.js`) — recorrer solo `ores` dejaría fuera ese material pese a que
   sí tiene planos. El `value` de cada `<option>` es el nombre EXACTO de
   `ingredients[].name` (no una clave normalizada): se le pasa tal cual a
   `DATA.craftByMaterial()`, que ya sabe normalizarlo.
2. **Lista de objetos** (`#craft-list`, `.side-item` estándar): un plano
   puede usar el mismo material en 2+ slots distintos (66 planos en el
   parche actual, p.ej. "QuikCool" usa Iron en `SHELL` y en `PUMP IMPELLER`)
   — `Crafting.selectMaterial()` agrupa por `blueprint.id` sumando la
   cantidad, así que el contador "N objetos usan X" cuenta objetos
   DISTINTOS, no filas de ingrediente (con Iron, por ejemplo, son 227
   objetos distintos pero 247 filas de ingrediente — la cifra correcta para
   "cuántos objetos" es la primera). Orden ascendente por cantidad.

   La lista está agrupada en secciones por categoría (`craftSectionKey`/
   `CRAFT_SECTION_ES`: nivel 1 de `category` para Weapons/Ammo, nivel 2 para
   Armour/Vehiclegear — ver el comentario largo junto a `craftSectionKey` en
   `js/crafting.js` para el porqué de la asimetría) y cada sección es un
   **acordeón**: `<button class="side-group-head" aria-expanded>` con el
   nombre y el contador SIEMPRE visibles, más un `<div class="side-group-body"
   hidden>` con los `.side-item` — mismo patrón que las cajas de ubicación de
   Inventario (`.inv-box-head`/`.inv-box-body`/`[hidden]`), reutilizado aquí
   en vez de inventar otro. Plegadas por defecto (`Crafting.openSections`, un
   `Set` de claves de sección, vacío al cambiar de material); varias pueden
   estar abiertas a la vez.

   Encima de la lista, **chips de filtro** (`#craft-filters`, mismo patrón
   visual que `.sig-loc-method-filter` de Señales — pastilla apagada hasta
   que se activa, varias a la vez vía `Set`, sin su código de color por
   método porque aquí no hay una paleta fija de 3 colores por grupo) para
   tres grupos, cada uno mostrado solo si tiene algún valor presente entre
   los objetos del material elegido:
   - **Peso** (Ligera/Media/Pesada): nivel 3 de `category`, solo si el nivel
     1 es `"Armour"` — verificado que ese nivel 3 es SIEMPRE uno de esos 3
     valores exactos en todo el catálogo (`craftArmorWeight`).
   - **Pieza** (Casco/Torso/Brazos/Piernas): `category` no trae la pieza —
     va en el NOMBRE del plano. `craftArmorPiece` busca como palabra suelta
     (`\bHelmet\b`/`Core`/`Arms`/`Legs`, insensible a mayúsculas) en
     `blueprint.name`, restringido a `category` con nivel 1 `"Armour"` (sin
     ese guard, un arma o componente de nave cuyo nombre contuviera por
     casualidad "Arms" quedaría mal etiquetado). Verificado contra los 915
     nombres de Armour del parche actual: cubre 898 (98 %); los 17 restantes
     (trajes completos, ropa civil) y los ítems "Backpack"/"Undersuit" (no
     son ninguna de las 4 piezas pedidas) quedan sin pieza y no se filtran
     por este grupo — comportamiento a propósito, no un hueco.
   - **Tipo de arma** (Pistola/Rifle/SMG/LMG/Escopeta/Francotirador): nivel 2
     de `category`, solo si el nivel 1 es `"Weapons"` — los 6 valores reales
     verificados contra el catálogo completo (`craftWeaponType`).

   Los filtros son combinables: dentro de un grupo es OR (Ligera + Media =
   cualquiera de las dos), entre grupos es AND (Pesada + Casco = solo cascos
   pesados) — `Crafting.rowMatchesFilters()`. Al filtrar, las secciones vacías
   desaparecen solas (se agrupa sobre la lista ya filtrada) y el contador
   pasa de `"N objetos usan X"` a `"N de M objetos usan X"`. Los filtros
   (igual que las secciones abiertas) se vacían por completo en
   `selectMaterial()`, nunca se conservan entre materiales.
3. **Ficha** (`#craft-detail`): tabla de ingredientes por slot (todos, no
   solo los del material buscado — la ficha es del objeto completo),
   tiempo/tiers/masa, simulador de calidad y tabla de misiones que sueltan
   el plano (`missions[]`, ordenadas por `drop_chance` descendente).

**Simulador de calidad**: un único slider 0-1000 (`input[type=range]`,
estilado con `accent-color` en vez de pseudo-elementos de thumb — más simple
y suficiente para el tema oscuro) controla TODOS los ingredientes a la vez.
`interpolateQualityEffect(qe, q)` interpola `modifier_at_min` → 
`modifier_at_max` sobre `quality_min` → `quality_max`; si el efecto trae
`ranges` (tramos no lineales, p.ej. Power Pips en escalones de 250 en 250),
interpola DENTRO del tramo que contiene `q` en vez de en línea recta de
extremo a extremo — ignorar `ranges` da un resultado intermedio incorrecto.
Los dos `type` reales (`multiplicative`/`additive`) se formatean distinto
(`fmtQualityEffectValue`): un modificador `multiplicative` es un factor sobre
el stat base y se muestra como % (`115,0%`); uno `additive` es una cifra que
se SUMA al stat base (p.ej. Power Pips ±2) y se muestra como delta con signo
(`+2,00`) — mostrarlo como porcentaje sería falso, no es una proporción.

**Formato de cantidades** (`fmtCraftQty`, mismo contrato que
`ingredients[].unit`/`quantity_scu` — ver datos-juego.md): `unit: "scu"` con
`quantity_scu < 1` se muestra en cSCU (×100, más legible que "0,06 SCU");
`≥ 1`, en SCU con 2 decimales. `unit: "unit"` es un conteo de unidades
sueltas — **no** SCU pese al nombre del campo — se muestra tal cual con
sufijo "ud".

**Degradación**: si `data/craft_blueprints.json` no cargó,
`DATA.craft.ready` queda `false` (ver contrato en `js/data.js`) y
`Crafting.init()` llama a `renderUnavailable()` en vez de montar el selector
— mensaje de estado, selector deshabilitado, resto de la app intacta.

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
    --eval "DATA.marketplaceAvgFor('COPPER').find(t => t.unit === 'scu' && t.qualityTier === 5).priceAvg"
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
