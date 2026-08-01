/* Cliente de la API pública de UEX Corp (https://uexcorp.space)
   Los GET no requieren token. Cacheamos en localStorage para
   respetar el límite (120 peticiones/min) y acelerar la carga. */

const UEX = (() => {
  const BASE = "https://api.uexcorp.uk/2.0";
  const CACHE_PREFIX = "mineriasc_uex_";
  const TTL_MS = 30 * 60 * 1000; // 30 minutos

  // `force`: salta la lectura de caché (para refrescos manuales desde la UI).
  // No borra la entrada previa antes de tener éxito: si el fetch falla, la
  // caché vieja (aunque caducada) queda intacta y la app sigue sirviendo esos
  // datos — nunca se degrada peor que un arranque sin refresco.
  async function get(resource, params = {}, force = false) {
    const query = new URLSearchParams(params).toString();
    const url = `${BASE}/${resource}${query ? "?" + query : ""}`;
    const cacheKey = CACHE_PREFIX + resource + ":" + query;

    if (!force) {
      try {
        const cached = JSON.parse(localStorage.getItem(cacheKey));
        if (cached && Date.now() - cached.t < TTL_MS) return cached.data;
      } catch (_) { /* caché corrupta: se ignora */ }
    }

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
  const commodities = (force = false) => get("commodities", {}, force);

  // Precios por terminal de una commodity concreta (refinada)
  const commodityPrices = (idCommodity) =>
    get("commodities_prices", { id_commodity: idCommodity });

  // Precios por terminal de minerales en bruto (venta en refinerías)
  const commodityRawPrices = (idCommodity) =>
    get("commodities_raw_prices", { id_commodity: idCommodity });

  // Métodos de refinado (valoraciones de rendimiento/coste/velocidad)
  const refineryMethods = () => get("refineries_methods");

  // Medias del Marketplace P2P (jugador-a-jugador) por ítem/tramo de calidad/
  // unidad/operación. El payload completo ronda 1,3 MB y trae TODOS los ítems
  // del juego (armas, ropa, naves…) en todas las unidades y operaciones. La
  // app solo necesita VENTA (nunca compra), así que filtramos ANTES de
  // cachear por `operation === "sell"` (reduce a ~1,28 MB — medido en vivo,
  // parche 4.9: 3644 filas totales -> 3237 en sell) para no agotar la cuota
  // de localStorage. No reutiliza get(): ese helper cachea la respuesta tal
  // cual llega, y aquí necesitamos guardar solo el subconjunto filtrado.
  //
  // Por qué NO se filtra también por `unit`: hasta el parche 4.9 se filtraba
  // además a `unit === "scu"` (reduce a ~40 KB), pero eso descarta anuncios
  // reales de 13 minerales (gemas de cueva/vehículo: Carinite, Carinite
  // (Pure), Aphorite, Beradom, Dolivine, Feynmaline, Glacosite, Hadanite,
  // Jaclium, Janalite, Sadaryx, Saldynium, Tin) que SOLO se trafican por
  // unidad/pack/dozen/etc., nunca por SCU — ver .claude/guides/uex-api.md.
  // La alternativa de whitelistear por `unit` en vez de por `item_name` NO
  // reduce el payload: medido contra los 39 minerales reales de
  // mining_data.json, 9 de las 10 unidades de venta que trae la API entera
  // (todas salvo "pair"/"thousand") ya aparecen en nuestros propios
  // minerales, así que ese filtro apenas descarta filas. Whitelistear por
  // `item_name` sí reduciría a ~160 KB, pero exigiría que este cliente
  // genérico de UEX conozca la lista de 39 minerales de mining_data.json
  // (dominio de DATA, no de UEX) y resincronizarla a mano en cada parche que
  // añada/quite un mineral — acoplamiento peor que el coste de memoria.
  // 1,28 MB es un número medido, no una suposición: deja margen amplio sobre
  // la cuota real de localStorage (mínimo de especificación 5 MB, la mayoría
  // de navegadores da más), incluso sumado al resto de cachés de UEX
  // (`commodities` ronda 148 KB, `refineries_methods` ~1 KB). Si un parche
  // futuro dispara este número muy por encima (revisar tras cada actualización
  // de mining_data.json), la vía correcta es mover el whitelist de
  // `item_name` a `DATA.loadMarketplaceAverages` — seguirá sin reducir lo que
  // ENTRA por fetch, pero al menos hay que decidir entonces si merece la pena
  // el acoplamiento.
  //
  // `force`: mismo contrato que en get() — salta la lectura de caché pero solo
  // la sobrescribe si el fetch tiene éxito.
  const marketplaceAveragesAll = async (force = false) => {
    const resource = "marketplace_prices_averages_all";
    const cacheKey = CACHE_PREFIX + resource + ":operation=sell";

    if (!force) {
      try {
        const cached = JSON.parse(localStorage.getItem(cacheKey));
        if (cached && Date.now() - cached.t < TTL_MS) return cached.data;
      } catch (_) { /* caché corrupta: se ignora */ }
    }

    const res = await fetch(`${BASE}/${resource}`);
    if (!res.ok) throw new Error(`UEX ${resource}: HTTP ${res.status}`);
    const json = await res.json();
    if (json.status !== "ok") throw new Error(`UEX ${resource}: ${json.status}`);

    const filtered = json.data.filter((r) => r.operation === "sell");

    try {
      localStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), data: filtered }));
    } catch (_) { /* localStorage lleno: seguimos sin caché */ }
    return filtered;
  };

  return {
    commodities,
    commodityPrices,
    commodityRawPrices,
    refineryMethods,
    marketplaceAveragesAll,
  };
})();
