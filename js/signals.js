/* Pestaña «Señales»: para cada mineral con señales de escáner, muestra
   sus 15 múltiplos (base×1 … base×15) en grande, para leerlos de un
   vistazo mientras se juega. Datos: DATA.scannerSignals / oreToSignals
   (no se tocan; aquí solo se deduplican y traducen para la vista).

   Selección múltiple: se puede tener varios minerales activos a la vez
   (clic = alternar en la selección, no reemplazarla). Con 1 seleccionado
   la ficha se ve igual que siempre; con varios, se apilan una sección
   por mineral, cada una con su propio cabecero y botón para quitarla.
   La selección vive solo en memoria (this.selected, un Set) — no se
   persiste entre sesiones, igual que antes de este cambio.

   Incluye también:
   - Búsqueda inversa: el jugador teclea la cifra que le muestra el
     escáner y la vista le dice qué mineral y qué múltiplo es (exacto o
     el más cercano). Un clic en un resultado también alterna su
     selección.
   - Favoritos de mineral, persistidos en localStorage, que se muestran
     agrupados arriba de la lista y se priorizan en la búsqueda inversa.
   - Modo "por ubicación": el jugador elige una ubicación de minado (zonas
     de mining_data.json, vía DATA.locationOres — NO el catálogo ampliado
     de estaciones/ciudades de UEX, que no tiene minerales asociados) y ve
     TODAS las señales posibles (base × ×1..15) de los minerales presentes
     ahí, como una MATRIZ: una fila por mineral (dos filas si tiene dos
     valores base distintos, p. ej. asteroide vs. FPS), columnas fijas
     ×15..×1 (de mayor a menor, izquierda a derecha) alineadas entre
     filas — así se compara de un vistazo qué mineral cae cerca de una
     lectura del escáner en el mismo rango de columnas. Filas ordenadas
     por valor base descendente. Convive con el modo por mineral: mientras
     está activo se oculta el `.split` (lista+ficha) y se muestra
     `#sig-loc-guide` en su lugar; "Volver a minerales" restaura el
     `.split` sin tocar selección/favoritos/búsqueda inversa, que viven en
     el mismo estado de siempre. */

const SIGNAL_CONTEXT_ES = {
  asteroid: "Asteroide",
  surface: "Superficie",
  fps: "A pie (FPS)",
  vehicle: "Vehículo (ROC)",
};

const SIGNAL_MULTIPLIERS = 15;
const FAVORITES_KEY = "mineriasc_favorites";

const Signals = {
  selected: new Set(),
  favorites: [],
  // locKey de la ubicación activa en el modo "por ubicación", o null si el
  // modo no está activo (vista normal por mineral).
  activeLocKey: null,

  init() {
    this.favorites = this.loadFavorites();

    document.getElementById("sig-search").addEventListener("input", (e) => {
      this.renderList(e.target.value.trim().toLowerCase());
    });
    document.getElementById("sig-reverse-input").addEventListener("input", (e) => {
      this.renderReverse(e.target.value);
    });
    document.getElementById("sig-clear-selection").addEventListener("click", () => {
      this.clearSelection();
    });

    this.initLocMode();

    this.renderList("");
    this.renderReverse("");
    this.renderDetail();
    this.updateClearButton();
  },

  /* ---------- Modo "por ubicación" ---------- */

  // Ubicaciones de minado (mining_data.json vía DATA.locationOres), NO el
  // catálogo ampliado de UEX (DATA.allLocations()/DATA.uexLocations): ese
  // catálogo tiene ciudades/estaciones sin minerales asociados, inútil aquí.
  miningLocations() {
    return Object.entries(DATA.locationOres)
      .map(([locKey, loc]) => ({ locKey, name: loc.name, system: loc.system }))
      .sort((a, b) => (a.system || "").localeCompare(b.system || "") || a.name.localeCompare(b.name));
  },

  initLocMode() {
    const sel = document.getElementById("sig-loc-select");
    const bySystem = {};
    for (const l of this.miningLocations()) {
      (bySystem[l.system || "Otro"] ??= []).push(l);
    }
    sel.innerHTML =
      '<option value="">Elige una ubicación de minado…</option>' +
      Object.entries(bySystem)
        .map(
          ([system, locs]) =>
            `<optgroup label="${esc(system)}">${locs
              .map((l) => `<option value="${esc(l.locKey)}">${esc(l.name)}</option>`)
              .join("")}</optgroup>`
        )
        .join("");

    sel.addEventListener("change", () => this.selectLocation(sel.value));
    document.getElementById("sig-loc-back").addEventListener("click", () => this.clearLocation());
  },

  // Minerales presentes en una ubicación (todos los métodos de minado
  // fusionados, sin duplicados), limitados a los que tienen ficha en
  // DATA.ores (descarta los UNKNOWN_* sin identificar todavía) y al menos
  // una señal de escáner conocida (si no, no hay nada que mostrar de él).
  oresAtLocation(locKey) {
    const loc = DATA.locationOres[locKey];
    if (!loc) return [];
    const keys = new Set();
    for (const list of Object.values(loc.ores || {})) {
      for (const e of list) keys.add(e.ore);
    }
    return [...keys]
      .filter((k) => DATA.ores[k] && (DATA.oreToSignals[k] || []).length)
      .map((k) => ({ key: k, ore: DATA.ores[k] }))
      .sort((a, b) => a.ore.display_name.localeCompare(b.ore.display_name));
  },

  // Filas de la matriz de una ubicación: una fila por cada valor base
  // distinto de cada mineral presente (groupSignals ya deduplica
  // asteroide/superficie que comparten cifra — si un mineral tiene 2
  // valores base distintos, aporta 2 filas). Cada fila trae sus 15
  // celdas ×15..×1 ya calculadas, en ese orden, para que las columnas
  // queden alineadas entre filas. Filas ordenadas por valor base
  // descendente (empate: nombre, para que el orden sea determinista).
  locGuideRows(locKey) {
    const ores = this.oresAtLocation(locKey);

    const rows = [];
    for (const { key, ore } of ores) {
      const groups = this.groupSignals(DATA.oreToSignals[key] || []);
      for (const g of groups) {
        const contextLabel = [...g.contexts]
          .map((c) => SIGNAL_CONTEXT_ES[c] || c)
          .filter(Boolean)
          .join(" · ");
        const cells = [];
        for (let m = SIGNAL_MULTIPLIERS; m >= 1; m--) {
          cells.push({ mult: m, value: g.value * m });
        }
        rows.push({
          oreKey: key,
          oreName: ore.display_name,
          multiRow: groups.length > 1,
          contextLabel,
          base: g.value,
          cells,
        });
      }
    }
    rows.sort((a, b) => b.base - a.base || a.oreName.localeCompare(b.oreName));
    return { ores, rows };
  },

  selectLocation(locKey) {
    this.activeLocKey = locKey || null;
    document.getElementById("sig-split").hidden = !!this.activeLocKey;
    document.getElementById("sig-loc-back").hidden = !this.activeLocKey;
    this.renderLocGuide();
  },

  clearLocation() {
    document.getElementById("sig-loc-select").value = "";
    this.selectLocation(null);
  },

  renderLocGuide() {
    const el = document.getElementById("sig-loc-guide");
    if (!this.activeLocKey) {
      el.hidden = true;
      el.innerHTML = "";
      return;
    }
    el.hidden = false;

    const loc = DATA.locationOres[this.activeLocKey];
    const locName = loc?.name || "esta ubicación";
    const { ores, rows } = this.locGuideRows(this.activeLocKey);

    if (!ores.length) {
      el.innerHTML = `<p class="placeholder">${esc(locName)} no tiene minerales con señal de escáner registrada.</p>`;
      return;
    }

    const target = this.parseReverseInput(document.getElementById("sig-reverse-input").value);

    const headCells = Array.from({ length: SIGNAL_MULTIPLIERS }, (_, i) => SIGNAL_MULTIPLIERS - i)
      .map((m) => `<th>×${m}</th>`)
      .join("");

    const rowsHtml = rows
      .map((r) => {
        const sel = this.selected.has(r.oreKey);
        const cellsHtml = r.cells
          .map((c) => {
            const match = target != null && c.value === target;
            return `<td class="sig-loc-cell ${match ? "match" : ""}">${fmtNum(c.value)}</td>`;
          })
          .join("");
        return `<tr class="sig-loc-row ${sel ? "selected" : ""}" data-ore="${esc(r.oreKey)}">
          <th class="sig-loc-mineral-cell" scope="row">
            <div class="sig-loc-mineral-inner">
              ${rarityDotHtml(r.oreKey)}
              <span class="sig-loc-mineral-name">${esc(r.oreName)}</span>
              ${r.multiRow ? `<span class="sig-loc-mineral-context">${esc(r.contextLabel)}</span>` : ""}
              ${this.favStarHtml(r.oreKey)}
            </div>
          </th>
          ${cellsHtml}
        </tr>`;
      })
      .join("");

    el.innerHTML = `
      <div class="sig-loc-guide-head">
        <h3>${esc(locName)}</h3>
        <span class="hint">${ores.length} mineral${ores.length === 1 ? "" : "es"} · ${rows.length} fila${rows.length === 1 ? "" : "s"} de valores base, de mayor a menor</span>
      </div>
      <div class="sig-loc-matrix-wrap">
        <table class="sig-loc-matrix">
          <thead><tr><th class="sig-loc-mineral-h" scope="col">Mineral</th>${headCells}</tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>`;

    this.attachFavStarListeners(el);
    el.querySelectorAll(".sig-loc-row").forEach((tr) =>
      tr.addEventListener("click", () => {
        this.toggleSelect(tr.dataset.ore);
        this.renderLocGuide();
      })
    );
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
    this.renderDetail();
    this.renderLocGuide();
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
      return `<div class="side-item ${this.selected.has(key) ? "active" : ""}" data-ore="${esc(key)}">
        ${this.favStarHtml(key)}
        <span class="side-item-name">${rarityDotHtml(key)}${esc(ore.display_name)}</span>
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
      el.addEventListener("click", () => this.toggleSelect(el.dataset.ore))
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

  /* ---------- Selección múltiple ---------- */

  toggleSelect(oreKey) {
    if (this.selected.has(oreKey)) {
      this.selected.delete(oreKey);
    } else {
      this.selected.add(oreKey);
    }
    this.renderList(document.getElementById("sig-search").value.trim().toLowerCase());
    this.renderReverse(document.getElementById("sig-reverse-input").value);
    this.renderDetail();
    this.updateClearButton();
  },

  clearSelection() {
    if (!this.selected.size) return;
    this.selected.clear();
    this.renderList(document.getElementById("sig-search").value.trim().toLowerCase());
    this.renderReverse(document.getElementById("sig-reverse-input").value);
    this.renderDetail();
    this.updateClearButton();
  },

  updateClearButton() {
    const btn = document.getElementById("sig-clear-selection");
    if (!btn) return;
    const n = this.selected.size;
    btn.hidden = n === 0;
    btn.textContent = n > 1 ? `Limpiar selección (${n})` : "Limpiar selección";
  },

  // Tarjetas de múltiplos (×1..15) de un grupo de señales (mismo valor
  // base). Dos niveles: ×1..5 grandes, ×6..15 compactos debajo — misma
  // información, jerarquía visual clara de un vistazo. Extraído para
  // poder repetirse una vez por mineral cuando hay varios seleccionados.
  blocksHtml(groups) {
    return groups
      .map((g) => {
        const mainTier = [...g.tiers][0];
        const tierLabel = [...g.tiers].join(" / ");
        const contextLabel = [...g.contexts].map((c) => SIGNAL_CONTEXT_ES[c] || c).join(" · ");

        const MAIN_MULTIPLIERS = 5;
        const cardHtml = (m) => `<div class="mult-card">
              <div class="mult-label">×${m}</div>
              <div class="mult-value">${fmtNum(g.value * m)}</div>
            </div>`;

        const mainCards = Array.from({ length: MAIN_MULTIPLIERS }, (_, i) => i + 1)
          .map(cardHtml)
          .join("");
        const restCards = Array.from(
          { length: SIGNAL_MULTIPLIERS - MAIN_MULTIPLIERS },
          (_, i) => i + MAIN_MULTIPLIERS + 1
        )
          .map(cardHtml)
          .join("");

        return `
          <div class="signal-block">
            <div class="signal-block-head">
              <span class="pill tier-${esc(mainTier)}">${esc(tierLabel)}</span>
              <span class="hint">${esc(contextLabel)}</span>
              <span class="signal-base">Base: <b>${fmtNum(g.value)}</b></span>
            </div>
            <div class="mult-grid mult-grid-main">${mainCards}</div>
            <div class="mult-sep"><span>×${MAIN_MULTIPLIERS + 1} – ×${SIGNAL_MULTIPLIERS}</span></div>
            <div class="mult-grid mult-grid-rest">${restCards}</div>
          </div>`;
      })
      .join("");
  },

  // Ficha completa de un mineral (cabecero + bloques de múltiplos). En
  // modo `multi` añade un botón para quitarlo de la selección — en modo
  // simple la ficha queda igual que antes de tener multiselección.
  renderOreSection(oreKey, ore, multi) {
    const sigs = DATA.oreToSignals[oreKey] || [];
    const groups = this.groupSignals(sigs);
    const removeBtn = multi
      ? `<button type="button" class="btn small danger sig-remove-btn" data-ore="${esc(oreKey)}" title="Quitar de la selección">Quitar</button>`
      : "";

    return `
      <div class="sig-mineral-section ${multi ? "sig-mineral-section-multi" : ""}">
        <div class="detail-head-row">
          <h3>${esc(ore.display_name)}</h3>
          ${rarityBadgeHtml(oreKey)}
          ${this.favStarHtml(oreKey, "fav-star-lg")}
          ${removeBtn}
        </div>
        <p class="subtitle">Señal de escáner · ${groups.length} valor${groups.length === 1 ? "" : "es"} distinto${groups.length === 1 ? "" : "s"}</p>
        ${this.blocksHtml(groups)}
      </div>`;
  },

  renderDetail() {
    const el = document.getElementById("sig-detail");
    const entries = [...this.selected]
      .filter((key) => DATA.ores[key] && (DATA.oreToSignals[key] || []).length)
      .map((key) => ({ key, ore: DATA.ores[key] }))
      .sort((a, b) => a.ore.display_name.localeCompare(b.ore.display_name));

    if (!entries.length) {
      el.innerHTML = '<p class="placeholder">Selecciona uno o varios minerales con señales de escáner.</p>';
      return;
    }

    if (entries.length === 1) {
      el.innerHTML = this.renderOreSection(entries[0].key, entries[0].ore, false);
    } else {
      const head = `<div class="sig-multi-hint">${entries.length} minerales seleccionados — comparando sus múltiplos</div>`;
      el.innerHTML = head + entries.map(({ key, ore }) => this.renderOreSection(key, ore, true)).join("");
    }

    this.attachFavStarListeners(el);
    el.querySelectorAll(".sig-remove-btn").forEach((btn) =>
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.toggleSelect(btn.dataset.ore);
      })
    );
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
      this.renderLocGuide();
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
        const sel = this.selected.has(it.oreKey);
        const tierLabel = it.tiers.join(" / ");
        const contextLabel = it.contexts.map((c) => SIGNAL_CONTEXT_ES[c] || c).join(" · ");
        const devLabel = exactMode
          ? ""
          : ` <span class="sig-hit-dev">(${it.diff > 0 ? "+" : ""}${fmtNum(it.diff)})</span>`;

        return `<div class="sig-hit ${fav ? "favorite" : ""} ${sel ? "selected" : ""}" data-ore="${esc(it.oreKey)}">
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
      el.addEventListener("click", () => this.toggleSelect(el.dataset.ore))
    );
    this.attachFavStarListeners(container);
    this.renderLocGuide();
  },
};
