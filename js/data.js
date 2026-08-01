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

  // Precios UEX: se cargan aparte para que la app funcione aunque la API falle
  async loadUexPrices() {
    const list = await UEX.commodities();
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

  systems() {
    return [...new Set(Object.values(this.locations).map((l) => l.system))].sort();
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
  lagrange_point: "Punto de Lagrange",
  station: "Estación",
  ring: "Anillo",
  cave: "Cueva",
  surface: "Superficie",
};

const METHOD_ES = {
  ship: "Nave",
  fps: "A pie (FPS)",
  vehicle: "Vehículo (ROC)",
  hand: "Manual",
};
