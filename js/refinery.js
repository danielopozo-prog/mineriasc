/* Pestaña «Refinería»: métodos de refinado (API UEX en vivo) y tabla de
   bonos de rendimiento por estación (datos base Strata/UEX). */

const Refinery = {
  rendered: false,

  async render() {
    if (this.rendered) return;
    this.rendered = true;
    this.renderMethods();
    this.renderYields();
  },

  async renderMethods() {
    const box = document.getElementById("refinery-methods");
    box.innerHTML = '<p class="loading">Cargando métodos de refinado…</p>';
    try {
      const methods = await UEX.refineryMethods();
      const stars = (n) => {
        n = n || 0;
        let out = "";
        for (let i = 1; i <= 3; i++) {
          out +=
            i <= n
              ? '<span class="star star-on">★</span>'
              : '<span class="star star-off">☆</span>';
        }
        return out;
      };
      box.innerHTML = methods
        .map(
          (m) => `<div class="card">
            <h5>${esc(m.name)}</h5>
            <div class="row"><span>Rendimiento</span><b class="stars" title="${m.rating_yield}/3">${stars(m.rating_yield)}</b></div>
            <div class="row"><span>Coste</span><b class="stars" title="${m.rating_cost}/3">${stars(m.rating_cost)}</b></div>
            <div class="row"><span>Velocidad</span><b class="stars" title="${m.rating_speed}/3">${stars(m.rating_speed)}</b></div>
          </div>`
        )
        .join("");
    } catch (err) {
      box.innerHTML = `<p class="error-msg">No se pudieron cargar los métodos desde UEX (${esc(err.message)}).</p>`;
    }
  },

  renderYields() {
    const table = document.getElementById("refinery-table");
    const stations = Object.entries(DATA.refineries);
    if (!stations.length) {
      table.innerHTML = "<tr><td>Sin datos de refinerías.</td></tr>";
      return;
    }

    // Columnas: minerales que aparecen en algún rendimiento, ordenados por nombre
    const oreKeys = [
      ...new Set(stations.flatMap(([, s]) => Object.keys(s.yields || {}))),
    ].sort((a, b) =>
      (DATA.ores[a]?.display_name || a).localeCompare(DATA.ores[b]?.display_name || b)
    );

    const head =
      "<tr><th>Estación</th><th>Sistema</th>" +
      oreKeys.map((k) => `<th>${esc(DATA.ores[k]?.display_name || k)}</th>`).join("") +
      "</tr>";

    const rows = stations
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, s]) => {
        const cells = oreKeys
          .map((k) => {
            const y = s.yields?.[k];
            if (!y) return '<td class="num">—</td>';
            const cls = y.value > 0 ? "good" : y.value < 0 ? "bad" : "";
            return `<td class="num ${cls}">${y.value > 0 ? "+" : ""}${fmtNum(y.value)}%</td>`;
          })
          .join("");
        return `<tr><td>${esc(name)}</td><td>${esc(s.system)}</td>${cells}</tr>`;
      })
      .join("");

    table.innerHTML = `<thead>${head}</thead><tbody>${rows}</tbody>`;
  },
};
