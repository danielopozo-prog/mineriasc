/* Carga de mining_data.json (datos de juego, base Strata) y
   construcción de índices para las vistas. */

// Correcciones puntuales al nombre UEX "en bruto" de un mineral (el que debe
// usar uexFor para encontrar la commodity BRUTA), para cuando
// `ore.uex_name`/`ore.display_name` (mining_data.json, dato generado, nunca
// se edita a mano) no coinciden con el nombre real de la commodity/ítem en la
// API de UEX. Los cuatro casos están verificados contra la API en vivo
// (commodities + marketplace_prices_averages_all, ver .claude/guides/uex-api.md):
//   - CARINITEPURE: Strata trae `uex_name: null` y `display_name: "Carinite Pure"`;
//     UEX real es "Carinite (Pure)" (con paréntesis; no hay variante refinada
//     separada — bruto y "refinado" son la misma commodity).
//   - LINDINIUM / SAVRILIUM: `uex_name` trae "Lindinium Ore"/"Savrilium Ore"
//     (sin paréntesis); el bruto real en UEX es "Lindinium (Ore)"/
//     "Savrilium (Ore)". Sin este override, uexFor no encuentra el bruto y
//     cae al fallback de `display_name` ("Lindinium"/"Savrilium"), que por
//     COINCIDENCIA es el nombre exacto de la commodity REFINADA — devolviendo
//     el precio refinado etiquetado como "en bruto" en bestSellFor/Buscador.
//     Bug real detectado y corregido, no solo cosmético.
//   - ICE: `uex_name` trae "Raw Ice" (orden de palabras invertido, sin
//     paréntesis); el bruto real es "Ice (Raw)". No existe variante refinada
//     (el hielo no se refina) — uexRefinedFor sigue devolviendo null para
//     ICE, correctamente.
//   - SALDYNIUM: `uex_name` es null y `display_name` es "Saldynium" (sin
//     sufijo); el bruto real es "Saldynium (Ore)", y tampoco existe variante
//     refinada separada.
// Añadir aquí cualquier caso nuevo que aparezca tras un parche — no tocar
// mining_data.json.
const UEX_NAME_OVERRIDES = {
  CARINITEPURE: "Carinite (Pure)",
  LINDINIUM: "Lindinium (Ore)",
  SAVRILIUM: "Savrilium (Ore)",
  ICE: "Ice (Raw)",
  SALDYNIUM: "Saldynium (Ore)",
};

// Nombre BASE de una commodity UEX (el mineral REFINADO, o el propio ítem
// cuando no hay distinción bruto/refinado): quita el sufijo de "en bruto" que
// UEX usa de tres formas distintas según el mineral (las tres verificadas
// contra la API real, no inventadas — ver tabla completa en uex-api.md):
//   1) entre paréntesis al final   — "Gold (Ore)", "Quantainium (Raw)" (mayoría)
//   2) sin paréntesis al final     — "Lindinium Ore", "Savrilium Ore"
//   3) como prefijo                — "Raw Ice"
// Usado por uexRefinedFor y marketplaceAvgFor (mismo criterio en los dos,
// documentado en uex-api.md). No añadir un 4º patrón sin volver a verificar
// contra `commodities`/`marketplace_prices_averages_all` en vivo: el objetivo
// es SOLO cubrir casos reales, no adivinar.
function uexBaseName(rawName) {
  return rawName
    .replace(/\s*\((Ore|Raw)\)\s*$/i, "")
    .replace(/\s+(Ore|Raw)\s*$/i, "")
    .replace(/^\s*Raw\s+/i, "")
    .toLowerCase();
}

// Correcciones puntuales al nombre de material tal como lo usa sc-craft.tools
// (data/craft_blueprints.json, `ingredients[].name`) cuando NO coincide con
// `ore.display_name` de mining_data.json — fuente y quirk distintos de
// UEX_NAME_OVERRIDES (esa tabla es solo para la API de UEX; no reutilizar
// aquí ni al revés). Los dos casos están verificados contra el JSON generado
// en el parche 4.9 (36 nombres de material distintos vistos en los 1589
// planos, comparados uno a uno con los 39 `display_name` de mining_data.json):
//   - ALUMINUM: sc-craft usa la grafía americana "Aluminum"; mining_data.json
//     trae la británica "Aluminium". Sin este override craftByMaterial no
//     encuentra ningún plano para Aluminio pese a que sí los hay.
//   - QUANTANIUM: sc-craft usa "Quantainium" (misma grafía que UEX real, ver
//     UEX_NAME_OVERRIDES/comentario de uexRefinedFor); mining_data.json trae
//     "Quantanium".
// El resto de materiales que aparecen en ambas fuentes (33 de 36) coinciden
// tal cual. Añadir aquí cualquier caso nuevo que aparezca tras regenerar
// data/craft_blueprints.json — no tocar ese fichero a mano.
const CRAFT_NAME_OVERRIDES = {
  ALUMINUM: "Aluminum",
  QUANTANIUM: "Quantainium",
};

// Nombre BASE de un material de sc-craft.tools: quita el único sufijo de "en
// bruto" verificado en `ingredients[].name` de data/craft_blueprints.json —
// "Saldynium (Ore)" es, en el parche 4.9, el único de los 36 nombres de
// material con sufijo (el resto ya vienen "pelados"). Deliberadamente más
// simple que uexBaseName (esa cubre 3 patrones distintos, verificados contra
// la API de UEX): no se adivina un patrón de más aquí sin verificarlo primero
// contra un data/craft_blueprints.json regenerado.
function craftBaseName(rawName) {
  return (rawName || "").replace(/\s*\(Ore\)\s*$/i, "").trim().toLowerCase();
}

const DATA = {
  raw: null,           // JSON completo
  ores: {},            // clave -> mineral
  locations: {},       // clave -> ubicación
  locationOres: {},    // clave -> minerales por método
  scannerSignals: {},  // clave -> señal
  refineries: {},      // estación -> {system, capacity_scu, yields}
  oreToLocations: {},  // ORE -> [{locKey, name, system, type, method, prob}]
  oreToSignals: {},    // ORE -> [señales]
  oreRarity: {},        // ORE -> tier de rareza fiable ('common'…'legendary'), solo si existe
  uexByName: {},       // nombre UEX (minúsculas) -> commodity
  uexReady: false,
  marketplaceByBase: {}, // nombre base normalizado (minúsculas) -> [fila averages, ...]
  marketplaceReady: false,
  uexLocations: [], // catálogo ampliado (ciudades/estaciones/outposts) de data/uex_locations.json
  craft: { blueprints: [], byMaterial: {}, ready: false }, // data/craft_blueprints.json + índice material -> planos
  _refreshInFlight: null, // promesa del refreshLive() en curso, para deduplicar clicks

  async load() {
    const res = await fetch("data/mining_data.json");
    if (!res.ok) throw new Error("No se pudo cargar data/mining_data.json");
    this.raw = await res.json();

    this.ores = this.raw.ores || {};
    this.locations = this.raw.locations || {};
    this.locationOres = this.raw.location_ores || {};
    this.scannerSignals = this.raw.scanner_signals || {};
    this.refineries = (this.raw.refineries && this.raw.refineries.stations) || {};

    this.buildIndexes();

    // Catálogo ampliado de ubicaciones (ciudades/estaciones espaciales/outposts),
    // vendorizado desde UEX — ver .claude/guides/datos-juego.md y el script
    // .claude/scripts/fetch_uex_locations.py. Es un fichero LOCAL igual que
    // mining_data.json (no depende de la API en vivo de UEX), pero se protege
    // igual: si falta o está corrupto, allLocations() sigue funcionando solo
    // con las zonas de minado ya cargadas arriba, sin romper el arranque.
    try {
      const locRes = await fetch("data/uex_locations.json");
      this.uexLocations = locRes.ok ? (await locRes.json()).locations || [] : [];
    } catch (_) {
      this.uexLocations = [];
    }

    // Catálogo de planos de crafteo, vendorizado desde sc-craft.tools (ver
    // .claude/scripts/fetch_craft_blueprints.py y .claude/guides/datos-juego.md).
    // Fichero LOCAL igual que mining_data.json/uex_locations.json (no depende
    // de ninguna API en vivo): protegido igual, si falta o está corrupto
    // craftBlueprints()/craftByMaterial() devuelven listas vacías sin romper
    // el arranque.
    try {
      const craftRes = await fetch("data/craft_blueprints.json");
      const craftJson = craftRes.ok ? await craftRes.json() : null;
      this.craft.blueprints = (craftJson && craftJson.blueprints) || [];
    } catch (_) {
      this.craft.blueprints = [];
    }
    this.buildCraftIndex();
  },

  buildIndexes() {
    // Mineral -> ubicaciones donde aparece, con probabilidad relativa por método
    for (const [locKey, loc] of Object.entries(this.locationOres)) {
      for (const [method, entries] of Object.entries(loc.ores || {})) {
        for (const e of entries) {
          (this.oreToLocations[e.ore] ??= []).push({
            locKey,
            name: loc.name,
            system: loc.system,
            type: loc.type,
            method,
            prob: e.relative_probability,
          });
        }
      }
    }
    for (const list of Object.values(this.oreToLocations)) {
      list.sort((a, b) => b.prob - a.prob);
    }

    // Mineral -> señales de escáner que lo delatan
    for (const [sigKey, sig] of Object.entries(this.scannerSignals)) {
      if (sig.ore_hint) {
        (this.oreToSignals[sig.ore_hint] ??= []).push({ key: sigKey, ...sig });
      }
    }

    // Mineral -> rareza (ver comentario de RARITY_TIERS_VALID sobre por qué
    // se filtra el campo `tier` en vez de tomarlo tal cual).
    this.oreRarity = {};
    for (const sig of Object.values(this.scannerSignals)) {
      if (sig.ore_hint && RARITY_TIERS_VALID.has(sig.tier)) {
        this.oreRarity[sig.ore_hint] = sig.tier;
      }
    }
  },

  // Material (nombre base normalizado con craftBaseName) -> [{blueprint, ingredient}].
  // Reconstruido cada `load()` a partir de `this.craft.blueprints` (ya cargado
  // o vacío si data/craft_blueprints.json faltaba) — nunca deja el índice a
  // medias: si blueprints es [], byMaterial queda {} y ready en false.
  buildCraftIndex() {
    this.craft.byMaterial = {};
    for (const bp of this.craft.blueprints) {
      for (const ing of bp.ingredients || []) {
        const key = craftBaseName(ing.name);
        if (!key) continue;
        (this.craft.byMaterial[key] ??= []).push({ blueprint: bp, ingredient: ing });
      }
    }
    this.craft.ready = this.craft.blueprints.length > 0;
  },

  // Precios UEX: se cargan aparte para que la app funcione aunque la API falle.
  // `force` (para refrescos manuales) salta la caché de 30 min de UEX.commodities.
  async loadUexPrices(force = false) {
    const list = await UEX.commodities(force);
    // Reconstruir desde cero SOLO tras un fetch con éxito (ver misma razón en
    // loadMarketplaceAverages): si se limpiara antes del await y la petición
    // fallara, un refresco forzado borraría precios buenos ya cargados.
    this.uexByName = {};
    for (const c of list) {
      this.uexByName[c.name.toLowerCase()] = c;
    }
    this.uexReady = true;
  },

  // Commodity UEX del mineral en bruto (por override conocido, uex_name, o
  // display_name como alternativa — ver UEX_NAME_OVERRIDES y uexBaseName más
  // abajo para el porqué de cada caso).
  uexFor(oreKey) {
    const ore = this.ores[oreKey];
    if (!ore) return null;
    const override = UEX_NAME_OVERRIDES[oreKey];
    if (override) return this.uexByName[override.toLowerCase()] || null;
    return (
      this.uexByName[(ore.uex_name || "").toLowerCase()] ||
      this.uexByName[(ore.display_name || "").toLowerCase()] ||
      null
    );
  },

  // Commodity UEX del mineral refinado: nombre base (ver uexBaseName) del
  // override/uex_name/display_name que corresponda.
  uexRefinedFor(oreKey) {
    const ore = this.ores[oreKey];
    if (!ore) return null;
    const raw = UEX_NAME_OVERRIDES[oreKey] || ore.uex_name || ore.display_name || "";
    return this.uexByName[uexBaseName(raw)] || null;
  },

  // Mejor precio de venta conocido: en bruto si UEX tiene media, si no el refinado
  bestSellFor(oreKey) {
    const raw = this.uexFor(oreKey);
    if (raw && raw.price_sell > 0) return { price: raw.price_sell, refined: false };
    const ref = this.uexRefinedFor(oreKey);
    if (ref && ref.price_sell > 0) return { price: ref.price_sell, refined: true };
    return null;
  },

  // Etiqueta legible de un mineral por su clave: `display_name` si está
  // catalogado en `ores`. Para las claves "UNKNOWN_<hash>" que trae
  // `location_ores` (nodos de minado FPS que el propio Strata no ha podido
  // identificar todavía — panel_confirmed:false para TODAS ellas, verificado:
  // 7 hashes distintos, 129 de 457 filas de location_ores en el parche
  // actual, ver .claude/guides/datos-juego.md) devuelve una etiqueta genérica
  // en vez de la clave hash cruda: el usuario nunca debe ver un
  // "UNKNOWN_xxxxxxxx" en pantalla. Úsese en cualquier vista que renderice un
  // `ore` de `location_ores` en vez de leer `DATA.ores[key]?.display_name`
  // directamente (ver locations.js).
  oreLabel(oreKey) {
    const ore = this.ores[oreKey];
    if (ore) return ore.display_name || oreKey;
    return /^UNKNOWN_/i.test(oreKey) ? "Mineral sin identificar" : oreKey;
  },

  // Rareza del mineral: { tier, label } o null si mining_data.json no trae
  // dato fiable para ese mineral (ver comentario largo junto a
  // RARITY_TIERS_VALID — no se inventa, no hay fuente alternativa en la API
  // de UEX). Síncrona: `oreRarity` se construye en `buildIndexes()`, ya
  // disponible tras `await DATA.load()`.
  rarityFor(oreKey) {
    const tier = this.oreRarity[oreKey];
    if (!tier) return null;
    return { tier, label: RARITY_ES[tier] || tier };
  },

  // Mejores estaciones para refinar un mineral, ordenadas por bono de
  // rendimiento descendente. `limit` (por defecto 3) acota el tamaño del
  // resultado. Devuelve [] si el mineral no aparece en ninguna tabla de
  // rendimiento (nunca null). Dato 100% local (`this.refineries`, ya cargado
  // por `load()` desde mining_data.json): no depende de la API en vivo de
  // UEX, así que está disponible de inmediato tras `await DATA.load()`, sin
  // esperar a `loadUexPrices()`.
  bestRefineryFor(oreKey, limit = 3) {
    const rows = [];
    for (const [station, s] of Object.entries(this.refineries)) {
      const y = s.yields && s.yields[oreKey];
      if (y) rows.push({ station, system: s.system, bonusPct: y.value });
    }
    rows.sort((a, b) => b.bonusPct - a.bonusPct);
    return rows.slice(0, limit);
  },

  // Catálogo completo de planos de crafteo (data/craft_blueprints.json, ~1589
  // en el parche actual: nombre, categoría, tiempo, tiers, item_stats
  // recortado, ingredientes completos con quality_effects, misiones). []
  // (nunca null) si el fichero falta o no ha cargado todavía — comprobar
  // `DATA.craft.ready` si la vista necesita distinguir "vacío de verdad" de
  // "aún sin cargar", igual que `uexReady`/`marketplaceReady`.
  craftBlueprints() {
    return this.craft.blueprints;
  },

  // Planos que usan `oreKeyOrName` como ingrediente. Acepta:
  //   - una clave de `DATA.ores` (p.ej. "QUANTANIUM", "ALUMINUM") — se
  //     resuelve a CRAFT_NAME_OVERRIDES[clave] || ore.display_name, igual
  //     patrón que uexFor/uexRefinedFor con UEX_NAME_OVERRIDES pero con la
  //     tabla propia de esta fuente (sc-craft.tools tiene sus propias grafías,
  //     no las de UEX — ver comentario de CRAFT_NAME_OVERRIDES);
  //   - o un nombre de material libre (se normaliza igual, sin pasar por
  //     `ores`), por si algún día hace falta consultar un ingrediente que no
  //     es un mineral de mining_data.json (sc-craft.tools solo trae los 36
  //     nombres de material reales vistos en el parche 4.9, todos minerales
  //     de mining_data.json salvo "Pressurized Ice", que NO es el `ICE` de
  //     minería — es otra commodity, no tiene entrada en `ores`).
  //
  // Devuelve [{blueprint, ingredient}] (nunca null): `blueprint` es la
  // entrada completa de data/craft_blueprints.json (referencia, no copia);
  // `ingredient` es la fila de `blueprint.ingredients` que hizo match
  // (slot, quantity_scu, unit, min_quality, quality_effects). [] si no hay
  // ningún plano, incluido el caso de que el fichero no haya cargado.
  craftByMaterial(oreKeyOrName) {
    const ore = this.ores[oreKeyOrName];
    const rawName = ore
      ? CRAFT_NAME_OVERRIDES[oreKeyOrName] || ore.display_name || oreKeyOrName
      : oreKeyOrName;
    return this.craft.byMaterial[craftBaseName(rawName)] || [];
  },

  // Medias del Marketplace P2P (jugador-a-jugador): se cargan aparte, igual que
  // loadUexPrices, para que la app funcione aunque la API falle. No se auto-protege
  // con try/catch (mismo patrón que loadUexPrices): quien la llama decide cómo
  // degradar — ver app.js. `force` (para refrescos manuales) salta la caché.
  async loadMarketplaceAverages(force = false) {
    const rows = await UEX.marketplaceAveragesAll(force);
    // Reconstruir desde cero SOLO tras un fetch con éxito: si se limpiara antes
    // del await y la petición fallara, un refresco forzado borraría el índice
    // bueno ya cargado y dejaría la app peor que antes de refrescar.
    this.marketplaceByBase = {};
    for (const r of rows) {
      const key = (r.item_name || "").toLowerCase();
      if (!key) continue;
      (this.marketplaceByBase[key] ??= []).push(r);
    }
    // El orden fino (scu primero, luego resto de units, por tier dentro de
    // cada unidad) lo aplica marketplaceAvgFor en cada consulta — aquí basta
    // con un orden estable de partida por tier.
    for (const list of Object.values(this.marketplaceByBase)) {
      list.sort((a, b) => a.quality_tier - b.quality_tier);
    }
    this.marketplaceReady = true;
  },

  // Refresco manual forzado de los dos datasets en vivo (precios de commodities
  // + medias del Marketplace P2P), saltando la caché de 30 min de localStorage.
  // Uso desde la UI: `await DATA.refreshLive()`.
  //
  // Contrato:
  // - Devuelve SIEMPRE (nunca rechaza) un objeto:
  //     { prices: "ok"|"error", marketplace: "ok"|"error",
  //       errors: { prices: Error|null, marketplace: Error|null } }
  // - Éxito total: ambas "ok". Éxito parcial: una "ok" y otra "error" (la que
  //   falló conserva sus datos previos — ver loadUexPrices/loadMarketplaceAverages,
  //   solo se sobrescribe el índice tras un fetch exitoso). Fallo total: ambas
  //   "error", la app queda exactamente como estaba antes de pulsar refrescar.
  // - Las dos peticiones van en paralelo con Promise.allSettled: un fallo en una
  //   no cancela ni ensucia la otra.
  // - Si ya hay un refresco en curso, se reutiliza su promesa (no dispara una
  //   ráfaga nueva de peticiones por clicks repetidos).
  async refreshLive() {
    if (this._refreshInFlight) return this._refreshInFlight;

    const run = async () => {
      const [pricesResult, marketResult] = await Promise.allSettled([
        this.loadUexPrices(true),
        this.loadMarketplaceAverages(true),
      ]);
      return {
        prices: pricesResult.status === "fulfilled" ? "ok" : "error",
        marketplace: marketResult.status === "fulfilled" ? "ok" : "error",
        errors: {
          prices: pricesResult.status === "rejected" ? pricesResult.reason : null,
          marketplace: marketResult.status === "rejected" ? marketResult.reason : null,
        },
      };
    };

    this._refreshInFlight = run().finally(() => {
      this._refreshInFlight = null;
    });
    return this._refreshInFlight;
  },

  // Medias del Marketplace P2P del mineral en bruto: una fila por combinación
  // (unidad de venta × tramo de calidad). El marketplace agrupa el bruto bajo
  // el nombre del ítem BASE (el refinado): misma normalización que
  // uexRefinedFor (ver uexBaseName y UEX_NAME_OVERRIDES). Devuelve [] si no
  // hay datos (nunca null), para que el consumidor pueda iterar sin comprobar
  // null antes.
  //
  // CONTRATO (cambiado tras el parche 4.9 — antes solo devolvía filas por
  // SCU): cada fila trae
  //   { unit, qualityTier, qualityLabel, priceAvg, priceAvgWeek,
  //     priceAvgMonth, listingsCount }
  // `unit` es la unidad de venta real del anuncio ("scu", "unit", "pack",
  // "box", "cscu", "dozen", "hundred", "set", "stack"…). `priceAvg` (antes
  // `priceAvgScu`, renombrado a propósito — no queda alias del nombre viejo:
  // dejarlo habría insinuado que sigue siendo siempre precio por SCU) es el
  // precio medio por UNA unidad de `unit`, NUNCA por SCU salvo que
  // `unit === "scu"`. Precio por SCU y precio por unidad suelta son
  // magnitudes distintas (una gema se vende por bolsas de decenas, no a
  // granel) — cualquier vista DEBE mostrar `unit` junto al precio, nunca
  // asumir SCU.
  //
  // Orden de las filas: primero todas las de `unit === "scu"` (por tier
  // ascendente), después el resto de unidades agrupadas alfabéticamente por
  // `unit` (por tier ascendente dentro de cada una). Así el consumidor puede
  // pintar el grupo SCU (el caso mayoritario, 26 de 39 minerales) primero sin
  // tener que reagrupar él mismo.
  //
  // Devuelve [] solo si el mineral no tiene NINGUNA actividad P2P (ninguna
  // unidad, ninguna operación de venta): en el parche 4.9 eso es únicamente
  // ICE e INERTMATERIAL (ver uex-api.md). Ya NO devuelve [] para los 13
  // minerales que solo se trafican en unidades pequeñas (Carinite, Carinite
  // (Pure), Aphorite, Beradom, Dolivine, Feynmaline, Glacosite, Hadanite,
  // Jaclium, Janalite, Sadaryx, Saldynium, Tin): esas filas ahora se
  // incluyen con su `unit` real.
  marketplaceAvgFor(oreKey) {
    const ore = this.ores[oreKey];
    if (!ore) return [];
    const raw = UEX_NAME_OVERRIDES[oreKey] || ore.uex_name || ore.display_name || "";
    const rows = this.marketplaceByBase[uexBaseName(raw)];
    if (!rows || !rows.length) return [];
    const sorted = [...rows].sort((a, b) => {
      if (a.unit === b.unit) return a.quality_tier - b.quality_tier;
      if (a.unit === "scu") return -1;
      if (b.unit === "scu") return 1;
      return a.unit.localeCompare(b.unit) || a.quality_tier - b.quality_tier;
    });
    return sorted.map((r) => ({
      unit: r.unit,
      qualityTier: r.quality_tier,
      qualityLabel: QUALITY_TIER_LABELS[r.quality_tier] || `Q${r.quality_tier}`,
      priceAvg: Number(r.price_avg),
      priceAvgWeek: Number(r.price_avg_week),
      priceAvgMonth: Number(r.price_avg_month),
      listingsCount: r.listings_count,
    }));
  },

  systems() {
    return [...new Set(Object.values(this.locations).map((l) => l.system))].sort();
  },

  // Catálogo COMPLETO de ubicaciones nombradas del juego: fusiona las zonas de
  // minado de mining_data.json (86, ya integradas en el resto de la app vía
  // oreToLocations/refineries/etc.) con el catálogo ampliado de UEX —
  // ciudades, estaciones espaciales (incluye los puntos de Lagrange MIC-L1…L5
  // y hermanos de cada planeta de Stanton) y outposts — cargado en
  // `this.uexLocations` durante `load()`. Pensado para selects que necesiten
  // el listado completo (p.ej. el de ubicación del Inventario), no solo zonas
  // de minado.
  //
  // Contrato:
  // - Síncrona: solo depende de datos ya cargados por `load()` (dos fetches
  //   locales, ninguno a la API en vivo de UEX). Llamar después de
  //   `await DATA.load()`, igual que el resto de índices de `DATA`.
  // - Devuelve [{name, system, kind}], sin duplicados, ordenado por
  //   `system` y luego `name` (localeCompare).
  // - `kind`: 'city' | 'station' | 'outpost' (catálogo UEX) o el `type`
  //   original de mining_data.json para el resto ('planet', 'moon',
  //   'lagrange', 'asteroid_belt', 'ring', 'cluster', 'hathor'…) — ver
  //   `LOC_TYPE_ES` para su etiqueta en español.
  // - Dedup por (nombre normalizado, sistema): ante colisión gana SIEMPRE la
  //   entrada de mining_data.json (ya integrada en el resto de la app); la
  //   de UEX se descarta. Ejemplo: "MIC-L1" existe en ambas fuentes — se
  //   queda la de mining_data.json (kind: 'lagrange').
  allLocations() {
    const key = (name, system) => `${(name || "").trim().toLowerCase()}::${system || ""}`;
    const seen = new Set();
    const out = [];

    for (const loc of Object.values(this.locations)) {
      const k = key(loc.display_name, loc.system);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ name: loc.display_name, system: loc.system, kind: loc.type });
    }
    for (const loc of this.uexLocations) {
      const k = key(loc.name, loc.system);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ name: loc.name, system: loc.system, kind: loc.kind });
    }

    out.sort(
      (a, b) =>
        (a.system || "").localeCompare(b.system || "") || (a.name || "").localeCompare(b.name || "")
    );
    return out;
  },
};

/* ---------- utilidades compartidas ---------- */

function fmtNum(n, dec = 0) {
  if (n == null || isNaN(n)) return "—";
  return Number(n).toLocaleString("es-ES", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

function esc(s) {
  const div = document.createElement("div");
  div.textContent = s ?? "";
  return div.innerHTML;
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.remove("show"), 2500);
}

const LOC_TYPE_ES = {
  planet: "Planeta",
  moon: "Luna",
  asteroid_belt: "Cinturón de asteroides",
  asteroid_field: "Campo de asteroides",
  asteroid_cluster: "Cúmulo de asteroides",
  lagrange_point: "Punto de Lagrange", // alias sin uso conocido en mining_data.json (ver 'lagrange')
  lagrange: "Punto de Lagrange", // valor real de `type` en mining_data.json para MIC-L1 y hermanos
  lagrange_field: "Campo de Lagrange",
  cluster: "Cúmulo",
  hathor: "Cueva",
  mission_location: "Punto de misión",
  station: "Estación",
  ring: "Anillo",
  cave: "Cueva",
  surface: "Superficie",
  // kinds del catálogo ampliado de UEX (DATA.allLocations()) — ver
  // .claude/guides/datos-juego.md
  city: "Ciudad",
  outpost: "Puesto avanzado",
};

const METHOD_ES = {
  ship: "Nave",
  fps: "A pie (FPS)",
  vehicle: "Vehículo (ROC)",
  hand: "Manual",
};

// Rareza: mining_data.json (base Strata) NO trae un campo `rarity` en `ores`
// — se comprobó explícitamente, no está. Tampoco lo trae `commodities` de la
// API de UEX (se revisó el payload real: ni `rarity` ni equivalente). La
// única fuente real es el campo `tier` de `scanner_signals`, pero ese campo
// está sobrecargado en el dato de Strata: para señales de contexto
// `asteroid`/`ship`/`surface` es una rareza genuina (common/uncommon/rare/
// epic/legendary); para contexto `fps`/`vehicle` el propio `mining_context`
// se filtra en `tier` (p.ej. CARINITE trae tier:"fps" y tier:"vehicle", que
// NO son rarezas). Por eso `DATA.buildIndexes()` solo acepta valores de este
// set al construir `oreRarity` — así no se cuela un "vehicle" o "fps" como
// si fuera rareza.
//
// Cobertura real (patch actual): 26 de 39 minerales tienen rareza fiable por
// esta vía; los 13 restantes (gemas de cueva FPS/vehículo — Carinite,
// Jaclium, Saldynium… — y el residuo de nave Inert Material) no tienen
// ninguna fuente de rareza en los datos disponibles: `DATA.rarityFor()`
// devuelve `null` para ellos, no se inventa un valor.
const RARITY_TIERS_VALID = new Set(["common", "uncommon", "rare", "epic", "legendary"]);

const RARITY_ES = {
  common: "Común",
  uncommon: "Poco común",
  rare: "Raro",
  epic: "Épico",
  legendary: "Legendario",
};

// Orden ascendente de rareza, por si una vista necesita ordenar/agrupar.
const RARITY_ORDER = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };

// Tramos de quality_tier del Marketplace de UEX -> etiqueta de rango (Q real
// del listado). Tabla FIJA y GLOBAL (no depende del ítem): sacada del propio
// select de filtro de https://uexcorp.space/marketplace/averages/ y verificada
// cruzando el campo "quality" de marketplace_listings con el "quality_tier" de
// marketplace_prices_averages_all para varios ítems (Copper entre ellos: tier 5
// = listados con quality≈855 = "Q800-899", precio medio ~3,27M/SCU). El tramo
// no es lineal: cuanta más calidad, más fino el tramo (el grueso de la minería
// cae en 700-1000).
const QUALITY_TIER_LABELS = {
  0: "Q0",
  1: "Q1-499",
  2: "Q500-599",
  3: "Q600-699",
  4: "Q700-799",
  5: "Q800-899",
  6: "Q900-949",
  7: "Q950-1000",
};
