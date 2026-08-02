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

// Método de minado por ubicación (claves de DATA.locationOres[locKey].ores:
// fps/vehicle/ship — comprobado, ningún mineral aparece bajo dos métodos
// distintos en la misma ubicación en el parche actual, así que 1 fila =
// 1 método sin ambigüedad). Distinto de SIGNAL_CONTEXT_ES: aquello es el
// contexto que hace sonar el escáner (asteroid/surface/fps/vehicle);
// esto es cómo se extrae el depósito en ESTA ubicación concreta. Reusa
// METHOD_ES (data.js) para el texto largo (tabla de Ubicaciones/Buscador);
// aquí, en la columna fija de la matriz, una versión corta para no inflar
// el ancho de la columna sticky.
const LOC_METHOD_SHORT_ES = {
  fps: "A pie",
  vehicle: "ROC",
  ship: "Nave",
};
const LOC_METHOD_ORDER = ["fps", "vehicle", "ship"];

const SIGNAL_MULTIPLIERS = 15;
const FAVORITES_KEY = "mineriasc_favorites";

const Signals = {
  selected: new Set(),
  favorites: [],
  // locKey de la ubicación activa en el modo "por ubicación", o null si el
  // modo no está activo (vista normal por mineral).
  activeLocKey: null,
  // Métodos activos del filtro "por ubicación" (fps/vehicle/ship). Vacío =
  // sin filtrar, se muestran todas las filas — se reinicia al cambiar de
  // ubicación (selectLocation/clearLocation).
  locMethodFilter: new Set(),

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

    // Combo con buscador: decenas de ubicaciones de minado agrupadas por
    // sistema (ver js/searchselect.js). sel sigue siendo la fuente de
    // verdad — clearLocation() de abajo llama a .sync() porque asignar
    // sel.value directamente no dispara "change".
    SearchSelect.enhance(sel, { placeholder: "Buscar ubicación…" });
  },

  // Minerales presentes en una ubicación, con su método de minado (fps/
  // vehicle/ship — ver LOC_METHOD_SHORT_ES arriba), limitados a los que
  // tienen ficha en DATA.ores (descarta los UNKNOWN_* sin identificar
  // todavía) y al menos una señal de escáner conocida (si no, no hay nada
  // que mostrar de él).
  oresAtLocation(locKey) {
    const loc = DATA.locationOres[locKey];
    if (!loc) return [];
    const methodByOre = new Map();
    for (const [method, list] of Object.entries(loc.ores || {})) {
      for (const e of list) methodByOre.set(e.ore, method);
    }
    return [...methodByOre.keys()]
      .filter((k) => DATA.ores[k] && (DATA.oreToSignals[k] || []).length)
      .map((k) => ({ key: k, ore: DATA.ores[k], method: methodByOre.get(k) }))
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
    for (const { key, ore, method } of ores) {
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
          method,
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
    this.locMethodFilter = new Set();
    document.getElementById("sig-split").hidden = !!this.activeLocKey;
    document.getElementById("sig-loc-back").hidden = !this.activeLocKey;
    this.renderLocGuide();
  },

  clearLocation() {
    const sel = document.getElementById("sig-loc-select");
    sel.value = "";
    sel._sselApi?.sync(); // asignar .value no dispara "change": refresca la etiqueta del combo
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
    const { ores, rows: allRows } = this.locGuideRows(this.activeLocKey);

    if (!ores.length) {
      el.innerHTML = `<p class="placeholder">${esc(locName)} no tiene minerales con señal de escáner registrada.</p>`;
      return;
    }

    // Métodos presentes en esta ubicación, en orden fijo (a pie -> ROC ->
    // nave). Los chips de filtro solo se muestran si hay más de uno: si
    // toda la ubicación se mina igual (p. ej. un cinturón solo minable en
    // nave) filtrar no aporta nada, y el badge de cada fila ya lo deja claro.
    const methodsPresent = LOC_METHOD_ORDER.filter((m) => ores.some((o) => o.method === m));
    const rows = this.locMethodFilter.size
      ? allRows.filter((r) => this.locMethodFilter.has(r.method))
      : allRows;

    const target = this.parseReverseInput(document.getElementById("sig-reverse-input").value);

    const headCells = Array.from({ length: SIGNAL_MULTIPLIERS }, (_, i) => SIGNAL_MULTIPLIERS - i)
      .map((m) => `<th>×${m}</th>`)
      .join("");

    const filtersHtml =
      methodsPresent.length > 1
        ? `<div class="sig-loc-method-filters">
            <span class="hint">Método de minado:</span>
            ${methodsPresent
              .map((m) => {
                const active = this.locMethodFilter.has(m);
                return `<button type="button" class="sig-loc-method-filter method-${esc(m)} ${active ? "active" : ""}" data-method="${esc(m)}">${esc(LOC_METHOD_SHORT_ES[m] || m)}</button>`;
              })
              .join("")}
          </div>`
        : "";

    const rowsHtml = rows
      .map((r) => {
        const sel = this.selected.has(r.oreKey);
        const cellsHtml = r.cells
          .map((c) => {
            const match = target != null && c.value === target;
            return `<td class="sig-loc-cell ${match ? "match" : ""}">${fmtNum(c.value)}</td>`;
          })
          .join("");
        const methodBadge = `<span class="sig-loc-method-badge method-${esc(r.method)}" title="Método de minado: ${esc(LOC_METHOD_SHORT_ES[r.method] || r.method)}">${esc(LOC_METHOD_SHORT_ES[r.method] || r.method)}</span>`;
        return `<tr class="sig-loc-row ${sel ? "selected" : ""}" data-ore="${esc(r.oreKey)}">
          <th class="sig-loc-mineral-cell" scope="row">
            <div class="sig-loc-mineral-inner">
              ${rarityDotHtml(r.oreKey)}
              <span class="sig-loc-mineral-name">${esc(r.oreName)}</span>
              ${methodBadge}
              ${r.multiRow ? `<span class="sig-loc-mineral-context">${esc(r.contextLabel)}</span>` : ""}
              ${this.favStarHtml(r.oreKey)}
            </div>
          </th>
          ${cellsHtml}
        </tr>`;
      })
      .join("");

    const bodyHtml = rows.length
      ? rowsHtml
      : `<tr><td class="placeholder" colspan="${SIGNAL_MULTIPLIERS + 1}">Ningún mineral coincide con el método elegido.</td></tr>`;

    el.innerHTML = `
      <div class="sig-loc-guide-head">
        <h3>${esc(locName)}</h3>
        <span class="hint">${ores.length} mineral${ores.length === 1 ? "" : "es"} · ${rows.length} fila${rows.length === 1 ? "" : "s"} de valores base, de mayor a menor</span>
      </div>
      ${filtersHtml}
      <div class="sig-loc-matrix-wrap">
        <table class="sig-loc-matrix">
          <thead><tr><th class="sig-loc-mineral-h" scope="col">Mineral</th>${headCells}</tr></thead>
          <tbody>${bodyHtml}</tbody>
        </table>
      </div>`;

    this.attachFavStarListeners(el);
    el.querySelectorAll(".sig-loc-row").forEach((tr) =>
      tr.addEventListener("click", () => {
        this.toggleSelect(tr.dataset.ore);
        this.renderLocGuide();
      })
    );
    el.querySelectorAll(".sig-loc-method-filter").forEach((btn) =>
      btn.addEventListener("click", () => {
        const m = btn.dataset.method;
        if (this.locMethodFilter.has(m)) this.locMethodFilter.delete(m);
        else this.locMethodFilter.add(m);
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

  // Metadatos de un grupo de señales (tier + contexto + valor base), en
  // HTML listo para insertar tanto en la cabecera del mineral (grupo único,
  // caso habitual) como en la cabecera de un bloque suelto (varios grupos,
  // ver blocksHtml). La pill de tier de señal duplica visualmente el badge
  // de RAREZA del mineral (rarityBadgeHtml) cuando coinciden — son el mismo
  // campo de origen en mining_data.json (ver comentario junto a
  // RARITY_TIERS_VALID en data.js) — así que aquí se decide cuál mostrar:
  //   - Tier válido como rareza (common…legendary) e igual a la rareza ya
  //     mostrada junto al nombre → se omite la pill, sería la misma
  //     etiqueta dos veces en la misma fila.
  //   - Tier válido como rareza pero DISTINTO de la rareza del mineral
  //     (mineral con varios grupos de tier distinto — no observado en el
  //     patch actual, pero posible) → se mantiene, con un "Señal:" delante
  //     para dejar claro que es el tier de ESTA señal, no la rareza general.
  //   - Tier no válido como rareza (p. ej. "fps"/"vehicle": el propio
  //     mining_context filtrado en el campo tier, ver Carinite) → no se
  //     muestra como pill: ya lo dice contextLabel, repetirlo confundiría.
  groupMetaHtml(oreKey, g) {
    const tiers = [...g.tiers];
    const mainTier = tiers[0];
    const multiTier = tiers.length > 1;
    const contextLabel = [...g.contexts]
      .map((c) => SIGNAL_CONTEXT_ES[c] || c)
      .filter(Boolean)
      .join(" · ");

    let tierPill = "";
    if (multiTier) {
      tierPill = `<span class="pill tier-${esc(mainTier)}">${esc(tiers.join(" / "))}</span>`;
    } else if (RARITY_TIERS_VALID.has(mainTier)) {
      const rarity = DATA.rarityFor(oreKey);
      const dedupWithRarityBadge = rarity && rarity.tier === mainTier;
      if (!dedupWithRarityBadge) {
        tierPill = `<span class="hint">Señal:</span> <span class="pill tier-${esc(mainTier)}">${esc(RARITY_ES[mainTier] || mainTier)}</span>`;
      }
    }

    return `${tierPill}<span class="hint">${esc(contextLabel)}</span><span class="signal-base">Base: <b>${fmtNum(g.value)}</b></span>`;
  },

  // Tarjetas de múltiplos (×1..15) de un grupo de señales (mismo valor
  // base). Dos niveles: ×1..7 grandes en una fila a ancho completo, ×8..15
  // compactos debajo en otra fila también a ancho completo (7 y 8 columnas
  // respectivamente en escritorio — ver .mult-grid-main/.mult-grid-rest en
  // styles.css: ambas rejillas ocupan el 100% del contenedor así que sus
  // bordes quedan alineados sin hueco) — misma información, jerarquía
  // visual clara de un vistazo. Extraído para poder repetirse una vez por
  // mineral cuando hay varios seleccionados.
  // Dentro de cada tarjeta la etiqueta ×N ya NO va en su propia fila encima
  // del valor (eso robaba altura a la cifra, que es lo que el jugador
  // realmente necesita leer de un vistazo): va en línea, pequeña y tenue, a
  // la izquierda de la cifra — mismo lenguaje visual en las 15 tarjetas
  // (grandes y compactas), para que ambas filas se lean como un mismo
  // sistema. El valor vive en su propio `.mult-value-wrap`, que es el
  // contenedor real de la container query (ver styles.css): así su tamaño
  // fluido se calcula sobre el ancho que le queda DESPUÉS de la etiqueta,
  // no sobre el ancho completo de la tarjeta — si se calculara sobre la
  // tarjeta entera, la cifra podría desbordar el hueco que de verdad tiene.
  // `singleGroup`: cuando el mineral solo tiene un valor base (caso
  // habitual) los metadatos ya se muestran en la cabecera del mineral (ver
  // renderOreSection) y aquí se omiten para no repetirlos; con varios
  // grupos (p. ej. Carinite fps/vehicle) cada bloque conserva su propia
  // cabecera porque, si no, no se sabría a qué valor base pertenece cada
  // rejilla de tarjetas.
  blocksHtml(oreKey, groups, singleGroup) {
    return groups
      .map((g) => {
        const MAIN_MULTIPLIERS = 7;
        const cardHtml = (m) => `<div class="mult-card">
              <span class="mult-label">×${m}</span>
              <span class="mult-value-wrap"><span class="mult-value">${fmtNum(g.value * m)}</span></span>
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

        const blockHead = singleGroup
          ? ""
          : `<div class="signal-block-head">${this.groupMetaHtml(oreKey, g)}</div>`;

        return `
          <div class="signal-block">
            ${blockHead}
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

    // Con un único valor base (caso habitual) los metadatos (tier de señal /
    // contexto / base) suben a la cabecera del mineral, a la derecha del
    // nombre — con varios valores base se quedan en cada bloque (ver
    // blocksHtml) porque aquí arriba no hay sitio para mostrar dos "Base:"
    // sin confundir a cuál pertenece cada rejilla.
    const singleGroup = groups.length === 1 ? groups[0] : null;
    const headMeta = singleGroup
      ? `<div class="sig-head-meta">${this.groupMetaHtml(oreKey, singleGroup)}</div>`
      : "";

    return `
      <div class="sig-mineral-section ${multi ? "sig-mineral-section-multi" : ""}">
        <div class="detail-head-row">
          <h3>${esc(ore.display_name)}</h3>
          ${rarityBadgeHtml(oreKey)}
          ${headMeta}
          ${this.favStarHtml(oreKey, "fav-star-lg")}
          ${removeBtn}
        </div>
        <p class="subtitle">Señal de escáner · ${groups.length} valor${groups.length === 1 ? "" : "es"} distinto${groups.length === 1 ? "" : "s"}</p>
        ${this.blocksHtml(oreKey, groups, !!singleGroup)}
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
