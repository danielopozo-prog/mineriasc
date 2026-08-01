/* Pestaña «Inventario»: registro de lo minado, guardado en localStorage.
   Agrupación por mineral o ubicación, valor estimado con precios UEX,
   y exportación a JSON o texto con formato Discord. */

const Inventory = {
  STORAGE_KEY: "mineriasc_inventory",
  groupBy: "ore",
  entries: [],

  init() {
    try {
      this.entries = JSON.parse(localStorage.getItem(this.STORAGE_KEY)) || [];
    } catch (_) {
      this.entries = [];
    }

    // selects del formulario
    const oreSel = document.getElementById("inv-ore");
    oreSel.innerHTML =
      '<option value="" disabled selected>Mineral…</option>' +
      Object.entries(DATA.ores)
        .sort((a, b) => a[1].display_name.localeCompare(b[1].display_name))
        .map(([k, o]) => `<option value="${k}">${esc(o.display_name)}</option>`)
        .join("");

    const locSel = document.getElementById("inv-loc");
    locSel.innerHTML =
      '<option value="">Ubicación (opcional)…</option>' +
      Object.values(DATA.locationOres)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((l) => `<option value="${esc(l.name)}">${esc(l.name)} (${esc(l.system)})</option>`)
        .join("");

    document.getElementById("inv-form").addEventListener("submit", (e) => {
      e.preventDefault();
      this.add();
    });
    document.getElementById("inv-group-ore").addEventListener("click", () => this.setGroup("ore"));
    document.getElementById("inv-group-loc").addEventListener("click", () => this.setGroup("loc"));
    document.getElementById("inv-export-json").addEventListener("click", () => this.exportJson());
    document.getElementById("inv-export-discord").addEventListener("click", () => this.exportDiscord());
    document.getElementById("inv-clear").addEventListener("click", () => this.clear());

    this.render();
  },

  save() {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.entries));
  },

  add() {
    const ore = document.getElementById("inv-ore").value;
    const qty = parseFloat(document.getElementById("inv-qty").value);
    const loc = document.getElementById("inv-loc").value;
    if (!ore || !(qty > 0)) return;

    this.entries.push({ id: Date.now(), ore, qty, loc, date: new Date().toISOString() });
    this.save();
    this.render();
    document.getElementById("inv-qty").value = "";
    showToast("Añadido al inventario");
  },

  remove(id) {
    this.entries = this.entries.filter((e) => e.id !== id);
    this.save();
    this.render();
  },

  clear() {
    if (!this.entries.length) return;
    if (!confirm("¿Vaciar todo el inventario? Esta acción no se puede deshacer.")) return;
    this.entries = [];
    this.save();
    this.render();
    showToast("Inventario vaciado");
  },

  setGroup(g) {
    this.groupBy = g;
    document.getElementById("inv-group-ore").classList.toggle("active", g === "ore");
    document.getElementById("inv-group-loc").classList.toggle("active", g === "loc");
    this.render();
  },

  valueOf(entry) {
    const best = DATA.bestSellFor(entry.ore);
    return best ? entry.qty * best.price : null;
  },

  render() {
    const summary = document.getElementById("inv-summary");
    const list = document.getElementById("inv-list");

    if (!this.entries.length) {
      summary.innerHTML = "";
      list.innerHTML = '<p class="placeholder">Tu inventario está vacío. Añade lo que vayas minando con el formulario de arriba.</p>';
      return;
    }

    const totalScu = this.entries.reduce((s, e) => s + e.qty, 0);
    const totalValue = this.entries.reduce((s, e) => s + (this.valueOf(e) || 0), 0);
    summary.innerHTML = `
      <div class="stat"><div class="label">Registros</div><div class="value">${this.entries.length}</div></div>
      <div class="stat"><div class="label">Total SCU</div><div class="value">${fmtNum(totalScu, 2)}</div></div>
      <div class="stat"><div class="label">Valor estimado (venta UEX)</div><div class="value accent">${fmtNum(totalValue)} aUEC</div></div>`;

    // agrupar
    const groups = {};
    for (const e of this.entries) {
      const key =
        this.groupBy === "ore"
          ? DATA.ores[e.ore]?.display_name || e.ore
          : e.loc || "Sin ubicación";
      (groups[key] ??= []).push(e);
    }

    list.innerHTML = Object.entries(groups)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, items]) => {
        const scu = items.reduce((s, e) => s + e.qty, 0);
        const val = items.reduce((s, e) => s + (this.valueOf(e) || 0), 0);
        const rows = items
          .map(
            (e) => `<div class="entry">
              <span>
                ${this.groupBy === "ore" ? esc(e.loc || "Sin ubicación") : esc(DATA.ores[e.ore]?.display_name || e.ore)}
                <span class="meta"> · ${new Date(e.date).toLocaleDateString("es-ES")}</span>
              </span>
              <span>
                ${fmtNum(e.qty, 2)} SCU
                <button class="entry-del" data-id="${e.id}" title="Eliminar registro">✕</button>
              </span>
            </div>`
          )
          .join("");
        return `<div class="group">
          <div class="group-head">
            <span>${esc(name)}</span>
            <span>${fmtNum(scu, 2)} SCU · ${fmtNum(val)} aUEC</span>
          </div>${rows}</div>`;
      })
      .join("");

    list.querySelectorAll(".entry-del").forEach((b) =>
      b.addEventListener("click", () => this.remove(Number(b.dataset.id)))
    );
  },

  exportJson() {
    const data = this.entries.map((e) => ({
      ore: e.ore,
      ore_name: DATA.ores[e.ore]?.display_name || e.ore,
      qty_scu: e.qty,
      location: e.loc || null,
      date: e.date,
    }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "inventario_mineria.json";
    a.click();
    URL.revokeObjectURL(a.href);
    showToast("JSON descargado");
  },

  async exportDiscord() {
    const groups = {};
    for (const e of this.entries) {
      const name = DATA.ores[e.ore]?.display_name || e.ore;
      groups[name] = (groups[name] || 0) + e.qty;
    }
    const totalValue = this.entries.reduce((s, e) => s + (this.valueOf(e) || 0), 0);
    const lines = [
      "**⛏️ Inventario de minería**",
      ...Object.entries(groups)
        .sort((a, b) => b[1] - a[1])
        .map(([name, qty]) => `> ${name}: **${fmtNum(qty, 2)} SCU**`),
      `Total estimado: **${fmtNum(totalValue)} aUEC**`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      showToast("Copiado al portapapeles (formato Discord)");
    } catch (_) {
      showToast("No se pudo copiar al portapapeles");
    }
  },
};
