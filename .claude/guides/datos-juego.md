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
| `scanner_signals` | 76 señales: `signal_value`, `tier`, `ore_hint`, `mining_context` | pills del Buscador |
| `refineries.stations` | Estación → `{system, capacity_scu, yields{ORE: {value…}}}` (bonos % de rendimiento) | tabla de Refinería |

Claves presentes pero **no usadas aún**: `compositions`, `cave_compositions`,
`mining_params`, `equipment` (láseres/módulos/cargas — candidata a pestaña futura),
`ore_elements`, `map_positions`, `planets`, `jump_gates`.

## Detalles que no son obvios

- Las claves de mineral son MAYÚSCULAS (`QUANTANIUM`); las de `location_ores` no
  coinciden con las de `locations` (`GLACIUM` vs `AARON_HALO`) — el cruce se hace por
  `name`/`display_name`, no por clave.
- `ore_locations` (singular invertido) y `computed` existen pero vienen **vacíos**: no
  construir nada sobre ellos.
- Los `yields` de refinería son enteros con signo (± %), no multiplicadores.
