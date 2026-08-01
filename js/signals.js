/* Pestaña «Señales»: para cada mineral con señales de escáner, muestra
   sus 10 múltiplos (base×1 … base×10) en grande, para leerlos de un
   vistazo mientras se juega. Datos: DATA.scannerSignals / oreToSignals
   (no se tocan; aquí solo se deduplican y traducen para la vista). */

const SIGNAL_CONTEXT_ES = {
  asteroid: "Asteroide",
  surface: "Superficie",
  fps: "A pie (FPS)",
  vehicle: "Vehículo (ROC)",
};

const Signals = {
  selected: null,

  init() {
    document.getElementById("sig-search").addEventListener("input", (e) => {
      this.renderList(e.target.value.trim().toLowerCase());
    });
    this.renderList("");
  },

  // Minerales que tienen al menos una señal de escáner registrada.
  oresWithSignals() {
    return Object.keys(DATA.oreToSignals)
      .filter((key) => DATA.ores[key])
      .map((key) => ({ key, ore: DATA.ores[key] }))
      .sort((a, b) => a.ore.display_name.localeCompare(b.ore.display_name));
  },

  renderList(filter) {
    const container = document.getElementById("sig-list");
    const entries = this.oresWithSignals().filter(({ ore }) =>
      ore.display_name.toLowerCase().includes(filter)
    );

    container.innerHTML = entries
      .map(({ key, ore }) => {
        const n = DATA.oreToSignals[key].length;
        return `<div class="side-item ${key === this.selected ? "active" : ""}" data-ore="${key}">
          <span>${esc(ore.display_name)}</span>
          <span class="sub">${n} señal${n === 1 ? "" : "es"}</span>
        </div>`;
      })
      .join("");

    container.querySelectorAll(".side-item").forEach((el) =>
      el.addEventListener("click", () => this.select(el.dataset.ore))
    );
  },

  // Varias señales del mismo mineral pueden compartir valor (p. ej. la
  // misma cifra vale para asteroide y superficie): se agrupan aquí para
  // no repetir la misma tabla de múltiplos dos veces.
  groupSignals(sigs) {
    const groups = new Map();
    for (const s of sigs) {
      const g = groups.get(s.signal_value) || {
        value: s.signal_value,
        tiers: new Set(),
        contexts: new Set(),
      };
      g.tiers.add(s.tier || "common");
      g.contexts.add(s.mining_context || "");
      groups.set(s.signal_value, g);
    }
    return [...groups.values()].sort((a, b) => b.value - a.value);
  },

  select(oreKey) {
    this.selected = oreKey;
    this.renderList(document.getElementById("sig-search").value.trim().toLowerCase());
    this.renderDetail(oreKey);
  },

  renderDetail(oreKey) {
    const ore = DATA.ores[oreKey];
    const el = document.getElementById("sig-detail");
    const sigs = DATA.oreToSignals[oreKey] || [];

    if (!ore || !sigs.length) {
      el.innerHTML = '<p class="placeholder">Selecciona un mineral con señales de escáner.</p>';
      return;
    }

    const groups = this.groupSignals(sigs);

    const blocks = groups
      .map((g) => {
        const mainTier = [...g.tiers][0];
        const tierLabel = [...g.tiers].join(" / ");
        const contextLabel = [...g.contexts].map((c) => SIGNAL_CONTEXT_ES[c] || c).join(" · ");

        const cards = Array.from({ length: 10 }, (_, i) => i + 1)
          .map(
            (m) => `<div class="mult-card">
              <div class="mult-label">×${m}</div>
              <div class="mult-value">${fmtNum(g.value * m)}</div>
            </div>`
          )
          .join("");

        return `
          <div class="signal-block">
            <div class="signal-block-head">
              <span class="pill tier-${esc(mainTier)}">${esc(tierLabel)}</span>
              <span class="hint">${esc(contextLabel)}</span>
              <span class="signal-base">Base: <b>${fmtNum(g.value)}</b></span>
            </div>
            <div class="mult-grid">${cards}</div>
          </div>`;
      })
      .join("");

    el.innerHTML = `
      <h3>${esc(ore.display_name)}</h3>
      <p class="subtitle">Señal de escáner · ${groups.length} valor${groups.length === 1 ? "" : "es"} distinto${groups.length === 1 ? "" : "s"}</p>
      ${blocks}
    `;
  },
};
