/* Pestaña «Señales»: para cada mineral con señales de escáner, muestra
   sus 15 múltiplos (base×1 … base×15) en grande, para leerlos de un
   vistazo mientras se juega. Datos: DATA.scannerSignals / oreToSignals
   (no se tocan; aquí solo se deduplican y traducen para la vista).

   Incluye también:
   - Búsqueda inversa: el jugador teclea la cifra que le muestra el
     escáner y la vista le dice qué mineral y qué múltiplo es (exacto o
     el más cercano).
   - Favoritos de mineral, persistidos en localStorage, que se muestran
     agrupados arriba de la lista y se priorizan en la búsqueda inversa. */

const SIGNAL_CONTEXT_ES = {
  asteroid: "Asteroide",
  surface: "Superficie",
  fps: "A pie (FPS)",
  vehicle: "Vehículo (ROC)",
};

const SIGNAL_MULTIPLIERS = 15;
const FAVORITES_KEY = "mineriasc_favorites";

const Signals = {
  selected: null,
  favorites: [],

  init() {
    this.favorites = this.loadFavorites();

    document.getElementById("sig-search").addEventListener("input", (e) => {
      this.renderList(e.target.value.trim().toLowerCase());
    });
    document.getElementById("sig-reverse-input").addEventListener("input", (e) => {
      this.renderReverse(e.target.value);
    });

    this.renderList("");
    this.renderReverse("");
  },

  /* ---------- Favoritos (localStorage) ---------- */

  loadFavorites() {
    try {
      const raw = JSON.parse(localStorage.getItem(FAVORITES_KEY));
      return Array.isArray(raw) ? raw.filter((k) => typeof k === "string") : [];
    } catch {
      return [];
    }
  },

  saveFavorites() {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(this.favorites));
  },

  isFavorite(oreKey) {
    return this.favorites.includes(oreKey);
  },

  toggleFavorite(oreKey) {
    if (this.isFavorite(oreKey)) {
      this.favorites = this.favorites.filter((k) => k !== oreKey);
    } else {
      this.favorites.push(oreKey);
    }
    this.saveFavorites();

    this.renderList(document.getElementById("sig-search").value.trim().toLowerCase());
    this.renderReverse(document.getElementById("sig-reverse-input").value);
    if (this.selected) this.renderDetail(this.selected);
  },

  favStarHtml(oreKey, extraClass = "") {
    const fav = this.isFavorite(oreKey);
    return `<button type="button" class="fav-star ${fav ? "active" : ""} ${extraClass}" data-ore="${esc(oreKey)}" title="${fav ? "Quitar de favoritos" : "Marcar como favorito"}" aria-label="${fav ? "Quitar de favoritos" : "Marcar como favorito"}">${fav ? "★" : "☆"}</button>`;
  },

  attachFavStarListeners(container) {
    container.querySelectorAll(".fav-star").forEach((btn) =>
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.toggleFavorite(btn.dataset.ore);
      })
    );
  },

  /* ---------- Lista lateral ---------- */

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

    const renderItem = ({ key, ore }) => {
      const n = DATA.oreToSignals[key].length;
      return `<div class="side-item ${key === this.selected ? "active" : ""}" data-ore="${esc(key)}">
        ${this.favStarHtml(key)}
        <span class="side-item-name">${esc(ore.display_name)}</span>
        <span class="sub">${n} señal${n === 1 ? "" : "es"}</span>
      </div>`;
    };

    const favEntries = entries.filter(({ key }) => this.isFavorite(key));
    const restEntries = entries.filter(({ key }) => !this.isFavorite(key));

    let html = "";
    if (favEntries.length) {
      html += `<div class="side-group-head">Favoritos</div>`;
      html += favEntries.map(renderItem).join("");
    }
    if (restEntries.length) {
      if (favEntries.length) html += `<div class="side-group-head">Todos</div>`;
      html += restEntries.map(renderItem).join("");
    }
    container.innerHTML = html || '<p class="placeholder">Sin resultados.</p>';

    container.querySelectorAll(".side-item").forEach((el) =>
      el.addEventListener("click", () => this.select(el.dataset.ore))
    );
    this.attachFavStarListeners(container);
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

        const cards = Array.from({ length: SIGNAL_MULTIPLIERS }, (_, i) => i + 1)
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
      <div class="detail-head-row">
        <h3>${esc(ore.display_name)}</h3>
        ${this.favStarHtml(oreKey, "fav-star-lg")}
      </div>
      <p class="subtitle">Señal de escáner · ${groups.length} valor${groups.length === 1 ? "" : "es"} distinto${groups.length === 1 ? "" : "s"}</p>
      ${blocks}
    `;

    this.attachFavStarListeners(el);
  },

  /* ---------- Búsqueda inversa ---------- */

  // Acepta el número con o sin puntos de miles (o comas): se quita todo
  // lo que no sea dígito.
  parseReverseInput(raw) {
    const digits = (raw || "").replace(/[^\d]/g, "");
    if (!digits) return null;
    return Number(digits);
  },

  // Un candidato por cada valor base de señal (mineral × contexto): el
  // múltiplo (1..15) cuyo resultado cae más cerca del valor buscado. Así
  // un mineral no ocupa varias plazas del top de cercanas con sus otros
  // múltiplos, mal encajados — cada mineral compite con su mejor tiro.
  bestCandidatesPerGroup(target) {
    const out = [];
    for (const { key, ore } of this.oresWithSignals()) {
      const groups = this.groupSignals(DATA.oreToSignals[key]);
      for (const g of groups) {
        let mult = Math.round(target / g.value);
        mult = Math.min(SIGNAL_MULTIPLIERS, Math.max(1, mult));
        const value = g.value * mult;
        out.push({
          oreKey: key,
          oreName: ore.display_name,
          mult,
          value,
          diff: Math.round(value - target),
          tiers: [...g.tiers],
          contexts: [...g.contexts],
        });
      }
    }
    return out;
  },

  renderReverse(rawValue) {
    const container = document.getElementById("sig-reverse-results");
    const target = this.parseReverseInput(rawValue);

    if (target == null) {
      container.innerHTML = "";
      return;
    }

    const all = this.bestCandidatesPerGroup(target);

    const sortFn = (a, b) => {
      const favA = this.isFavorite(a.oreKey) ? 0 : 1;
      const favB = this.isFavorite(b.oreKey) ? 0 : 1;
      if (favA !== favB) return favA - favB;
      const d = Math.abs(a.diff) - Math.abs(b.diff);
      if (d !== 0) return d;
      return a.oreName.localeCompare(b.oreName);
    };

    const exact = all.filter((it) => it.diff === 0);
    let list, heading, exactMode;
    if (exact.length) {
      list = exact.sort(sortFn);
      heading = `Coincidencia exacta · ${fmtNum(target)}`;
      exactMode = true;
    } else {
      list = all.sort(sortFn).slice(0, 5);
      heading = `Sin coincidencia exacta con ${fmtNum(target)} — más cercanas:`;
      exactMode = false;
    }

    const rows = list
      .map((it) => {
        const fav = this.isFavorite(it.oreKey);
        const tierLabel = it.tiers.join(" / ");
        const contextLabel = it.contexts.map((c) => SIGNAL_CONTEXT_ES[c] || c).join(" · ");
        const devLabel = exactMode
          ? ""
          : ` <span class="sig-hit-dev">(${it.diff > 0 ? "+" : ""}${fmtNum(it.diff)})</span>`;

        return `<div class="sig-hit ${fav ? "favorite" : ""}" data-ore="${esc(it.oreKey)}">
          ${this.favStarHtml(it.oreKey)}
          <div class="sig-hit-body">
            <div class="sig-hit-top">
              <span class="sig-hit-ore">${esc(it.oreName)}</span>
              <span class="sig-hit-mult">×${it.mult}</span>
            </div>
            <div class="sig-hit-value">${fmtNum(it.value)}${devLabel}</div>
            <div class="sig-hit-meta">
              <span class="pill tier-${esc(it.tiers[0] || "common")}">${esc(tierLabel)}</span>
              <span class="hint">${esc(contextLabel)}</span>
            </div>
          </div>
        </div>`;
      })
      .join("");

    container.innerHTML = `<div class="sig-reverse-heading">${esc(heading)}</div>${rows}`;

    container.querySelectorAll(".sig-hit").forEach((el) =>
      el.addEventListener("click", () => this.select(el.dataset.ore))
    );
    this.attachFavStarListeners(container);
  },
};
