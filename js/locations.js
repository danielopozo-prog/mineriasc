/* Pestaña «Ubicaciones»: filtro por sistema, lista de ubicaciones con datos
   de minerales, y detalle con probabilidades por método de minado. */

const Locations = {
  system: "todos",
  selected: null,
  sortBy: "alpha",
  SORT_KEY: "mineriasc_locations_sort",

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

    this.sortBy = this.loadSort();
    const sortSel = document.getElementById("loc-sort");
    sortSel.value = this.sortBy;
    sortSel.addEventListener("change", () => {
      this.sortBy = sortSel.value;
      this.saveSort();
      this.renderList();
    });

    this.renderList();
  },

  loadSort() {
    try {
      const v = localStorage.getItem(this.SORT_KEY);
      return v === "ores" ? v : "alpha";
    } catch (_) {
      return "alpha";
    }
  },

  saveSort() {
    try {
      localStorage.setItem(this.SORT_KEY, this.sortBy);
    } catch (_) {
      // sin localStorage disponible: el criterio sigue activo esta sesión
    }
  },

  // Nº de minerales identificados en una ubicación — 100% local
  // (location_ores de mining_data.json), disponible siempre, por eso no
  // hace falta gestionar un estado "sin dato" como en Finder (precios UEX).
  oreCountFor(loc) {
    return new Set(Object.values(loc.ores || {}).flat().map((e) => e.ore)).size;
  },

  renderList() {
    const container = document.getElementById("loc-list");
    const entries = Object.entries(DATA.locationOres).filter(
      ([, loc]) => this.system === "todos" || loc.system === this.system
    );

    if (this.sortBy === "ores") {
      // Descendente por defecto (más minerales primero); empate por nombre.
      entries.sort((a, b) => this.oreCountFor(b[1]) - this.oreCountFor(a[1]) || a[1].name.localeCompare(b[1].name));
    } else {
      entries.sort((a, b) => a[1].name.localeCompare(b[1].name));
    }

    container.innerHTML = entries
      .map(([key, loc]) => {
        const nOres = this.oreCountFor(loc);
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
          .sort((a, b) => (b.relative_probability ?? -1) - (a.relative_probability ?? -1))
          .map((e) => {
            const unidentified = !DATA.ores[e.ore];
            const best = DATA.bestSellFor(e.ore);
            const prob =
              e.relative_probability == null
                ? '<span class="hint">Sin medir</span>'
                : `${fmtNum(e.relative_probability, 1)}%`;
            return `<tr class="${unidentified ? "unidentified-ore" : ""}">
              <td>${rarityDotHtml(e.ore)}${esc(DATA.oreLabel(e.ore))}</td>
              <td class="num">${prob}</td>
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
