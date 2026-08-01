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
| `marketplace_prices_averages_all` | Medias del Marketplace **P2P** (jugador-a-jugador), por ítem × tramo de calidad × unidad × operación. Se filtra a `operation=sell` antes de cachear (todas las unidades) — ver abajo |

## Marketplace P2P (`marketplace_prices_averages_all`)

Esto es un mercado **distinto** de `commodities`/`commodities_prices`: no son terminales
NPC, son anuncios de jugadores (como un mercadillo). Cliente: `UEX.marketplaceAveragesAll()`.
Consumo en `DATA`: `loadMarketplaceAverages()` (llenar índice) + `marketplaceAvgFor(oreKey)`
(consulta), mismo patrón no-bloqueante que `loadUexPrices`/`uexFor`.

- **Payload sin filtrar ronda 1,3 MB** (medido en vivo, parche 4.9: 3644 filas, todos
  los ítems del juego en todas las unidades/operaciones: unit, box, pack, crate, set,
  stack, cscu, dozen, hundred, pair, thousand, scu…). Desde el parche 4.9,
  `UEX.marketplaceAveragesAll()` filtra a `operation === "sell"` **antes** de guardar en
  `localStorage` (reduce a ~1,28 MB, 3237 filas — medido en vivo). No tocar ese filtro
  sin medir de nuevo el tamaño.
  - **Historial**: hasta el parche 4.9 se filtraba también a `unit === "scu"` (reducía
    a ~40 KB), pero eso excluía por completo 13 minerales que solo se trafican en
    unidades sueltas (ver punto siguiente) — decisión de producto explícita para
    mostrar esos anuncios. Se evaluó restringir a una whitelist de `unit` en vez de
    quitar el filtro del todo, pero medido contra los 39 minerales reales de
    `mining_data.json`, 9 de las 10 unidades de venta que trae la API completa (todas
    salvo `pair`/`thousand`) ya aparecen en nuestros propios minerales — ese filtro
    apenas habría reducido el payload, así que se descartó. Whitelistear por
    `item_name` (los 39 minerales) sí habría bajado a ~160 KB, pero exige que
    `js/uex.js` (cliente genérico de UEX, sin conocimiento de dominio) conozca la
    lista de minerales de `mining_data.json` (dominio de `DATA`) y resincronizarla a
    mano en cada parche — acoplamiento peor que el coste de memoria. 1,28 MB queda
    cómodo bajo la cuota real de `localStorage` (mínimo de especificación 5 MB, sumado
    a `commodities` ~148 KB y `refineries_methods` ~1 KB). Si un parche futuro dispara
    mucho este número, revisar de nuevo antes de reintroducir cualquier filtro.
- **Cruce por nombre**: el bruto con calidad aparece en `item_name` bajo el nombre del
  ítem **base** (el refinado, o el propio ítem si no hay distinción bruto/refinado),
  igual que `uexRefinedFor`. Ejemplo: Copper en bruto con calidad se busca como
  `item_name: "Copper"`, no `"Copper (Ore)"`. Por eso `marketplaceAvgFor` reutiliza
  exactamente la misma normalización (`uexBaseName`, ver abajo) que `DATA.uexRefinedFor`.
- **13 minerales solo se trafican en unidades sueltas, nunca por SCU** (verificado
  contra la API en vivo, parche 4.9): Carinite, Carinite (Pure), Aphorite, Beradom,
  Dolivine, Feynmaline, Glacosite, Hadanite, Jaclium, Janalite, Sadaryx, Saldynium y
  Tin SÍ tienen anuncios reales en el Marketplace P2P — pero siempre en unidades
  pequeñas (`unit`, `pack`, `dozen`, `stack`, `cscu`, `box`, `set`), nunca en `scu`,
  porque son gemas que se recogen a mano en cantidades pequeñas, no a granel. El
  nombre base cruza perfectamente; desde el parche 4.9 `DATA.marketplaceAvgFor`
  devuelve esas filas con su `unit` real (contrato completo más abajo) en vez de
  descartarlas.
- Solo dos minerales están genuinamente ausentes de todo el Marketplace P2P sin
  excepción (ninguna unidad, ninguna operación): `ICE` e `INERTMATERIAL`. Eso sí es
  "sin anuncios", no un problema de cruce.
- **Contrato de `DATA.marketplaceAvgFor(oreKey)`** (post-parche 4.9): devuelve
  `[{ unit, qualityTier, qualityLabel, priceAvg, priceAvgWeek, priceAvgMonth,
  listingsCount }]`, una fila por combinación unidad×tramo de calidad, ordenadas
  primero todas las de `unit === "scu"` (por tier ascendente) y después el resto de
  unidades agrupadas alfabéticamente por `unit` (por tier ascendente dentro de cada
  una). `priceAvg` (antes `priceAvgScu`, renombrado sin dejar alias a propósito: un
  alias habría insinuado que sigue siendo siempre precio por SCU) es el precio medio
  de **una unidad de `unit`**, no de un SCU salvo que `unit === "scu"` — precio por SCU
  y precio por unidad suelta son magnitudes distintas, cualquier vista que consuma
  esta función debe mostrar `unit` junto al precio, nunca asumir SCU.
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
  `DATA.uexRefinedFor()`/`marketplaceAvgFor()` lo derivan con `uexBaseName()` (js/data.js),
  que cubre las 3 formas del sufijo verificadas contra la API real: entre paréntesis al
  final (mayoría), sin paréntesis al final (`Lindinium Ore`, `Savrilium Ore`) y como
  prefijo (`Raw Ice`).
- **Grafías**: el juego/Strata usa `Quantanium`; UEX usa `Quantainium`. El campo
  `uex_name` de cada mineral en `mining_data.json` ya trae el nombre correcto de UEX —
  matchear siempre por `uex_name`, con `display_name` solo como alternativa.
- **`uex_name` null o directamente incorrecto** (5 minerales, verificado contra la API
  en vivo parche 4.9 — tabla completa en `UEX_NAME_OVERRIDES`, js/data.js):

  | Mineral | `uex_name`/`display_name` en mining_data.json | Nombre real en UEX | Efecto sin el override |
  |---|---|---|---|
  | CARINITEPURE | `uex_name: null`, display "Carinite Pure" | "Carinite (Pure)" | nunca cruza (ni bruto ni Marketplace) |
  | LINDINIUM | "Lindinium Ore" | bruto real: "Lindinium (Ore)" | **bug silencioso**: `uexFor` no encuentra "lindinium ore", cae al fallback de `display_name` ("Lindinium"), que por COINCIDENCIA es el nombre de la commodity REFINADA — `bestSellFor` devolvía el precio refinado (47.842) etiquetado `refined:false` |
  | SAVRILIUM | "Savrilium Ore" | bruto real: "Savrilium (Ore)" | mismo bug que LINDINIUM (precio refinado 121.250 etiquetado como bruto) |
  | ICE | "Raw Ice" | bruto real: "Ice (Raw)" | `uexFor` no encuentra nada (no hay coincidencia por casualidad, a diferencia de Lindinium/Savrilium); no existe variante refinada en absoluto (el hielo no se refina) |
  | SALDYNIUM | `uex_name: null`, display "Saldynium" | bruto real: "Saldynium (Ore)" | `uexFor` no encuentra nada; no existe variante refinada |

  El caso LINDINIUM/SAVRILIUM es el más peligroso de los cinco: no falla ruidosamente
  (devuelve un precio, solo que del commodity equivocado con la etiqueta equivocada).
  Cualquier auditoría futura de precios "raros" en el Buscador debe empezar por
  comprobar si `DATA.uexFor(oreKey)?.is_raw === 1` (si no, algo está cruzando con el
  refinado por error). `UEX_NAME_OVERRIDES` fuerza el nombre bruto correcto para los 5;
  `uexBaseName()` sigue derivando el refinado a partir de ESE nombre ya corregido.
- `commodities_prices` de una commodity en bruto devuelve **0 terminales** (no error):
  los terminales de bruto solo están en `commodities_raw_prices`.
- Respuesta estándar: `{status: "ok", data: [...]}`. Comprobar `status`, no solo el
  HTTP.

## Refresco manual forzado (`DATA.refreshLive()`)

La UI puede forzar datos frescos saltando el TTL de 30 min de `localStorage`
(botón "refrescar precios" o similar). Contrato:

- `js/uex.js`: `get()` y `marketplaceAveragesAll()` aceptan un flag `force` que
  salta la **lectura** de caché, pero la entrada solo se **sobrescribe** tras un
  fetch con éxito. Si el fetch falla, la caché vieja (aunque caducada) queda
  intacta — nunca se borra por adelantado. `UEX.commodities(force)` y
  `UEX.marketplaceAveragesAll(force)` exponen ese flag.
- `js/data.js`: `loadUexPrices(force)` y `loadMarketplaceAverages(force)` pasan
  el flag a `UEX` y, igual que la caché, solo reconstruyen su índice
  (`uexByName` / `marketplaceByBase`) **después** de que el fetch resuelva —
  nunca antes del `await`. Un refresco que falla deja la app exactamente como
  estaba, nunca peor.
- `DATA.refreshLive()` es el punto de entrada único para la UI: dispara ambas
  cargas en paralelo con `Promise.allSettled` (un fallo no tumba a la otra) y
  deduplica clicks repetidos reutilizando la promesa en curso
  (`this._refreshInFlight`) en vez de disparar ráfagas nuevas de peticiones.
  Devuelve siempre (nunca rechaza):
  ```js
  { prices: "ok"|"error", marketplace: "ok"|"error",
    errors: { prices: Error|null, marketplace: Error|null } }
  ```
  Éxito parcial = una fuente "ok" y otra "error" (la que falló conserva sus
  datos previos). No usar para refrescos automáticos/polling: es para una
  acción explícita del usuario, dentro del límite de 120 peticiones/min de UEX.

## Catálogo de ubicaciones (`cities`, `space_stations`, `outposts`)

Estos tres endpoints (CORS abierto, verificado) NO se llaman desde el navegador:
alimentan `data/uex_locations.json`, un fichero vendorizado (regenerado con
`python .claude/scripts/fetch_uex_locations.py`) que complementa las zonas de minado
de `mining_data.json` con el catálogo completo de ciudades/estaciones/outposts —
detalle de campos, naming y quirks en `.claude/guides/datos-juego.md`. Se resolvió
así (dato generado, no fetch en vivo) porque el selector que lo consume
(`DATA.allLocations()`) debe funcionar sin conexión, y estos nombres cambian con
parches, no con precios. Nota de implementación: `urllib` de Python recibe 403 de
Cloudflare sin `User-Agent` de navegador — el script ya manda uno.

## Qué más ofrece la API (no usado aún)

`refineries_yields`, `refineries_capacities`, rutas de comercio, vehículos, terminales
con distancias, `star_systems`, `planets`, `moons`, `orbits` (puntos de salto).
Documentación: https://uexcorp.space/api/documentation/
