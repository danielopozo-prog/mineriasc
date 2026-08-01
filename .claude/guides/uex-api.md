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
