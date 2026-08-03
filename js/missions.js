/* Pestaña «Misiones»: catálogo de contratos de scmdb.net (data/missions.json,
   ver DATA.missionsList()/missionById() en js/data.js) con filtros por
   categoría, sistema, tipo de misión, facción, legalidad, si es compartible,
   si es única o repetible, si reparte algún plano de crafteo y rango de
   recompensa en UEC — réplica funcional de los filtros de scmdb.net, sin sus
   estadísticas comunitarias (no hay esa fuente aquí). Lista ordenable
   (recompensa/título/facción), criterio persistido en localStorage igual que
   el resto de vistas (mineriasc_missions_sort).

   También expone Missions.show(id): único punto de entrada público para
   saltar aquí desde otra pestaña (hoy solo Crafteo, ver js/crafting.js) —
   limpia los filtros (para garantizar que la misión de destino sea visible
   en la lista), activa esta pestaña con activateTab() (js/app.js) y abre su
   ficha.

   Carga este archivo ANTES que js/crafting.js (ver index.html): el modo
   "Objetos" de Crafteo reutiliza el vocabulario gear/type/subtype del
   catálogo de productos de scmdb.net (DATA.missionProducts(), la MISMA
   fuente que esta vista) y las traducciones de abajo, para no duplicar el
   diccionario en dos archivos. */

// Taxonomía de equipo/objeto de scmdb.net (DATA.missionProducts() y
// blueprintRewards[] de cada misión): gear (contenedor) / type (categoría) /
// subtype (variante). Compartida con el modo "Objetos" de Crafteo — ver
// comentario de cabecera de arriba.
const MISSION_GEAR_ES = {
  fpsgear: "Equipo FPS",
  vehiclegear: "Equipo de nave",
  missionitems: "Objeto de misión",
};
const MISSION_TYPE_TAX_ES = {
  armour: "Armadura",
  weapons: "Armas",
  ammo: "Munición",
  cooler: "Refrigeración",
  powerplant: "Planta de energía",
  shield: "Escudos",
  radar: "Radar",
  quantumdrive: "Motor cuántico",
  mininglaser: "Láser de minería",
  tractorbeam: "Rayo tractor",
  refuelling: "Repostaje",
  salvage: "Reciclaje",
};
const MISSION_SUBTYPE_ES = {
  combat: "Combate", engineer: "Ingeniero", hunter: "Cazador", stealth: "Sigilo",
  miner: "Minero", undersuit: "Ropa interior", flightsuit: "Traje de vuelo",
  explorer: "Explorador", environment: "Ambiental", cosmonaut: "Cosmonauta",
  medic: "Médico", salvager: "Reciclaje", radiation: "Antirradiación", racer: "Piloto de carreras",
  pistol: "Pistola", rifle: "Rifle", sniper: "Francotirador", smg: "SMG", shotgun: "Escopeta", lmg: "LMG",
  ballistic: "Balística", plasma: "Plasma", distortion: "Distorsión", laser: "Láser", electron: "Electrón",
  size0: "Tamaño 0", size1: "Tamaño 1", size2: "Tamaño 2", size3: "Tamaño 3", size4: "Tamaño 4",
  small: "Pequeño", medium: "Mediano", large: "Grande", nozzle: "Tobera",
};

function missionGearLabel(g) { return MISSION_GEAR_ES[g] || g || "—"; }
function missionTypeLabel(t) { return MISSION_TYPE_TAX_ES[t] || t || "—"; }
function missionSubtypeLabel(s) { return MISSION_SUBTYPE_ES[s] || s || "—"; }

// Categoría de misión (m.category: career/event/story — 3 valores reales en
// el parche actual, ver comentario de datos-juego.md).
const MISSION_CATEGORY_ES = { career: "Carrera", event: "Evento", story: "Historia" };

// Tipo de misión (m.missionType — 23 valores reales en el parche actual,
// verificado contra data/missions.json completo).
const MISSION_TYPE_ES = {
  Delivery: "Entrega", Courier: "Mensajería", Collection: "Recolección",
  Hauling: "Transporte", "Hauling - Interstellar": "Transporte interestelar",
  "Hauling - Local": "Transporte local", "Hauling - Planetary": "Transporte planetario",
  "Hauling - Stellar": "Transporte estelar", Investigation: "Investigación",
  Maintenance: "Mantenimiento", Mercenary: "Mercenario", Priority: "Prioritaria",
  "PvP Missions": "PvP", Refueling: "Repostaje", Salvage: "Reciclaje",
  "Ship Mining": "Minería (nave)", "Ground Vehicle Mining": "Minería (ROC)",
  "Hand Mining": "Minería manual", "Bounty Hunter": "Caza de recompensas",
  Battaglia: "Battaglia", "Wikelo - Other Items": "Wikelo (objetos)",
  "Wikelo - Vehicles": "Wikelo (vehículos)", local: "Local",
};

// trigger de blueprintRewards[]: en qué momento de la misión se decide/entrega
// la recompensa de plano.
const MISSION_TRIGGER_ES = { complete: "Al completar", accept: "Al aceptar" };

const MISSION_SORT_LABELS = { reward: "Recompensa (UEC)", title: "Título (A-Z)", faction: "Facción (A-Z)" };

const Missions = {
  selectedId: null,
  search: "", // texto en minúsculas
  category: "todas",
  system: "todos",
  missionType: "todos",
  faction: "todas",
  legal: "todas", // todas | legal | ilegal
  shareable: "todas", // todas | si | no
  availability: "todas", // todas | unica | repetible
  onlyBlueprint: false,
  rewardMin: null,
  rewardMax: null,
  sortBy: "reward",
  SORT_KEY: "mineriasc_missions_sort",

  init() {
    if (!DATA.missions.ready) {
      this.renderUnavailable();
      return;
    }

    this.sortBy = this.loadSort();
    const sortSel = document.getElementById("mission-sort");
    sortSel.value = this.sortBy;
    sortSel.addEventListener("change", () => {
      this.sortBy = sortSel.value;
      this.saveSort();
      this.renderList();
    });

    document.getElementById("mission-search").addEventListener("input", (e) => {
      this.search = e.target.value.trim().toLowerCase();
      this.renderList();
    });

    this.renderCategoryFilter();
    this.renderSystemFilter();
    this.renderTypeFilter();
    this.renderFactionFilter();
    this.renderLegalFilter();
    this.renderShareableFilter();
    this.renderAvailabilityFilter();

    document.getElementById("mission-blueprint-only").addEventListener("change", (e) => {
      this.onlyBlueprint = e.target.checked;
      e.target.closest(".inv-cat-check")?.classList.toggle("checked", e.target.checked);
      this.renderList();
    });
    document.getElementById("mission-reward-min").addEventListener("input", (e) => {
      this.rewardMin = e.target.value === "" ? null : Number(e.target.value);
      this.renderList();
    });
    document.getElementById("mission-reward-max").addEventListener("input", (e) => {
      this.rewardMax = e.target.value === "" ? null : Number(e.target.value);
      this.renderList();
    });
    document.getElementById("mission-filters-clear").addEventListener("click", () => this.clearFilters());

    this.renderList();
  },

  loadSort() {
    try {
      const v = localStorage.getItem(this.SORT_KEY);
      return v && MISSION_SORT_LABELS[v] ? v : "reward";
    } catch (_) {
      return "reward";
    }
  },

  saveSort() {
    try {
      localStorage.setItem(this.SORT_KEY, this.sortBy);
    } catch (_) {
      // sin localStorage disponible: el criterio sigue activo esta sesión
    }
  },

  // Fila de botones tipo "chip" reutilizable para los 5 filtros de opción
  // única de esta vista (categoría, sistema, legalidad, compartible,
  // disponibilidad) — mismo patrón que #system-filter de Ubicaciones.
  renderButtonFilter(elId, options, currentValue, onPick) {
    const box = document.getElementById(elId);
    box.innerHTML = options
      .map(
        (o) =>
          `<button type="button" class="btn small ${o.value === currentValue ? "active" : ""}" data-value="${esc(o.value)}">${esc(o.label)}</button>`
      )
      .join("");
    box.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => onPick(b.dataset.value)));
  },

  renderCategoryFilter() {
    const cats = [...new Set(DATA.missionsList().map((m) => m.category).filter(Boolean))].sort();
    const options = [
      { value: "todas", label: "Todas" },
      ...cats.map((c) => ({ value: c, label: MISSION_CATEGORY_ES[c] || c })),
    ];
    this.renderButtonFilter("mission-category-filter", options, this.category, (v) => {
      this.category = v;
      this.renderCategoryFilter();
      this.renderList();
    });
  },

  renderSystemFilter() {
    const systems = [...new Set(DATA.missionsList().flatMap((m) => m.systems || []))].sort();
    const options = [{ value: "todos", label: "Todos" }, ...systems.map((s) => ({ value: s, label: s }))];
    this.renderButtonFilter("mission-system-filter", options, this.system, (v) => {
      this.system = v;
      this.renderSystemFilter();
      this.renderList();
    });
  },

  renderLegalFilter() {
    const options = [
      { value: "todas", label: "Todas" },
      { value: "legal", label: "Legal" },
      { value: "ilegal", label: "Ilegal" },
    ];
    this.renderButtonFilter("mission-legal-filter", options, this.legal, (v) => {
      this.legal = v;
      this.renderLegalFilter();
      this.renderList();
    });
  },

  renderShareableFilter() {
    const options = [
      { value: "todas", label: "Todas" },
      { value: "si", label: "Compartible" },
      { value: "no", label: "En solitario" },
    ];
    this.renderButtonFilter("mission-shareable-filter", options, this.shareable, (v) => {
      this.shareable = v;
      this.renderShareableFilter();
      this.renderList();
    });
  },

  renderAvailabilityFilter() {
    const options = [
      { value: "todas", label: "Todas" },
      { value: "unica", label: "Única" },
      { value: "repetible", label: "Repetible" },
    ];
    this.renderButtonFilter("mission-availability-filter", options, this.availability, (v) => {
      this.availability = v;
      this.renderAvailabilityFilter();
      this.renderList();
    });
  },

  // Tipo de misión y facción van en <select> (23 y 24 valores reales — una
  // fila de chips sería demasiado ancha, ver el resto de filtros de arriba
  // que sí caben como chips). Opciones construidas una sola vez en init():
  // el catálogo no cambia durante la sesión.
  renderTypeFilter() {
    const sel = document.getElementById("mission-type-filter");
    const types = [...new Set(DATA.missionsList().map((m) => m.missionType).filter(Boolean))].sort((a, b) =>
      (MISSION_TYPE_ES[a] || a).localeCompare(MISSION_TYPE_ES[b] || b, "es")
    );
    sel.innerHTML =
      '<option value="todos">Todos los tipos</option>' +
      types.map((t) => `<option value="${esc(t)}">${esc(MISSION_TYPE_ES[t] || t)}</option>`).join("");
    sel.value = this.missionType;
    sel.addEventListener("change", () => {
      this.missionType = sel.value;
      this.renderList();
    });
  },

  renderFactionFilter() {
    const sel = document.getElementById("mission-faction-filter");
    const factions = [...new Set(DATA.missionsList().map((m) => m.faction).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, "es")
    );
    sel.innerHTML =
      '<option value="todas">Todas las facciones</option>' +
      factions.map((f) => `<option value="${esc(f)}">${esc(f)}</option>`).join("");
    sel.value = this.faction;
    sel.addEventListener("change", () => {
      this.faction = sel.value;
      this.renderList();
    });
  },

  clearFilters() {
    this.search = "";
    this.category = "todas";
    this.system = "todos";
    this.missionType = "todos";
    this.faction = "todas";
    this.legal = "todas";
    this.shareable = "todas";
    this.availability = "todas";
    this.onlyBlueprint = false;
    this.rewardMin = null;
    this.rewardMax = null;

    document.getElementById("mission-search").value = "";
    document.getElementById("mission-type-filter").value = "todos";
    document.getElementById("mission-faction-filter").value = "todas";
    const blueprintCheck = document.getElementById("mission-blueprint-only");
    blueprintCheck.checked = false;
    blueprintCheck.closest(".inv-cat-check")?.classList.remove("checked");
    document.getElementById("mission-reward-min").value = "";
    document.getElementById("mission-reward-max").value = "";

    this.renderCategoryFilter();
    this.renderSystemFilter();
    this.renderLegalFilter();
    this.renderShareableFilter();
    this.renderAvailabilityFilter();
    this.renderList();
  },

  matches(m) {
    if (this.search) {
      const hay = `${m.title} ${m.description} ${m.faction || ""} ${m.missionType || ""}`.toLowerCase();
      if (!hay.includes(this.search)) return false;
    }
    if (this.category !== "todas" && m.category !== this.category) return false;
    if (this.system !== "todos" && !(m.systems || []).includes(this.system)) return false;
    if (this.missionType !== "todos" && m.missionType !== this.missionType) return false;
    if (this.faction !== "todas" && m.faction !== this.faction) return false;
    if (this.legal === "legal" && m.illegal) return false;
    if (this.legal === "ilegal" && !m.illegal) return false;
    if (this.shareable === "si" && !m.canBeShared) return false;
    if (this.shareable === "no" && m.canBeShared) return false;
    if (this.availability === "unica" && !m.onceOnly) return false;
    if (this.availability === "repetible" && m.onceOnly) return false;
    if (this.onlyBlueprint && !(m.blueprintRewards && m.blueprintRewards.length)) return false;
    // Rango de recompensa: una misión sin rewardUEC conocido no puede
    // verificarse contra el rango, así que queda fuera en cuanto el usuario
    // fija un mínimo o un máximo (no se asume 0 ni "cumple por defecto").
    if (this.rewardMin != null && !(m.rewardUEC != null && m.rewardUEC >= this.rewardMin)) return false;
    if (this.rewardMax != null && !(m.rewardUEC != null && m.rewardUEC <= this.rewardMax)) return false;
    return true;
  },

  sortedFiltered() {
    const filtered = DATA.missionsList().filter((m) => this.matches(m));
    if (this.sortBy === "title") {
      filtered.sort((a, b) => a.title.localeCompare(b.title, "es"));
    } else if (this.sortBy === "faction") {
      filtered.sort((a, b) => (a.faction || "").localeCompare(b.faction || "", "es") || a.title.localeCompare(b.title, "es"));
    } else {
      // "reward": descendente por defecto, sin recompensa conocida al final.
      filtered.sort((a, b) => (b.rewardUEC ?? -1) - (a.rewardUEC ?? -1) || a.title.localeCompare(b.title, "es"));
    }
    return filtered;
  },

  renderList() {
    const listEl = document.getElementById("mission-list");
    const countHint = document.getElementById("mission-count-hint");
    const all = DATA.missionsList();
    const filtered = this.sortedFiltered();
    countHint.textContent = `${filtered.length} de ${all.length} misiones`;

    if (!filtered.length) {
      listEl.innerHTML = '<p class="placeholder">Ninguna misión coincide con los filtros.</p>';
      return;
    }

    listEl.innerHTML = filtered
      .map(
        (m) => `<div class="side-item ${m.id === this.selectedId ? "active" : ""}" data-id="${m.id}">
          <span class="side-item-name">${esc(m.title || "(sin título)")}<br>
            <span class="sub">${esc(m.faction || "Sin facción")} · ${esc((m.systems || []).join(", ") || "—")}</span>
          </span>
          <span class="sub mission-side-reward">${m.rewardUEC != null ? fmtNum(m.rewardUEC) + " UEC" : "—"}</span>
        </div>`
      )
      .join("");

    listEl.querySelectorAll(".side-item").forEach((el) =>
      el.addEventListener("click", () => this.select(Number(el.dataset.id)))
    );
  },

  select(id) {
    this.selectedId = id;
    this.renderList();
    this.renderDetail();
  },

  renderDetail() {
    const el = document.getElementById("mission-detail");
    const m = DATA.missionById(this.selectedId);
    if (!m) {
      el.innerHTML = '<p class="placeholder">Selecciona una misión para ver su ficha completa.</p>';
      return;
    }

    const catTxt = MISSION_CATEGORY_ES[m.category] || m.category || "—";
    const typeTxt = MISSION_TYPE_ES[m.missionType] || m.missionType || "—";
    const repTxt = m.repMin
      ? `${esc(m.repMin.name)} (${fmtNum(m.repMin.minReputation)})` +
        (m.repMax ? ` → ${esc(m.repMax.name)} (${fmtNum(m.repMax.minReputation)})` : "")
      : "Sin requisito de reputación";
    const prereqTxt = (m.prerequisiteLocations || []).length
      ? m.prerequisiteLocations.map((p) => esc(p.name)).join(", ")
      : "Ninguno";
    const cooldownTxt = m.cooldownMinutes != null ? `${fmtNum(m.cooldownMinutes)} min` : "Sin cooldown";
    const buyInTxt = m.buyIn != null ? `${fmtNum(m.buyIn)} UEC` : "Sin coste de entrada";
    const rewardTxt = m.rewardUEC != null ? `${fmtNum(m.rewardUEC)} UEC` : "—";

    const rewards = [...(m.blueprintRewards || [])].sort((a, b) => b.chance - a.chance);
    const rewardRows = rewards
      .map((r) => {
        const catParts = [missionGearLabel(r.gear)];
        if (r.type) catParts.push(missionTypeLabel(r.type));
        if (r.subtype) catParts.push(missionSubtypeLabel(r.subtype));
        return `<tr>
          <td>${esc(r.productName || r.tag)}</td>
          <td>${esc(catParts.join(" · "))}</td>
          <td class="num">${fmtNum(r.chance * 100, 1)}%</td>
          <td>${esc(MISSION_TRIGGER_ES[r.trigger] || r.trigger || "—")}</td>
        </tr>`;
      })
      .join("");

    el.innerHTML = `
      <div class="detail-head-row">
        <h3>${esc(m.title || "(sin título)")}</h3>
        <span class="pill ${m.illegal ? "legal-bad" : "legal-ok"}">${m.illegal ? "Ilegal" : "Legal"}</span>
        <span class="pill">${m.onceOnly ? "Única" : "Repetible"}</span>
        ${m.canBeShared ? '<span class="pill">Compartible</span>' : ""}
      </div>
      <p class="subtitle">${esc(catTxt)} · ${esc(typeTxt)} · ${esc(m.faction || "Sin facción")} · ${esc((m.systems || []).join(", ") || "—")}</p>

      <p>${m.description ? esc(m.description) : '<span class="hint">Sin descripción registrada.</span>'}</p>

      <div class="stat-grid">
        <div class="stat"><div class="label">Recompensa</div><div class="value accent">${esc(rewardTxt)}</div></div>
        <div class="stat"><div class="label">Coste de entrada</div><div class="value">${esc(buyInTxt)}</div></div>
        <div class="stat"><div class="label">Cooldown</div><div class="value">${esc(cooldownTxt)}</div></div>
      </div>

      <h4>Reputación requerida</h4>
      <p>${repTxt}</p>

      <h4>Prerrequisitos de ubicación</h4>
      <p>${esc(prereqTxt)}</p>

      <h4>Recompensas de plano de crafteo (${rewards.length})</h4>
      ${
        rewards.length
          ? `<div class="table-wrap"><table>
              <thead><tr><th>Objeto</th><th>Categoría</th><th>Probabilidad</th><th>Se activa</th></tr></thead>
              <tbody>${rewardRows}</tbody></table></div>`
          : '<span class="hint">Esta misión no reparte ningún plano de crafteo.</span>'
      }
    `;
  },

  // Único punto de entrada público para saltar aquí desde otra pestaña (ver
  // comentario de cabecera). Limpia filtros primero: sin esto, una búsqueda o
  // filtro activo en Misiones podría dejar la misión de destino fuera de la
  // lista visible aunque su ficha sí se abra — confuso ("¿por qué no la veo
  // en la lista si la acabo de abrir?"). Vuelve a esta pestaña siempre al
  // principio de la página, útil si se llega con scroll ya bajado.
  show(id) {
    if (!DATA.missions.ready) {
      activateTab("misiones");
      return;
    }
    this.clearFilters();
    activateTab("misiones");
    this.select(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  },

  // Degradación cuando data/missions.json no cargó (falta o está corrupto):
  // DATA.missions.ready queda en false pero el resto de la app sigue
  // funcionando (mismo patrón que Crafting.renderUnavailable en js/crafting.js).
  renderUnavailable() {
    document.getElementById("mission-search").disabled = true;
    document.getElementById("mission-sort").disabled = true;
    document.getElementById("mission-filters").hidden = true;
    document.getElementById("mission-count-hint").textContent = "";
    document.getElementById("mission-list").innerHTML = "";
    document.getElementById("mission-detail").innerHTML =
      '<p class="placeholder">No se pudo cargar el catálogo de misiones ' +
      "(data/missions.json). El resto de la app sigue funcionando con normalidad.</p>";
  },
};
