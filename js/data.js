/* Carga de mining_data.json (datos de juego, base Strata) y
   construcción de índices para las vistas. */

const DATA = {
  raw: null,           // JSON completo
  ores: {},            // clave -> mineral
  locations: {},       // clave -> ubicación
  locationOres: {},    // clave -> minerales por método
  scannerSignals: {},  // clave -> señal
  refineries: {},      // estación -> {system, capacity_scu, yields}
  oreToLocations: {},  // ORE -> [{locKey, name, system, type, method, prob}]
  oreToSignals: {},    // ORE -> [señales]
  uexByName: {},       // nombre UEX (minúsculas) -> commodity
  uexReady: false,
  marketplaceByBase: {}, // nombre base normalizado (minúsculas) -> [fila averages, ...]
  marketplaceReady: false,
  uexLocations: [], // catálogo ampliado (ciudades/estaciones/outposts) de data/uex_locations.json
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

  // Commodity UEX del mineral en bruto (por uex_name, o display_name como alternativa)
  uexFor(oreKey) {
    const ore = this.ores[oreKey];
    if (!ore) return null;
    return (
      this.uexByName[(ore.uex_name || "").toLowerCase()] ||
      this.uexByName[(ore.display_name || "").toLowerCase()] ||
      null
    );
  },

  // Commodity UEX del mineral refinado: el uex_name sin el sufijo « (Ore)» / « (Raw)»
  uexRefinedFor(oreKey) {
    const ore = this.ores[oreKey];
    if (!ore) return null;
    const base = (ore.uex_name || ore.display_name || "")
      .replace(/\s*\((Ore|Raw)\)\s*$/i, "")
      .toLowerCase();
    return this.uexByName[base] || null;
  },

  // Mejor precio de venta conocido: en bruto si UEX tiene media, si no el refinado
  bestSellFor(oreKey) {
    const raw = this.uexFor(oreKey);
    if (raw && raw.price_sell > 0) return { price: raw.price_sell, refined: false };
    const ref = this.uexRefinedFor(oreKey);
    if (ref && ref.price_sell > 0) return { price: ref.price_sell, refined: true };
    return null;
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

  // Medias del Marketplace P2P del mineral en bruto, un tramo de calidad por fila,
  // ordenadas de menor a mayor calidad. El marketplace agrupa el bruto bajo el
  // nombre del ítem BASE (el refinado, sin sufijo « (Ore)»/« (Raw)»): misma
  // normalización que uexRefinedFor. Devuelve [] si no hay datos (nunca null),
  // para que el consumidor pueda iterar sin comprobar null antes.
  marketplaceAvgFor(oreKey) {
    const ore = this.ores[oreKey];
    if (!ore) return [];
    const base = (ore.uex_name || ore.display_name || "")
      .replace(/\s*\((Ore|Raw)\)\s*$/i, "")
      .toLowerCase();
    const rows = this.marketplaceByBase[base];
    if (!rows || !rows.length) return [];
    return rows.map((r) => ({
      qualityTier: r.quality_tier,
      qualityLabel: QUALITY_TIER_LABELS[r.quality_tier] || `Q${r.quality_tier}`,
      priceAvgScu: Number(r.price_avg),
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
