/* Cliente de la API pública de UEX Corp (https://uexcorp.space)
   Los GET no requieren token. Cacheamos en localStorage para
   respetar el límite (120 peticiones/min) y acelerar la carga. */

const UEX = (() => {
  const BASE = "https://api.uexcorp.uk/2.0";
  const CACHE_PREFIX = "mineriasc_uex_";
  const TTL_MS = 30 * 60 * 1000; // 30 minutos

  async function get(resource, params = {}) {
    const query = new URLSearchParams(params).toString();
    const url = `${BASE}/${resource}${query ? "?" + query : ""}`;
    const cacheKey = CACHE_PREFIX + resource + ":" + query;

    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey));
      if (cached && Date.now() - cached.t < TTL_MS) return cached.data;
    } catch (_) { /* caché corrupta: se ignora */ }

    const res = await fetch(url);
    if (!res.ok) throw new Error(`UEX ${resource}: HTTP ${res.status}`);
    const json = await res.json();
    if (json.status !== "ok") throw new Error(`UEX ${resource}: ${json.status}`);

    try {
      localStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), data: json.data }));
    } catch (_) { /* localStorage lleno: seguimos sin caché */ }
    return json.data;
  }

  // Todas las commodities (precios medios de compra/venta incluidos)
  const commodities = () => get("commodities");

  // Precios por terminal de una commodity concreta (refinada)
  const commodityPrices = (idCommodity) =>
    get("commodities_prices", { id_commodity: idCommodity });

  // Precios por terminal de minerales en bruto (venta en refinerías)
  const commodityRawPrices = (idCommodity) =>
    get("commodities_raw_prices", { id_commodity: idCommodity });

  // Métodos de refinado (valoraciones de rendimiento/coste/velocidad)
  const refineryMethods = () => get("refineries_methods");

  return { commodities, commodityPrices, commodityRawPrices, refineryMethods };
})();
