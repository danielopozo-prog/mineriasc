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
js/missions.js   → objeto Missions (pestaña Misiones, ver más abajo) + diccionarios
                   gear/type/subtype de scmdb.net, reutilizados por crafting.js
js/crafting.js   → objeto Crafting (pestaña Crafteo, búsqueda inversa de
                   blueprints por material o por objeto, ver más abajo)
js/app.js        → arranque: DATA.load() → init de vistas → DATA.loadUexPrices()
```

El orden importa: cada módulo asume que los anteriores existen como globales.
`js/missions.js` carga ANTES que `js/crafting.js` porque el modo "Objetos" de
Crafteo reutiliza sus diccionarios de traducción (`MISSION_GEAR_ES`/
`MISSION_TYPE_TAX_ES`/`MISSION_SUBTYPE_ES` y las funciones `missionGearLabel`/
`missionTypeLabel`/`missionSubtypeLabel`) — misma taxonomía de
`DATA.missionProducts()`, no duplicada en dos archivos.

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
   `Missions.init()`, `Crafting.init()` — la app ya es usable con datos de juego, sin
   precios. Cualquier vista que necesite el listado COMPLETO de ubicaciones (no solo
   zonas de minado) usa `DATA.allLocations()` — síncrona, ya resuelta tras
   `await DATA.load()`, sin fetch adicional. `Crafting.init()`/`Missions.init()` no
   dependen de UEX en absoluto (100% datos locales, igual que
   `DATA.craftBlueprints()`/`DATA.craftByMaterial()`/`DATA.missionsList()`).
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
- **Sistema visual — "terminal/consola militar"** (`css/styles.css`): restyle a partir
  de tokens medidos en el DOM de una herramienta interna de referencia
  (yokais.es/herramientas/star-citizen-fps). Negro casi puro (`--bg: #0a0a0a`), paneles
  `#0d0b0b`/`#131010` con borde 1px SÓLIDO ladrillo apagado (`--border-muted: #7a3630`,
  ya no translúcido) y **radio 0 en todo** (`--radius`/`--radius-sm: 0`, incluidas las
  pastillas/chips que antes eran `border-radius: 20px` — solo quedan redondos los puntos
  de estado tipo LED: `.rarity-dot`, `.phase__dot`/`.chip` de contadores.css). Acento
  primario rojo vivo (`--accent: #d81f2b`, títulos de sección/estados activos/alertas);
  `--accent-2` REDEFINIDO a salmón claro de énfasis (`#ef8d88`, antes naranja
  `#ff6a3d` — mismo rol de "acento secundario/resaltado" en ~15 sitios, favoritos,
  etiquetas de grupo…, así que cambiar el valor bastó); `--text-dim` REDEFINIDO a
  salmón desaturado (`#d3adaa`, antes gris `#8a8a8a`) para TODO texto secundario
  legible (hints, labels, subtítulos) — el "apagado" que también dio la referencia
  (`#6b5754`) mide ~2,94:1 de contraste sobre `--bg` (por debajo de AA 4.5:1), así que
  se reserva a `--text-muted` para elementos no textuales/decorativos, nunca para texto
  de lectura (detalle completo, con los números de contraste, en el comentario del
  `:root` de `css/styles.css`). `--info` retinta a cian (`#4fd8d0`, antes azul) y hay
  `--warn` nuevo (ámbar `#fcbb00`, aplicado a las filas de "pocos anuncios" del
  Marketplace P2P — antes solo atenuadas con opacidad). `--good` (verde menta) ya
  estaba correcto y ahora también colorea `.stat .value.accent`/`.inv-box-meta .accent`
  (SIEMPRE precios en esta app, verificado contra los 3 sitios donde JS emite esa
  clase — "precios en verde" sin tocar JS). Botón fantasma (`.btn.small`, la mayoría de
  botones) con tokens propios `--btn-ghost-bg`/`--btn-ghost-border`; primario (`.btn`:
  Añadir, Actualizar) en rojo.
  Controles/labels/botones en `--font-ui`, ahora monoespaciada (`ui-monospace,
  SFMono-Regular, Consolas, monospace` — stack de sistema, sin vendorizar nada nuevo);
  `--font-num` (cifras densas: matriz de señales, múltiplos) se unificó con `--font-ui`
  porque una mono ya da alineación tabular por diseño. Titulares grandes (`.brand h1`,
  `.panel-head h2`, `.detail h3`) conservan `--font-display` (Teko + Saira Condensed de
  fallback, ambas vendorizadas como `.woff2` en `assets/fonts/` con `@font-face` — nunca
  CDN de Google Fonts, el gate lo comprueba en `index.html` y `css/styles.css`).
  Cabeceras de sección en patrón `"[ Nombre ]"` (`.panel-head h2`, `.detail h4/h5`,
  `#craft-list .craft-section-name`, `.inv-box-name`): `::before`/`::after` con
  `content: "[ "`/`" ]"` **en línea con el texto, sin `display:flex` ni línea creciente
  hasta el borde** — una primera versión SÍ usaba flex + un `::after` con `flex:1` y
  `border-bottom` para simular la línea, pero se rompía en viewports estrechos (900px):
  el pseudo-elemento, al ser un item de flex aparte, no sigue el flujo del texto cuando
  este envuelve a 2 líneas y queda flotando suelto en su propia línea. Se prioriza que
  nunca desborde/rompa sobre la fidelidad literal de "línea hasta el borde". `.card h5`
  (fichas de refinería y de ingrediente en el simulador de calidad de Crafteo) se
  excluye a propósito de este patrón (`display: block` + `content: none` en sus
  pseudo-elementos): sin el reset heredaría los corchetes de `.detail h5` (ambas viven
  dentro de un `.detail`), y el nombre del ingrediente + slot entre paréntesis puede
  partirse en 2 líneas igual que el bug de arriba.
  Los paneles `.detail` siguen llevando esquinas HUD (pseudo-elementos `::before`/
  `::after` con borde rojo) como detalle decorativo, sin cambios.
  `css/contadores.css` (página hermana) alinea sus propios tokens (`--line`, `--muted`,
  `--dim`, `--info`, `--accent-2`) a los mismos valores por coherencia, pero CONSERVA su
  identidad propia de esquinas cortadas (`clip-path`, `--notch`) en vez de aplanarlas a
  0: no son esquinas redondeadas, son un recurso HUD ya angular — aplanarlas habría sido
  una reestructuración visual mayor, fuera de "coherencia". Si se retoca `--dim`/`--info`
  ahí, hay que actualizar también `FAVICON_TONES` en `js/contadores.js` (el gate lo
  compara, ver más abajo).
- Cada vista es un objeto literal con `init()` / `render*()`; estado en propiedades
  (`selected`, `groupBy`…). Sin clases, sin módulos ES.
- Claves de `localStorage`: `mineriasc_inventory` (inventario), `mineriasc_uex_*`
  (caché de la API con timestamp), `mineriasc_favorites` (array de claves de
  mineral marcadas como favoritas en la pestaña Señales), y el criterio de orden
  de cada lista ordenable (ver más abajo): `mineriasc_finder_sort`,
  `mineriasc_locations_sort`, `mineriasc_crafting_sort`, `mineriasc_missions_sort`.
- **Listas ordenables** (Buscador, Ubicaciones, Crafteo, Misiones): un `<select>`
  pequeño (≤5 opciones, nunca envuelto con `SearchSelect`) junto al buscador/filtro
  de cada pestaña, dentro de un contenedor `.panel-head-actions`. Mismo patrón en
  las cuatro vistas — estado `sortBy`/`SORT_KEY`, `loadSort()`/`saveSort()`
  (try/catch por si `localStorage` no está disponible, igual que el resto de
  la app) y el `<select>`.value ya sirve de indicador del criterio activo, sin
  marcado extra. Criterios numéricos: descendente por defecto, valores sin
  dato SIEMPRE van al final (nunca se inventan) empatando por nombre. Cuando
  el criterio depende de datos en vivo (Buscador: precio refinado/P2P, solo
  disponibles tras `DATA.uexReady`/`DATA.marketplaceReady`), el propio
  `<option>` se marca "(cargando…)" mientras tanto y el orden cae al empate
  alfabético sin romper — se recalcula solo cuando `app.js` vuelve a llamar a
  `renderList()` tras `loadUexPrices()`/`loadMarketplaceAverages()`.
  Crafteo es la excepción de marcado: su lista de materiales NO es un
  `<select>` — es una lista lateral SIEMPRE VISIBLE (`#craft-materials`, ver
  más abajo), porque reordenar las `<option>` de un combo cerrado (como se
  hizo primero, reutilizando `SearchSelect`) no se percibía como "la lista se
  reordena de verdad" hasta abrirlo — feedback real de uso. El criterio
  "rareza" de Crafteo (`craftMaterialRarity`) resuelve el material al mineral
  de `DATA.ores` vía
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

Layout de 3 columnas (`.craft-layout`, grid `260px 1fr`, colapsa a 1 columna
por debajo de 800px igual que `.split`): lista de materiales SIEMPRE VISIBLE a
la izquierda, y a la derecha el `.craft-main` con el `.split` de siempre
(lista de objetos + ficha). Sigue utilizable a 1280px de ancho (verificado):
materiales ~260px + `.split` interno 280px + resto para la ficha.

1. **Lista de materiales** (`#craft-materials`, `.side-item` estándar dentro
   de `.craft-materials-panel` — NO un `<select>`/combo: se probó primero
   como un `<select>` envuelto con `SearchSelect.enhance`, pero reordenar las
   `<option>` de un combo cerrado no se percibía como "la lista se reordena
   de verdad" hasta abrirlo, así que se sustituyó por una lista lateral
   visible con su propio buscador (`#craft-material-search`) y su propio
   `<select>` de orden (`#craft-material-sort`, ≤5 opciones, sin
   `SearchSelect`) en `.craft-materials-head`). Cada fila: punto de rareza
   (`craftMaterialRarityDotHtml`, reutiliza `rarityDotHtml` de `js/finder.js`
   — carga antes, ya disponible como global) + nombre a la izquierda, nº de
   objetos crafteables a la derecha; fila activa resaltada igual que el resto
   de listas laterales. Las filas se derivan de `Crafting.materialsIndex()`,
   que recorre `DATA.craftBlueprints()` en vez de `DATA.ores`: no todo
   material de sc-craft.tools es un mineral de mining_data.json
   (`"Pressurized Ice"`, ver `CRAFT_NAME_OVERRIDES` en `js/data.js`) —
   recorrer solo `ores` dejaría fuera ese material pese a que sí tiene
   planos. `Crafting.sortedMaterials()` aplica `this.materialSort`;
   `renderMaterials()` filtra además por `this.materialSearch` y repinta. El
   identificador que viaja por toda la vista (`data-raw`, `this.selectedMaterial`)
   es el nombre EXACTO de `ingredients[].name` (no una clave normalizada): se
   le pasa tal cual a `DATA.craftByMaterial()`, que ya sabe normalizarlo.
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

### Modo "Objetos" (`Crafting.craftMode`)

Segundo modo de la lista lateral, alternado con "Materiales" vía dos botones
(`#craft-mode-materials`/`#craft-mode-objects`, `Crafting.setMode()`) que
reutilizan el MISMO contenedor `#craft-materials`: en vez de partir de un
material y ver qué lo usa, busca directamente en el catálogo de scmdb.net
(`DATA.missionProducts()`, ~1600 objetos — la misma fuente que consume
`js/missions.js`) por texto + categoría + subtipo dependiente.

- `CRAFT_OBJ_CATEGORIES` agrupa las 14 combinaciones reales de `gear`+`type`
  vistas en el catálogo del parche actual (Armadura, Armas FPS, Munición,
  Armamento de nave, Refrigeración, Planta de energía, Escudos, Radar, Motor
  cuántico, Láser de minería, Rayo tractor, Repostaje, Reciclaje de nave,
  Objetos de misión) — una combinación futura no listada aquí simplemente no
  aparece como opción de categoría, no rompe nada. El subtipo (`<select>`
  dependiente, `#craft-object-subtype`) se oculta si la categoría elegida solo
  tiene un subtipo real (el filtro no aportaría nada).
- `Crafting.blueprintForProduct(product)` cruza `product.tag` (scmdb.net) con
  `blueprint.blueprint_id` (sc-craft.tools) case-insensitive, memoizado en
  `Crafting.blueprintByTagIndex()` — mismo criterio que
  `DATA.missionsForCraftBlueprint()` en `js/data.js`, pero en sentido inverso
  (de producto a plano). Si hay receta local, `renderObjectDetail()` reutiliza
  `renderDetail()` tal cual (misma ficha completa que en modo Materiales); si
  no (~8 de 1597), ficha mínima con lo que sí trae scmdb.net + sus misiones
  vía `DATA.missionsForProduct()` — sin inventar ingredientes.
- Cualquier ficha de objeto crafteable (llegue por material o por objeto) trae
  además la tabla "Misiones que recompensan este objeto"
  (`Crafting.missionsSectionHtml()`, fuente scmdb.net vía
  `DATA.missionsForCraftBlueprint()`/`missionsForProduct()`) — DISTINTA de la
  tabla preexistente "Misiones que sueltan este plano" (fuente sc-craft.tools,
  `bp.missions`, sin id de misión con el que enlazar). Cada fila de la nueva
  tabla trae un botón "Ver misión →" que llama a `Missions.show(m.id)` — ver
  sección de abajo.

## Pestaña Misiones (`js/missions.js`)

Catálogo de contratos de scmdb.net (`data/missions.json`, ver
`DATA.missionsList()`/`missionById()` en `js/data.js` y
`.claude/guides/datos-juego.md` para el formato en disco). Mismo patrón de
vista que el resto: objeto literal `Missions` con `init()`/`render*()`,
filtros como propiedades de estado, sin clases ni módulos ES.

**Filtros** (`Missions.matches(m)`): texto libre (título+descripción+facción+
tipo), categoría y sistema como chips (`Missions.renderButtonFilter()`,
reutilizable, mismo patrón que `#system-filter` de Ubicaciones), tipo de
misión y facción como `<select>` (23 y 24 valores reales — demasiados para
chips), legalidad/compartible/disponibilidad como chips de 3 estados, "solo
con recompensa de plano" (checkbox, mismo marcado `.inv-cat-check` que
Inventario) y rango de recompensa UEC (dos `<input type="number">`). Lista
ordenable por recompensa/título/facción, criterio en
`localStorage["mineriasc_missions_sort"]`.

**API pública — `Missions.show(id)`**: único punto de entrada para saltar a
esta pestaña desde otra vista (hoy solo Crafteo, ver arriba). Limpia los
filtros primero (si no, una búsqueda o filtro activo podría dejar la misión de
destino fuera de la lista visible aunque su ficha sí se abra), llama a
`activateTab("misiones")` — función GLOBAL definida en `js/app.js` fuera de la
IIFE de arranque, extraída del listener de clic de las pestañas precisamente
para que saltos programáticos como este la reutilicen en vez de duplicar la
lógica de "qué pestaña está activa" — y abre la ficha con `select(id)`.

**Degradación**: si `data/missions.json` no cargó, `DATA.missions.ready` queda
`false` (mismo contrato que `DATA.craft.ready`) y `Missions.init()` llama a
`renderUnavailable()` — controles deshabilitados, mensaje de estado, resto de
la app intacta. El modo "Objetos" de Crafteo degrada en paralelo sin ningún
código adicional: `DATA.missionProducts()` devuelve `[]`, así que
`Crafting.renderObjects()` muestra "Catálogo de objetos no disponible" y el
`<select>` de categoría queda solo con "Todas (0)" — el modo "Materiales" no
se ve afectado (solo desaparece la sección de misiones cruzadas de su ficha,
que ya comprueba longitud 0 antes de renderizar).

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

**Trampa de `--wait` contra `DATA.raw`/flags "false por defecto"**: `DATA.raw !== null`
se cumple nada más resolverse el PRIMER fetch de `DATA.load()` (`data/mining_data.json`),
mucho antes de que terminen los fetches posteriores de `craft_blueprints.json`/
`missions.json` y de que `app.js` llame a `Missions.init()`/`Crafting.init()` — un
`--wait "DATA.raw !== null"` deja que los `--eval` siguientes corran contra una app a
medio arrancar, y como flags como `DATA.missions.ready` empiezan en `false` TANTO "aún
cargando" COMO "cargó y falló", un resultado `false` inesperado no distingue una cosa de
otra (detectado probando la degradación sin `data/missions.json`: los primeros `--eval`
veían el HTML estático sin tocar, y una llamada manual a la MISMA función que ya se
suponía ejecutada funcionaba bien — la función nunca estuvo rota, solo aún no se había
llamado). Espera algo que solo cambia al FINAL de `main()` en `js/app.js`, p. ej.
`document.getElementById('craft-materials').children.length > 0` (se rellena en el mismo
`Crafting.init()` que corre justo después de `Missions.init()`, exista o no
`data/missions.json`).

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
