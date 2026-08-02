# Datos de juego (mining_data.json)

`data/mining_data.json` (~290 KB) es la base de datos de juego, tomada de Strata
(https://seeknd.github.io/Strata/). Es **dato generado**: nunca se edita a mano.

## Actualización tras un parche del juego

```bash
curl -o data/mining_data.json https://seeknd.github.io/Strata/data/mining_data.json
```

Después: gate (valida claves requeridas) + prueba en navegador. Vigilar `meta.current_patch`
y si UEX renombró commodities (guía uex-api.md).

## Claves que usa la app

| Clave | Contenido | Consumidor |
|---|---|---|
| `meta` | Parche, fecha, contadores | header (app.js) |
| `ores` | 39 minerales: `display_name`, `uex_name`, `mining_method`, `difficulty{instability, resistance, explosion_multiplier, cluster_factor…}` | Buscador, Inventario |
| `locations` | 86 ubicaciones: `display_name`, `system`, `type`, `has_refinery` | detalle de ubicación |
| `location_ores` | 48 zonas con `ores.{ship,fps,vehicle}[] = {ore, relative_probability, panel_confirmed}` | Ubicaciones + índice `oreToLocations` |
| `scanner_signals` | 76 señales: `signal_value`, `tier`, `ore_hint`, `mining_context` | pills del Buscador; también fuente de rareza (`DATA.oreRarity`, ver abajo) |
| `refineries.stations` | Estación → `{system, capacity_scu, yields{ORE: {value…}}}` (bonos % de rendimiento) | tabla de Refinería; también fuente de `DATA.bestRefineryFor()` |

Claves presentes pero **no usadas aún**: `compositions`, `cave_compositions`,
`mining_params`, `equipment` (láseres/módulos/cargas — candidata a pestaña futura),
`ore_elements`, `map_positions`, `planets`, `jump_gates`.

## Detalles que no son obvios

- Las claves de mineral son MAYÚSCULAS (`QUANTANIUM`); las de `location_ores` no
  coinciden con las de `locations` (`GLACIUM` vs `AARON_HALO`) — el cruce se hace por
  `name`/`display_name`, no por clave.
- `ore_locations` (singular invertido) existe pero viene **vacío**: no construir nada
  sobre él. `computed.best_mining_location` también viene vacío, pero
  `computed.best_refinery` **sí trae datos** (mapa ORE → única mejor estación) — no se
  usa como fuente: `DATA.bestRefineryFor()` deriva el top-3 directamente de
  `refineries.stations` (más flexible y verificado contra ese mismo campo, ver
  `.claude/guides/uex-api.md`).
- Los `yields` de refinería son enteros con signo (± %), no multiplicadores.
- **`location_ores[*].ores.{método}[]` trae entradas que NO son datos limpios,
  y no hay que "arreglarlas" en la carga — son así en el JSON que descarga
  Strata, verificado línea a línea (parche 4.9):
  - **Claves `ore: "UNKNOWN_<hash>"`** (7 hashes distintos, 129 de 457 filas
    totales en el parche actual — 28 %, concentradas casi todas en el método
    `fps`): son nodos de minado que **el propio Strata no ha podido
    identificar todavía** — se ve la probabilidad relativa pero no qué
    mineral es. TODAS estas filas traen `panel_confirmed: false` (0
    excepciones comprobadas); a la inversa, ningún `ore` conocido tiene
    `panel_confirmed: true` bajo una clave `UNKNOWN_`, así que el propio
    campo confirma la interpretación. No existe ninguna otra clave del JSON
    (`rock_types`, `cave_compositions`, `compositions`…) que traduzca el
    hash a un nombre — no hay nada que resolver, solo que no mostrar en
    crudo. **Contrato**: `DATA.oreLabel(oreKey)` devuelve `"Mineral sin
    identificar"` para estas claves en vez de la clave hash; cualquier vista
    que lea un `ore` de `location_ores` debe usar `DATA.oreLabel()`, no
    `DATA.ores[key]?.display_name` directo (ese patrón deja pasar el hash
    crudo si no hay entrada en `ores` — bug real visto en `locations.js`).
  - **`relative_probability: null`** con `ore` SÍ conocido y
    `panel_confirmed: true` (82 filas en el parche actual, ej. Dolivine/
    Aphorite/Hadanite en Pyro IV a pie): el mineral está confirmado en esa
    ubicación/método pero Strata aún no le ha medido % relativo. Es un hueco
    real de la fuente, no un fallo de `DATA.buildIndexes()` — el valor se
    preserva tal cual (`null`), nunca se sustituye por `0`. **Contrato**: la
    vista debe distinguir esto de un simple "sin dato" genérico (ej. "Sin
    medir" en vez de formatear `null` como `"—%"`, que se confunde con el
    guion que ya usa `fmtNum` para cualquier ausencia) — cambio de
    presentación, dominio `web-ui`.
  - Además existen 9 filas con `ore` conocido y `panel_confirmed: false` pero
    `relative_probability` sí numérico (ej. `IRON` en Pyro IV, método
    `ship`): probabilidad estimada pero no confirmada visualmente. No forma
    parte de los dos fallos de arriba; el campo está disponible por si una
    vista futura quiere marcarlo (icono "no confirmado"), pero no hay
    obligación de usarlo ahora.
- **No existe un campo `rarity`/`rareza` en `ores`** (comprobado: no está, ni en
  `mining_data.json` ni en `commodities` de la API de UEX). La única fuente real de
  rareza es `scanner_signals[*].tier`, y solo es fiable para los valores
  `common/uncommon/rare/epic/legendary` (contextos `ship`/`asteroid`/`surface`): para
  contextos `fps`/`vehicle` ese mismo campo `tier` repite el propio `mining_context`
  ("fps", "vehicle"), que NO es una rareza y hay que descartar explícitamente. Detalle
  completo, cobertura real (26/39 minerales) y motivo de los 13 sin dato en el
  comentario junto a `RARITY_TIERS_VALID` en `js/data.js`.

## Catálogo ampliado de ubicaciones (`data/uex_locations.json`)

`mining_data.json.locations` (86 entradas) es el catálogo de Strata: se centra en
**zonas de minado** (planetas, lunas, cinturones, puntos de Lagrange, un puñado de
estaciones "outlaw" de Pyro/Nyx). NO incluye ciudades ni la mayoría de estaciones
comerciales de Stanton (Everus Harbor, Baijini Point, Port Tressler, Seraphim
Station, Grim HEX…) ni outposts individuales (HDMS-*, Shubin Mining Facility *,
ArcCorp Mining Area *…). Para tener el listado COMPLETO de ubicaciones nombradas del
juego (usado por `DATA.allLocations()`, p. ej. para el selector de ubicación del
Inventario) se vendoriza un segundo fichero, **también dato generado, nunca a mano**:

```bash
python .claude/scripts/fetch_uex_locations.py
```

- Fuente: API de UEX Corp, endpoints `cities`, `space_stations`, `outposts` (ver
  `.claude/guides/uex-api.md`). A diferencia de `mining_data.json` (un único fetch,
  ya en el formato de la app), UEX no expone estos tres catálogos combinados ni en
  el formato final, así que el script hace 3 peticiones GET públicas, filtra a
  `is_available_live=1 && is_visible=1 && is_decommissioned=0` y normaliza a
  `{name, system, kind, planet, moon?}`.
- Por qué vendorizado y no fetch en vivo con caché de `localStorage` (como los
  precios de UEX): el selector de ubicación del Inventario debe funcionar **offline**
  (invariante "la app funciona sin la API de UEX"); un dato que rara vez cambia
  (nombres de ciudades/estaciones/outposts, no precios) no necesita refrescarse en
  cada sesión — igual que `mining_data.json`, se regenera tras un parche, no en cada
  carga de página.
- Nombre elegido por tipo: `space_stations` usa `nickname` (`"MIC-L1"`, `"Checkmate"`,
  `"Grim HEX"`) — es como Strata y la comunidad los llaman; el `name` completo de UEX
  es texto de sabor (`"MIC-L1 Shallow Frontier Station"`). `outposts` usa `name`
  completo (`"HDMS-Bezdek"`, no `"Bezdek"`) — más descriptivo. `cities` no tiene
  `nickname` en la API.
- Quirk de UEX conocido: alguna ubicación tiene dos filas bajo el mismo nombre (p.ej.
  dos outposts "Jumptown" en Stanton — uno en Yela, resto fantasma previo a la
  reubicación a Daymar). El script deduplica por `(nombre, sistema)` quedándose con
  la fila de mayor `date_added` (la más reciente en la API).
- Tamaño real (parche actual): ~24 KB, 175 ubicaciones únicas (5 ciudades, 59
  estaciones, 112 outposts, contadores exactos en `meta.counts` del propio fichero).
- Consumo: `DATA.load()` lo carga en `DATA.uexLocations` tras `mining_data.json`,
  envuelto en `try/catch` — si falta, no rompe el arranque (ver
  `.claude/guides/arquitectura.md`). `DATA.allLocations()` lo fusiona con
  `mining_data.json.locations`, deduplicando por `(nombre, sistema)` con
  **mining_data.json como fuente prioritaria** (ya integrada con
  `oreToLocations`/`refineries`/etc.) — así `"MIC-L1"` sale una sola vez, con
  `kind: "lagrange"` (el de Strata), no `"station"` (el de UEX).

## Catálogo de planos de crafteo (`data/craft_blueprints.json`)

Planos de fabricación del juego (~1589 en el parche actual: armas, armaduras,
munición, componentes de nave...) que consumen materiales — entre ellos, los
minerales de `mining_data.json`. Da la vuelta a la pregunta del Buscador: no
"¿dónde vendo este mineral?" sino "¿para qué sirve este mineral?". Dato
generado igual que los otros dos: **nunca se edita a mano**.

```bash
python .claude/scripts/fetch_craft_blueprints.py
```

- Fuente: API pública de sc-craft.tools (tras Cloudflare — el script manda
  User-Agent de navegador, mismo motivo que `fetch_uex_locations.py` con UEX).
  Primero `GET /api/config` para resolver la versión `live` activa (evita
  vendorizar planos de PTU, que pueden no reflejar el juego publicado), luego
  pagina `GET /api/blueprints?page=N&limit=100&search=&version=<version>`
  **sin** `ownable=1` — con ese parámetro la API solo devuelve los planos que
  posee la cuenta autenticada; sin él, el catálogo completo (~1589, verificado
  contra `stats.totalBlueprints` de `/api/config`). El servidor capa `limit` a
  100 aunque se pida más (probado con `limit=500`): 16 páginas en el parche
  actual.
- Recorte respecto al payload crudo de la API (más pesado: fire_modes
  detallados de armas, loc_keys, guids de ingrediente...): se conserva todo lo
  que la vista necesita — `id`, `blueprint_id`, `name`, `category` (ruta tipo
  `"Vehiclegear / Weapons / Ballistic / Cannon"`), `craft_time_seconds`,
  `tiers`, `item_stats` (sin `fire_modes`: masa, resistencias, tipo... varía
  de forma según la categoría del ítem, no se normaliza), `ingredients[]`
  (`slot`, `name`, `quantity_scu`, `unit` — `"scu"` o `"unit"`, unidades
  sueltas, **no** SCU —, `min_quality`, `quality_effects[]` completo con
  `stat`/`quality_min`/`quality_max`/`modifier_at_min`/`modifier_at_max`/`type`
  y `ranges` opcional para efectos no lineales) y `missions[]`
  (`mission_id`, `name`, `drop_chance` como número, no como el string
  `"1.0000"` que trae la API cruda).
- Tamaño real (parche actual, versión `LIVE-4.9.0-12232306`): ~4,1 MB, 1589
  planos. Es, con diferencia, el fichero de dato generado más grande del
  proyecto (mining_data.json ~290 KB, uex_locations.json ~24 KB) — el peso
  vive casi todo en `ingredients[].quality_effects` (~1,45 MB de los ~2,4 MB
  en crudo sin indentar): se conserva completo a propósito, es justo el tipo
  de dato "no es lineal, no lo aproximes" que ya justificaba
  `QUALITY_TIER_LABELS` en `js/data.js`. Si el tamaño se vuelve un problema
  real de carga, la vía es lazy-load bajo demanda (fetch solo al abrir una
  pestaña de crafteo), no recortar `quality_effects`.
- Solo 36 nombres de material distintos aparecen como ingrediente en los 1589
  planos (verificado, no una muestra) — todos son minerales de
  `mining_data.json` salvo `"Pressurized Ice"` (commodity distinta del `ICE`
  de minería, sin entrada en `ores`). Dos grafías de sc-craft.tools NO
  coinciden con `ore.display_name` de mining_data.json: `"Aluminum"`
  (americano; mining_data.json trae `"Aluminium"`, británico) y
  `"Quantainium"` (mining_data.json trae `"Quantanium"`) — corregidas en
  `CRAFT_NAME_OVERRIDES` (js/data.js), tabla **propia de esta fuente**, no
  reutilizar `UEX_NAME_OVERRIDES` ni al revés (quirks de APIs distintas,
  verificados por separado). Un único sufijo de "en bruto" visto:
  `"Saldynium (Ore)"` — lo quita `craftBaseName()`, deliberadamente más simple
  que `uexBaseName()` (esa cubre 3 patrones reales de UEX; aquí solo hay uno
  verificado, no se adivina un patrón de más).
- Consumo: `DATA.load()` lo carga en `DATA.craft.blueprints` tras
  `mining_data.json`/`uex_locations.json`, envuelto en `try/catch` — si falta,
  `DATA.craftBlueprints()`/`DATA.craftByMaterial()` devuelven `[]` sin romper
  el arranque. Contrato expuesto:
  - `DATA.craftBlueprints()` → `[]` con la lista completa de planos tal cual
    vienen en el JSON (referencia, no copia).
  - `DATA.craftByMaterial(oreKeyOrName)` → `[{blueprint, ingredient}]`, el
    índice inverso material → planos. Acepta una clave de `DATA.ores`
    (`"QUANTANIUM"`, `"ALUMINUM"`...) — se resuelve por
    `CRAFT_NAME_OVERRIDES`/`display_name`, igual patrón que `uexFor` — o un
    nombre de material libre normalizado igual. `[]` si no hay ningún plano
    (nunca `null`).
