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
| `location_ores` | 48 zonas con `ores.{ship,fps,vehicle}[] = {ore, relative_probability}` | Ubicaciones + índice `oreToLocations` |
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
