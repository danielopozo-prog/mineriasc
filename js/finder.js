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

const Finder = {
  selected: null,

  init() {
    document.getElementById("ore-search").addEventListener("input", (e) => {
      this.renderList(e.target.value.trim().toLowerCase());
    });
    this.renderList("");
  },

  renderList(filter) {
    const container = document.getElementById("ore-list");
    const entries = Object.entries(DATA.ores)
      .filter(([, ore]) => ore.display_name.toLowerCase().includes(filter))
      .sort((a, b) => a[1].display_name.localeCompare(b[1].display_name));

    container.innerHTML = entries
      .map(([key, ore]) => {
        const best = DATA.bestSellFor(key);
        const price = best ? fmtNum(best.price) + " aUEC" : "";
        return `<div class="side-item ${key === this.selected ? "active" : ""}" data-ore="${key}">
          <span class="side-item-name">${rarityDotHtml(key)}${esc(ore.display_name)}</span>
          <span class="sub">${price}</span>
        </div>`;
      })
      .join("");

    container.querySelectorAll(".side-item").forEach((el) =>
      el.addEventListener("click", () => this.select(el.dataset.ore))
    );
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

      ${
        mkt.length
          ? `<h4>Mercado de jugadores (UEX Marketplace)</h4>
            <p class="hint" title="Media de anuncios entre jugadores en el Marketplace de UEX, por tramo de calidad. Dato orientativo, no es precio oficial de terminal.">
              Anuncios entre jugadores, por tramo de calidad · orientativo, no oficial
            </p>
            <div class="table-wrap"><table>
              <thead><tr><th>Calidad</th><th>Precio medio/SCU</th><th>Anuncios</th></tr></thead>
              <tbody>${mkt
                .map(
                  (m) => `<tr class="${m.listingsCount < 3 ? "low-confidence" : ""}" title="${
                    m.listingsCount < 3 ? "Pocos anuncios: dato poco fiable" : ""
                  }">
                    <td>${esc(m.qualityLabel)}</td>
                    <td class="num">${fmtNum(m.priceAvgScu)} aUEC</td>
                    <td class="num">${fmtNum(m.listingsCount)}</td>
                  </tr>`
                )
                .join("")}</tbody></table></div>`
          : ""
      }
    `;

    if (uexRaw || uexRef) this.loadTerminals(uexRaw, uexRef, oreKey);
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
