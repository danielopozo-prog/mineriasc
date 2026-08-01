# API de UEX Corp

Base: `https://api.uexcorp.uk/2.0` · GET públicos sin token · CORS abierto (`*`) ·
límite 120 peticiones/min. Cliente en `js/uex.js` con caché en `localStorage` (30 min).

## Endpoints usados

| Endpoint | Uso en la app |
|---|---|
| `commodities` | Lista completa con precios medios (`price_buy`/`price_sell`). Se carga una vez al arrancar y alimenta `DATA.uexByName` |
| `commodities_prices?id_commodity=N` | Precios por terminal de una commodity **refinada** |
| `commodities_raw_prices?id_commodity=N` | Precios por terminal del mineral **en bruto** (venta en refinerías) |
| `refineries_methods` | Métodos de refinado con `rating_yield/cost/speed` (1-3) |
| `marketplace_prices_averages_all` | Medias del Marketplace **P2P** (jugador-a-jugador), por ítem × tramo de calidad × unidad × operación. Se filtra a `unit=scu` + `operation=sell` antes de cachear — ver abajo |

## Marketplace P2P (`marketplace_prices_averages_all`)

Esto es un mercado **distinto** de `commodities`/`commodities_prices`: no son terminales
NPC, son anuncios de jugadores (como un mercadillo). Cliente: `UEX.marketplaceAveragesAll()`.
Consumo en `DATA`: `loadMarketplaceAverages()` (llenar índice) + `marketplaceAvgFor(oreKey)`
(consulta), mismo patrón no-bloqueante que `loadUexPrices`/`uexFor`.

- **Payload sin filtrar ronda 1,3 MB** (~3600 filas, todos los ítems del juego en todas
  las unidades/operaciones: unit, box, pack, crate, set, stack, cSCU, scu…). La app solo
  necesita venta de minerales en bruto por SCU, así que `UEX.marketplaceAveragesAll()`
  filtra a `unit === "scu" && operation === "sell"` **antes** de guardar en
  `localStorage` (reduce a ~40 KB). No tocar ese filtro sin medir de nuevo el tamaño:
  si se cachea sin filtrar, se puede agotar la cuota de `localStorage` (~5-10 MB
  compartidos con el resto de la caché UEX).
- **Cruce por nombre**: el bruto con calidad aparece en `item_name` bajo el nombre del
  ítem **base** (el refinado, sin sufijo), igual que `uexRefinedFor`. Ejemplo: Copper en
  bruto con calidad se busca como `item_name: "Copper"`, no `"Copper (Ore)"`. Por eso
  `marketplaceAvgFor` reutiliza exactamente la misma normalización (regex de sufijo +
  minúsculas) que `DATA.uexRefinedFor`. Consecuencia: los mismos minerales que fallan en
  `uexRefinedFor` por tener el sufijo fuera de paréntesis (`LINDINIUM` → "Lindinium Ore",
  `SAVRILIUM` → "Savrilium Ore", `ICE` → "Raw Ice") tampoco cruzan aquí — no es un bug
  nuevo, es el mismo defecto de naming heredado. Los minerales nuevos de Pyro/Nyx sin
  actividad de jugadores en el marketplace simplemente no tienen filas (array vacío, no
  error).
- **`quality_tier` no es un cálculo lineal** (`floor(quality/100)` da resultado
  incorrecto). Es una tabla fija tomada del propio filtro de
  `https://uexcorp.space/marketplace/averages/` y verificada cruzando el campo
  `quality` (escala 0-1000) de `marketplace_listings` contra `quality_tier` de
  `marketplace_prices_averages_all` en varios ítems (coincidencias exactas de precio
  para Copper, tiers 2/3/4/5/6):

  | `quality_tier` | Rango real (`quality`) |
  |---|---|
  | 0 | Q0 (sin calidad / ítems sin ese sistema) |
  | 1 | Q1-499 |
  | 2 | Q500-599 |
  | 3 | Q600-699 |
  | 4 | Q700-799 |
  | 5 | Q800-899 |
  | 6 | Q900-949 |
  | 7 | Q950-1000 |

  Tabla en `js/data.js` como `QUALITY_TIER_LABELS`. No es equiespaciada a propósito: el
  grueso de la minería en SC cae entre 700 y 1000, así que UEX afina el tramo alto y deja
  uno solo (1) para todo lo bajo de 500.
- `price_avg`/`price_avg_week`/`price_avg_month` llegan como **strings**, no number —
  castear con `Number()` (mismo defecto de tipado que otros endpoints de UEX).
- Verificación real hecha: `id_item=5885` (Copper) tier 5 = `Q800-899`, `price_avg`
  1 SCU ≈ 3.266.667 UEC (listings_count 3), coherente con lo visto en la web pública.

## Trampas conocidas (las que ya nos mordieron)

- **El mineral en bruto tiene `price_sell = 0`** en `commodities`: el precio medio útil
  es el de la commodity refinada. Por eso existe `DATA.bestSellFor()`: bruto si > 0, si
  no refinado. No "arreglar" quitando esa lógica.
- **Naming**: la commodity en bruto lleva sufijo « (Ore)» o « (Raw)» según el mineral
  (`Gold (Ore)`, `Quantainium (Raw)`). La refinada es el nombre sin sufijo.
  `DATA.uexRefinedFor()` lo deriva quitando el sufijo con regex.
- **Grafías**: el juego/Strata usa `Quantanium`; UEX usa `Quantainium`. El campo
  `uex_name` de cada mineral en `mining_data.json` ya trae el nombre correcto de UEX —
  matchear siempre por `uex_name`, con `display_name` solo como alternativa.
- `commodities_prices` de una commodity en bruto devuelve **0 terminales** (no error):
  los terminales de bruto solo están en `commodities_raw_prices`.
- Respuesta estándar: `{status: "ok", data: [...]}`. Comprobar `status`, no solo el
  HTTP.

## Qué más ofrece la API (no usado aún)

`refineries_yields`, `refineries_capacities`, rutas de comercio, vehículos, terminales
con distancias. Documentación: https://uexcorp.space/api/documentation/
