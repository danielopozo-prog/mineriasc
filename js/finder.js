/* Pestaña «Buscador»: lista de minerales con búsqueda, y ficha de detalle
   con dificultad, precios UEX en vivo, ubicaciones y señales de escáner. */

/* ---------- Rareza (DATA.rarityFor): badge compartido entre vistas ----------
   Se define aquí porque finder.js es el primer módulo de vista que carga
   index.html (justo después de data.js) — locations.js y signals.js, que
   también lo usan, cargan después y lo encuentran ya disponible como global.
   Dos formatos, según cuánto sitio hay en cada contexto (ver CLAUDE.md):
   - rarityBadgeHtml: pill con el texto de la rareza (cabeceras de ficha,
     poco densas).
   - rarityDotHtml: solo un punto de color con title (listas y matriz,
     donde el texto no cabe o rompe la alineación). */
/* Etiquetas en español de las unidades de venta del Marketplace P2P de UEX
   (DATA.marketplaceAvgFor). Presentación pura, por eso vive aquí y no en
   data.js — si aparece una unidad nueva no listada, se usa la clave cruda
   como fallback (mejor que ocultar la fila). */
const UNIT_ES = {
  scu: "SCU",
  unit: "unidad",
  pack: "pack",
  dozen: "docena",
  box: "caja",
  cscu: "cSCU",
  set: "set",
  stack: "pila",
  crate: "cajón",
  hundred: "centena",
};

function rarityDotHtml(oreKey) {
  const r = DATA.rarityFor(oreKey);
  if (!r) return "";
  return `<span class="rarity-dot tier-${esc(r.tier)}" title="Rareza: ${esc(r.label)}" aria-label="Rareza: ${esc(r.label)}"></span>`;
}

function rarityBadgeHtml(oreKey) {
  const r = DATA.rarityFor(oreKey);
  if (!r) return "";
  return `<span class="pill rarity-pill tier-${esc(r.tier)}">${esc(r.label)}</span>`;
}

// Etiquetas del <select> de orden (#ore-sort) — el propio <select> ya sirve
// de "indicador claro del criterio activo" (su .value refleja la elección),
// no hace falta un indicador aparte.
const FINDER_SORT_LABELS = {
  alpha: "Alfabético (A-Z)",
  refined: "Precio refinado",
  p2p: "Precio P2P (Marketplace)",
  rarity: "Rareza",
};

// Valor numérico para ordenar por un criterio no alfabético. null = "sin
// dato" (nunca se inventa un valor) — Finder.renderList() manda esos al
// final de la lista, cualquiera que sea el criterio. El criterio "p2p" NO
// pasa por aquí — tiene su propia función (finderP2pBest) y su propio
// comparador en renderList(), porque no es un único número (ver abajo).
//   - "refined": DATA.uexRefinedFor(oreKey).price_sell — precio UEX del
//     mineral YA refinado (una commodity distinta del bruto). No todo
//     mineral tiene variante refinada (p.ej. Ice no se refina) -> null.
//   - "rarity": DATA.rarityFor(oreKey).tier vía RARITY_ORDER (0=común …
//     4=legendaria, ya definido en data.js) — null si mining_data.json no
//     trae tier fiable para ese mineral.
function finderSortValue(oreKey, criterion) {
  if (criterion === "refined") {
    const c = DATA.uexRefinedFor(oreKey);
    return c && c.price_sell > 0 ? c.price_sell : null;
  }
  if (criterion === "rarity") {
    const r = DATA.rarityFor(oreKey);
    return r ? RARITY_ORDER[r.tier] : null;
  }
  return null;
}

// Mejor precio medio del Marketplace P2P para un mineral, SIN descartar las
// unidades sueltas (pack/caja/docena/unidad...) — DATA.marketplaceAvgFor ya
// trae esas filas con su `unit` real (ver contrato en data.js, parche 4.9):
// el filtro `unit === "scu"` que tenía antes esta vista las descartaba sin
// motivo real, dejando "sin datos P2P" a 13 minerales que SÍ tienen precio,
// solo que no se trafican a granel por SCU (Carinite, Beradom, Hadanite...).
// Devuelve { group: "scu"|"other", unit, price } o null si de verdad no hay
// NINGUNA fila de marketplace para ese mineral (ICE/INERTMATERIAL en el
// parche actual). `group` separa las dos magnitudes NO comparables (aUEC/SCU
// frente a aUEC/unidad-suelta): prioriza SCU si existe (es la unidad de la
// inmensa mayoría, 26 de 39 minerales) y solo cae a "other" si el mineral no
// tiene ninguna fila "scu" — nunca mezcla ambas en un único número.
function finderP2pBest(oreKey) {
  const rows = DATA.marketplaceAvgFor(oreKey);
  if (!rows.length) return null;
  const scuRows = rows.filter((r) => r.unit === "scu");
  const pool = scuRows.length ? scuRows : rows;
  const best = pool.reduce((a, b) => (b.priceAvg > a.priceAvg ? b : a));
  return { group: scuRows.length ? "scu" : "other", unit: best.unit, price: best.priceAvg };
}

// Etiqueta corta de unidad para el texto compacto de subLabelFor — reutiliza
// UNIT_ES salvo "unit", que ahí se traduce a "unidad" (para la tabla de
// detalle, con más sitio) pero aquí se abrevia a "ud" para no desbordar la
// fila de la lista lateral.
function finderUnitShortLabel(unit) {
  return unit === "unit" ? "ud" : UNIT_ES[unit] || unit;
}

const Finder = {
  selected: null,
  sortBy: "alpha",
  SORT_KEY: "mineriasc_finder_sort",

  init() {
    this.sortBy = this.loadSort();
    const sortSel = document.getElementById("ore-sort");
    sortSel.value = this.sortBy;
    sortSel.addEventListener("change", () => {
      this.sortBy = sortSel.value;
      this.saveSort();
      this.renderList(document.getElementById("ore-search").value.trim().toLowerCase());
    });

    document.getElementById("ore-search").addEventListener("input", (e) => {
      this.renderList(e.target.value.trim().toLowerCase());
    });
    this.renderList("");
  },

  loadSort() {
    try {
      const v = localStorage.getItem(this.SORT_KEY);
      return v && FINDER_SORT_LABELS[v] ? v : "alpha";
    } catch (_) {
      return "alpha";
    }
  },

  saveSort() {
    try {
      localStorage.setItem(this.SORT_KEY, this.sortBy);
    } catch (_) {
      // localStorage no disponible (privado/bloqueado): el criterio sigue
      // funcionando en esta sesión, solo no se recuerda entre sesiones.
    }
  },

  renderList(filter) {
    const container = document.getElementById("ore-list");
    let entries = Object.entries(DATA.ores).filter(([, ore]) => ore.display_name.toLowerCase().includes(filter));

    if (this.sortBy === "alpha") {
      entries.sort((a, b) => a[1].display_name.localeCompare(b[1].display_name));
    } else if (this.sortBy === "p2p") {
      // Dos bloques, no un ranking único: aUEC/SCU y aUEC/unidad-suelta no
      // son magnitudes comparables (ver finderP2pBest). Primero todos los
      // "scu" (descendente), luego todos los "other" (descendente entre
      // ellos), y al final los que de verdad no tienen ningún dato.
      entries.sort((a, b) => {
        const pa = finderP2pBest(a[0]);
        const pb = finderP2pBest(b[0]);
        const ra = pa ? (pa.group === "scu" ? 0 : 1) : 2;
        const rb = pb ? (pb.group === "scu" ? 0 : 1) : 2;
        if (ra !== rb) return ra - rb;
        if (ra === 2) return a[1].display_name.localeCompare(b[1].display_name);
        return pb.price - pa.price;
      });
    } else {
      // Descendente por defecto en criterios numéricos (precio/rareza más
      // alta primero); sin dato -> al final, empatando por nombre.
      entries.sort((a, b) => {
        const va = finderSortValue(a[0], this.sortBy);
        const vb = finderSortValue(b[0], this.sortBy);
        if (va == null && vb == null) return a[1].display_name.localeCompare(b[1].display_name);
        if (va == null) return 1;
        if (vb == null) return -1;
        return vb - va;
      });
    }

    container.innerHTML = entries
      .map(([key, ore]) => {
        return `<div class="side-item ${key === this.selected ? "active" : ""}" data-ore="${key}">
          <span class="side-item-name">${rarityDotHtml(key)}${esc(ore.display_name)}</span>
          <span class="sub">${this.subLabelFor(key)}</span>
        </div>`;
      })
      .join("");

    container.querySelectorAll(".side-item").forEach((el) =>
      el.addEventListener("click", () => this.select(el.dataset.ore))
    );

    this.updateSortHints();
  },

  // Texto de la derecha de cada fila: por defecto (orden alfabético) el
  // mejor precio de venta, igual que siempre; con un criterio de orden
  // activo, el propio dato por el que se está ordenando — así el usuario
  // puede comprobar a ojo que el orden es correcto sin abrir cada ficha.
  subLabelFor(oreKey) {
    if (this.sortBy === "refined") {
      const c = DATA.uexRefinedFor(oreKey);
      if (c && c.price_sell > 0) return `${fmtNum(c.price_sell)} aUEC (refinado)`;
      return DATA.uexReady ? "sin refinado" : "cargando…";
    }
    if (this.sortBy === "p2p") {
      const info = finderP2pBest(oreKey);
      if (info) return `${fmtNum(info.price)} aUEC/${finderUnitShortLabel(info.unit)} (P2P)`;
      return DATA.marketplaceReady ? "sin datos P2P" : "cargando…";
    }
    if (this.sortBy === "rarity") {
      const r = DATA.rarityFor(oreKey);
      return r ? r.label : "sin rareza";
    }
    const best = DATA.bestSellFor(oreKey);
    return best ? fmtNum(best.price) + " aUEC" : "";
  },

  // Los dos criterios de precio dependen de datos en vivo que llegan
  // DESPUÉS del primer render (DATA.uexReady/marketplaceReady, ver
  // app.js): mientras no están listos, todas las filas valen null y el
  // orden cae al empate alfabético — no rompe, simplemente no reordena
  // "de verdad" hasta que rerenderLiveViews() vuelva a llamar a
  // renderList() con los datos ya cargados. Aquí solo se avisa en el
  // <select> con "(cargando…)" mientras tanto.
  updateSortHints() {
    const sel = document.getElementById("ore-sort");
    if (!sel) return;
    sel.value = this.sortBy;
    const refinedOpt = sel.querySelector('option[value="refined"]');
    const p2pOpt = sel.querySelector('option[value="p2p"]');
    if (refinedOpt) refinedOpt.textContent = FINDER_SORT_LABELS.refined + (DATA.uexReady ? "" : " (cargando…)");
    if (p2pOpt) p2pOpt.textContent = FINDER_SORT_LABELS.p2p + (DATA.marketplaceReady ? "" : " (cargando…)");
  },

  select(oreKey) {
    this.selected = oreKey;
    this.renderList(document.getElementById("ore-search").value.trim().toLowerCase());
    this.renderDetail(oreKey);
  },

  renderDetail(oreKey) {
    const ore = DATA.ores[oreKey];
    const el = document.getElementById("ore-detail");
    if (!ore) { el.innerHTML = '<p class="placeholder">Mineral no encontrado.</p>'; return; }

    const d = ore.difficulty || {};
    const uexRaw = DATA.uexFor(oreKey);
    const uexRef = DATA.uexRefinedFor(oreKey);
    const locs = DATA.oreToLocations[oreKey] || [];
    const sigs = DATA.oreToSignals[oreKey] || [];
    const mkt = DATA.marketplaceAvgFor(oreKey);
    const bestRef = DATA.bestRefineryFor(oreKey, 3);

    const locRows = locs
      .map(
        (l) => `<tr>
          <td>${esc(l.name)}</td>
          <td>${esc(l.system)}</td>
          <td>${esc(LOC_TYPE_ES[l.type] || l.type)}</td>
          <td>${esc(METHOD_ES[l.method] || l.method)}</td>
          <td class="num">${fmtNum(l.prob, 1)}%</td>
        </tr>`
      )
      .join("");

    const sigPills = sigs
      .map(
        (s) =>
          `<span class="pill tier-${esc(s.tier || "common")}" title="${esc(s.mining_context || "")}">
            ${fmtNum(s.signal_value)} · ${esc(s.tier || "")}</span>`
      )
      .join(" ");

    el.innerHTML = `
      <div class="detail-head-row">
        <h3>${esc(ore.display_name)}</h3>
        ${rarityBadgeHtml(oreKey)}
      </div>
      <p class="subtitle">${esc(METHOD_ES[ore.mining_method] || ore.mining_method)} · forma: ${esc(ore.form || "—")}</p>

      <h4>Dificultad de minado</h4>
      <div class="stat-grid">
        <div class="stat"><div class="label">Inestabilidad</div><div class="value ${d.instability >= 500 ? "bad" : ""}">${fmtNum(d.instability)}</div></div>
        <div class="stat"><div class="label">Resistencia</div><div class="value">${fmtNum(d.resistance, 2)}</div></div>
        <div class="stat"><div class="label">Mult. explosión</div><div class="value ${d.explosion_multiplier >= 50 ? "bad" : ""}">×${fmtNum(d.explosion_multiplier, 1)}</div></div>
        <div class="stat"><div class="label">Factor clúster</div><div class="value">${fmtNum(d.cluster_factor, 2)}</div></div>
      </div>

      <h4>Dónde encontrarlo (${locs.length} ubicaciones)</h4>
      ${
        locs.length
          ? `<div class="table-wrap"><table>
              <thead><tr><th>Ubicación</th><th>Sistema</th><th>Tipo</th><th>Método</th><th>Prob. rel.</th></tr></thead>
              <tbody>${locRows}</tbody></table></div>`
          : '<span class="hint">Sin datos de ubicación para este mineral.</span>'
      }

      <h4>Señales de escáner (${sigs.length})</h4>
      <div>${sigPills || '<span class="hint">Sin señales específicas registradas.</span>'}</div>

      ${
        bestRef.length
          ? `<h4>Dónde refinarlo mejor</h4>
            <div class="table-wrap"><table>
              <thead><tr><th>Estación</th><th>Sistema</th><th>Bono</th></tr></thead>
              <tbody>${bestRef
                .map(
                  (r) => `<tr>
                    <td>${esc(r.station)}</td>
                    <td>${esc(r.system)}</td>
                    <td class="num ${r.bonusPct > 0 ? "good" : r.bonusPct < 0 ? "bad" : ""}">${r.bonusPct > 0 ? "+" : ""}${fmtNum(r.bonusPct)}%</td>
                  </tr>`
                )
                .join("")}</tbody></table></div>`
          : ""
      }

      <h4>Precios (UEX, en vivo)</h4>
      <div class="stat-grid" id="ore-prices">
        ${
          uexRef && uexRef.price_sell > 0
            ? `<div class="stat"><div class="label">Venta refinado (media)</div><div class="value accent">${fmtNum(uexRef.price_sell)} aUEC/SCU</div></div>`
            : ""
        }
        ${
          uexRaw && uexRaw.price_sell > 0
            ? `<div class="stat"><div class="label">Venta en bruto (media)</div><div class="value">${fmtNum(uexRaw.price_sell)} aUEC/SCU</div></div>`
            : ""
        }
        ${
          !(uexRef && uexRef.price_sell > 0) && !(uexRaw && uexRaw.price_sell > 0)
            ? `<div class="stat"><div class="label">Precios</div><div class="value">${DATA.uexReady ? "Sin datos UEX" : "Cargando…"}</div></div>`
            : ""
        }
      </div>
      ${uexRaw || uexRef ? `<div id="ore-terminals" class="loading">Cargando mejores terminales de venta…</div>` : ""}

      ${this.renderMarketplaceSection(mkt)}
    `;

    if (uexRaw || uexRef) this.loadTerminals(uexRaw, uexRef, oreKey);
  },

  // Mercado de jugadores (UEX Marketplace): DATA.marketplaceAvgFor ya no
  // asume SCU — cada fila trae su `unit` real ("scu", "unit", "pack"...) y
  // `priceAvg` es el precio de UNA unidad de venta, no de un SCU (ver
  // comentario de contrato en data.js). Nunca hay que mezclar ambas
  // magnitudes en la misma tabla sin etiquetar: se separan en dos bloques,
  // uno "por SCU" (mayoría de minerales) y otro "por unidad de venta" para
  // los que solo se trafican en packs/docenas/cajas (p.ej. Carinite).
  renderMarketplaceSection(mkt) {
    if (!mkt.length) return "";

    const rowHtml = (m, unitLabel) => `
      <tr class="${m.listingsCount < 3 ? "low-confidence" : ""}" title="${
        m.listingsCount < 3 ? "Pocos anuncios: dato poco fiable" : ""
      }">
        <td>${esc(m.qualityLabel)}</td>
        ${unitLabel !== null ? `<td>${esc(unitLabel)}</td>` : ""}
        <td class="num">${fmtNum(m.priceAvg)} aUEC</td>
        <td class="num">${fmtNum(m.listingsCount)}</td>
      </tr>`;

    const scuRows = mkt.filter((m) => m.unit === "scu");
    const otherRows = mkt.filter((m) => m.unit !== "scu");

    const scuBlock = scuRows.length
      ? `<h5>Por SCU</h5>
        <div class="table-wrap"><table>
          <thead><tr><th>Calidad</th><th>Precio medio/SCU</th><th>Anuncios</th></tr></thead>
          <tbody>${scuRows.map((m) => rowHtml(m, null)).join("")}</tbody></table></div>`
      : "";

    const otherBlock = otherRows.length
      ? `<h5>Por unidad de venta</h5>
        <p class="hint">Se venden en packs/docenas/cajas, no a granel por SCU — el precio es por unidad de venta indicada.</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Calidad</th><th>Unidad</th><th>Precio medio</th><th>Anuncios</th></tr></thead>
          <tbody>${otherRows.map((m) => rowHtml(m, UNIT_ES[m.unit] || m.unit)).join("")}</tbody></table></div>`
      : "";

    return `
      <h4>Mercado de jugadores (UEX Marketplace)</h4>
      <p class="hint" title="Media de anuncios entre jugadores en el Marketplace de UEX, por tramo de calidad. Dato orientativo, no es precio oficial de terminal.">
        Anuncios entre jugadores, por tramo de calidad · orientativo, no oficial
      </p>
      ${scuBlock}
      ${otherBlock}
    `;
  },

  // Mejores terminales donde vender, bajo demanda por mineral.
  // En bruto se vende en refinerías (commodities_raw_prices); si no hay
  // datos, mostramos los terminales del refinado.
  async loadTerminals(uexRaw, uexRef, oreKey) {
    const box = document.getElementById("ore-terminals");
    try {
      let prices = uexRaw ? await UEX.commodityRawPrices(uexRaw.id) : [];
      let label = "Mejor venta en bruto";
      if (!prices.length && uexRef) {
        prices = await UEX.commodityPrices(uexRef.id);
        label = "Mejor venta refinado";
      }
      if (this.selected !== oreKey) return; // el usuario ya cambió de mineral
      const best = prices
        .filter((p) => p.price_sell > 0)
        .sort((a, b) => b.price_sell - a.price_sell)
        .slice(0, 5);
      if (!best.length) { box.innerHTML = '<span class="hint">Ningún terminal compra este mineral ahora mismo.</span>'; return; }
      box.classList.remove("loading");
      box.innerHTML = `
        <div class="table-wrap"><table>
          <thead><tr><th>${label}</th><th>Sistema</th><th>Precio</th></tr></thead>
          <tbody>${best
            .map(
              (p) => `<tr>
                <td>${esc(p.terminal_name)}</td>
                <td>${esc(p.star_system_name || "")}</td>
                <td class="num good">${fmtNum(p.price_sell)} aUEC/SCU</td>
              </tr>`
            )
            .join("")}</tbody></table></div>`;
    } catch (err) {
      box.innerHTML = `<span class="error-msg">No se pudieron cargar los terminales (${esc(err.message)}).</span>`;
    }
  },
};
