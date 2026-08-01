/* Pestaña «Ubicaciones»: filtro por sistema, lista de ubicaciones con datos
   de minerales, y detalle con probabilidades por método de minado. */

const Locations = {
  system: "todos",
  selected: null,

  init() {
    const systems = DATA.systems();
    const filterBox = document.getElementById("system-filter");
    filterBox.innerHTML =
      `<button class="btn small active" data-system="todos">Todos</button>` +
      systems.map((s) => `<button class="btn small" data-system="${esc(s)}">${esc(s)}</button>`).join("");

    filterBox.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => {
        filterBox.querySelectorAll("button").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        this.system = b.dataset.system;
        this.renderList();
      })
    );
    this.renderList();
  },

  renderList() {
    const container = document.getElementById("loc-list");
    const entries = Object.entries(DATA.locationOres)
      .filter(([, loc]) => this.system === "todos" || loc.system === this.system)
      .sort((a, b) => a[1].name.localeCompare(b[1].name));

    container.innerHTML = entries
      .map(([key, loc]) => {
        const nOres = new Set(
          Object.values(loc.ores || {}).flat().map((e) => e.ore)
        ).size;
        return `<div class="side-item ${key === this.selected ? "active" : ""}" data-loc="${key}">
          <span>${esc(loc.name)}</span>
          <span class="sub">${esc(loc.system)} · ${nOres} minerales</span>
        </div>`;
      })
      .join("");

    container.querySelectorAll(".side-item").forEach((el) =>
      el.addEventListener("click", () => this.select(el.dataset.loc))
    );
  },

  select(locKey) {
    this.selected = locKey;
    this.renderList();
    this.renderDetail(locKey);
  },

  renderDetail(locKey) {
    const loc = DATA.locationOres[locKey];
    const el = document.getElementById("loc-detail");
    if (!loc) { el.innerHTML = '<p class="placeholder">Ubicación no encontrada.</p>'; return; }

    // Refinería cercana: la ubicación "hermana" (mismo nombre) en locations
    const locMeta = Object.values(DATA.locations).find((l) => l.display_name === loc.name);
    const refinery = locMeta?.has_refinery;

    const methodBlocks = Object.entries(loc.ores || {})
      .map(([method, entries]) => {
        const rows = [...entries]
          .sort((a, b) => b.relative_probability - a.relative_probability)
          .map((e) => {
            const ore = DATA.ores[e.ore];
            const best = DATA.bestSellFor(e.ore);
            return `<tr>
              <td>${esc(ore?.display_name || e.ore)}</td>
              <td class="num">${fmtNum(e.relative_probability, 1)}%</td>
              <td class="num">${best ? fmtNum(best.price) + " aUEC" : "—"}</td>
            </tr>`;
          })
          .join("");
        return `
          <h4>${esc(METHOD_ES[method] || method)} (${entries.length})</h4>
          <div class="table-wrap"><table>
            <thead><tr><th>Mineral</th><th>Prob. relativa</th><th>Venta (UEX)</th></tr></thead>
            <tbody>${rows}</tbody></table></div>`;
      })
      .join("");

    el.innerHTML = `
      <h3>${esc(loc.name)}</h3>
      <p class="subtitle">
        ${esc(loc.system)} · ${esc(LOC_TYPE_ES[loc.type] || loc.type)}
        ${refinery ? ' · <span style="color:var(--good)">⚙ Con refinería</span>' : ""}
      </p>
      ${methodBlocks || '<p class="placeholder">Sin datos de minerales para esta ubicación.</p>'}
    `;
  },
};
