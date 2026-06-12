// =============================================================================
//  RESSO SKIC 424 — Lógica del Dashboard
// =============================================================================
(function () {
  "use strict";

  const D = window.DASHBOARD_DATA;
  if (!D) {
    console.error("No se encontró DASHBOARD_DATA");
    return;
  }

  const $ = (sel) => document.querySelector(sel);

  function pctColor(p) {
    if (p >= 90) return "#2e8b57";
    if (p >= 70) return "#f0a500";
    return "#e1251b";
  }

  // ---- Fecha de actualización -------------------------------------------
  $("#updatedAt").textContent = "Actualizado: " + D.generatedAt;

  // ---- Información del contrato ------------------------------------------
  function renderContract() {
    const c = D.contrato;
    const items = [
      ["Empresa", c.empresa],
      ["Servicio / Contrato", c.servicio],
      ["N° Contrato", c.numero],
      ["División", c.division],
      ["Gerencia", c.gerencia],
      ["Adm. Contrato EECC", c.adminEECC],
      ["Adm. Contrato Codelco", c.adminCodelco],
      ["Fecha de revisión", c.fechaRevision],
    ];
    $("#contractPanel").innerHTML =
      '<div class="contract-grid">' +
      items
        .map(
          ([k, v]) =>
            `<div class="contract-item"><div class="ci-label">${k}</div><div class="ci-value">${v || "—"}</div></div>`
        )
        .join("") +
      "</div>";
  }

  // ---- Cálculo de porcentajes (preguntas → elemento → grupo) -------------
  // Los porcentajes provienen exclusivamente del Excel (data/dashboard_data.js).
  const expanded = new Set();

  // % de un elemento: promedio de sus preguntas con valor; si ninguna pregunta
  // tiene valor, usa el % del elemento cargado desde el Excel (e.pct).
  function elementPct(e) {
    if (!e.preguntas || e.preguntas.length === 0) return e.pct;
    const nums = e.preguntas
      .map((p) => p.pct)
      .filter((v) => typeof v === "number");
    if (nums.length === 0) return e.pct;
    return Math.round(nums.reduce((s, v) => s + v, 0) / nums.length);
  }

  function groupPct(grupo) {
    const vals = grupo.elementos.map(elementPct);
    return Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
  }

  function documentalPct() {
    const all = [];
    D.resso.forEach((g) => g.elementos.forEach((e) => all.push(elementPct(e))));
    return all.length ? Math.round(all.reduce((s, v) => s + v, 0) / all.length) : 0;
  }

  // ---- KPI cards ----------------------------------------------------------
  function renderKpis() {
    const k = D.kpis;
    const doc = documentalPct();
    const terreno = k.cumplimientoTerreno;
    const total = Math.round((doc + terreno) / 2);
    const expClass =
      "exp-" + (k.nivelExposicion || "").toLowerCase().replace(/[^a-z]/g, "");
    const cards = [
      { label: "Cumplimiento documental", value: doc + "%", accent: pctColor(doc) },
      { label: "Cumplimiento terreno", value: terreno + "%", accent: pctColor(terreno) },
      { label: "Cumplimiento total auditoría", value: total + "%", accent: "#24407a" },
      { label: "Nivel de exposición", pill: true, value: k.nivelExposicion, expClass, accent: "#24407a" },
    ];
    $("#kpiCards").innerHTML = cards
      .map((c) => {
        const val = c.pill
          ? `<div class="value pill ${c.expClass}">${c.value}</div>`
          : `<div class="value">${c.value}</div>`;
        return `<div class="card" style="--accent:${c.accent}"><div class="label">${c.label}</div>${val}</div>`;
      })
      .join("");
  }

  // ---- RESSO grid (PHVA) con preguntas por elemento (solo lectura) -------
  function renderResso() {
    $("#resssoGrid").innerHTML = D.resso
      .map((grupo) => {
        const prom = groupPct(grupo);
        const elementos = grupo.elementos
          .map((e) => {
            const ep = elementPct(e);
            const tienePreg = e.preguntas && e.preguntas.length > 0;
            const isOpen = expanded.has(e.id);
            const meta = tienePreg
              ? `<span class="re-count">${e.preguntas.length} preg.</span>`
              : "";
            const toggle = tienePreg
              ? `<button class="re-toggle" data-el="${e.id}" aria-expanded="${isOpen}">${isOpen ? "▾" : "▸"}</button>`
              : `<span class="re-toggle-empty"></span>`;
            const preguntasHtml = tienePreg
              ? `<div class="preg-list${isOpen ? " open" : ""}">` +
                e.preguntas
                  .map((p) => {
                    const v = p.pct;
                    const vShow = v === "NA" ? "N/A" : typeof v === "number" ? v + "%" : "—";
                    const vColor = typeof v === "number" ? pctColor(v) : "#9aa3b2";
                    return `
                    <div class="preg-row">
                      <div class="preg-num">${p.n}</div>
                      <div class="preg-text">${p.texto}</div>
                      <div class="preg-score" style="color:${vColor}">${vShow}</div>
                    </div>`;
                  })
                  .join("") +
                `</div>`
              : "";
            return `
              <div class="resso-el">
                <div class="re-top">
                  ${toggle}
                  <span class="re-name">${e.id}. ${e.nombre}</span>
                  ${meta}
                  <span class="re-val">${ep}%</span>
                </div>
                <div class="re-bar"><span style="width:${ep}%;background:${pctColor(ep)}"></span></div>
                ${preguntasHtml}
              </div>`;
          })
          .join("");
        return `
          <div class="resso-card">
            <div class="resso-card-head" style="background:${grupo.color}">
              <div>
                <div class="rc-ciclo">${grupo.id} · ${grupo.ciclo}</div>
                <h3>${grupo.titulo}</h3>
              </div>
              <div class="rc-pct">${prom}%</div>
            </div>
            <div class="resso-elementos">${elementos}</div>
          </div>`;
      })
      .join("");
  }

  // ---- Bar chart por elemento --------------------------------------------
  function renderBars() {
    const elementos = [];
    D.resso.forEach((g) => g.elementos.forEach((e) => elementos.push(e)));
    $("#elementBars").innerHTML = elementos
      .map((e) => {
        const ep = elementPct(e);
        return `
        <div class="bar-row">
          <div class="bar-top">
            <span class="bar-name">${e.id}. ${e.nombre}</span>
            <span class="bar-val">${ep}%</span>
          </div>
          <div class="bar-track"><span class="bar-fill" style="width:${ep}%;background:${pctColor(ep)}"></span></div>
        </div>`;
      })
      .join("");
  }

  // ---- Interacción: solo desplegar/colapsar preguntas --------------------
  $("#resssoGrid").addEventListener("click", (ev) => {
    const btn = ev.target.closest(".re-toggle");
    if (!btn) return;
    const id = btn.getAttribute("data-el");
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
    renderResso();
  });

  // ---- Donut de hallazgos -------------------------------------------------
  function renderDonut() {
    const all = [
      ...D.hallazgosDoc.map((h) => ({ ...h, grupo: "Documental" })),
      ...D.hallazgosTerreno.map((h) => ({ ...h, grupo: "Terreno" })),
    ];
    const total = all.reduce((s, h) => s + h.value, 0);
    const donut = $("#hallazgosDonut");

    let acc = 0;
    const segments = all
      .filter((h) => h.value > 0)
      .map((h) => {
        const start = (acc / total) * 360;
        acc += h.value;
        const end = (acc / total) * 360;
        return `${h.color} ${start}deg ${end}deg`;
      })
      .join(", ");

    donut.style.background = total
      ? `conic-gradient(${segments})`
      : "var(--line)";
    donut.setAttribute("data-total", total);

    // Leyenda agrupada
    const groups = { Documental: D.hallazgosDoc, Terreno: D.hallazgosTerreno };
    let html = "";
    Object.keys(groups).forEach((g) => {
      html += `<div class="legend-group-title">Hallazgos ${g.toLowerCase()}</div>`;
      html += groups[g]
        .map(
          (h) => `
          <div class="legend-item">
            <span class="legend-dot" style="background:${h.color}"></span>
            <span>${h.label}</span>
            <span class="lg-val">${h.value}</span>
          </div>`
        )
        .join("");
    });
    $("#donutLegend").innerHTML = html;
  }

  // ---- Accesos documentales ----------------------------------------------
  function renderAccess() {
    $("#accessLinks").innerHTML = D.accesos
      .map(
        (a) =>
          `<a class="access-button" href="${a.url}" target="_blank" rel="noopener noreferrer">${a.titulo}</a>`
      )
      .join("");
  }

  // ---- Tabla de reglamentos (con filtros) --------------------------------
  function renderReglamentos() {
    const search = $("#regSearch");
    const filter = $("#regFilter");
    const tbody = $("#regTableBody");
    const count = $("#regCount");

    function apply() {
      const q = search.value.trim().toLowerCase();
      const f = filter.value;
      const rows = D.reglamentos.filter((r) => {
        const matchQ =
          !q ||
          r.codigo.toLowerCase().includes(q) ||
          r.nombre.toLowerCase().includes(q);
        const matchF =
          !f || (f === "si" ? r.difundido : !r.difundido);
        return matchQ && matchF;
      });

      tbody.innerHTML = rows
        .map(
          (r, i) => `
          <tr>
            <td>${i + 1}</td>
            <td><strong>${r.codigo}</strong></td>
            <td>${r.nombre}</td>
            <td>${
              r.difundido
                ? '<span class="tag tag-ok">Difundido</span>'
                : '<span class="tag tag-pending">Pendiente</span>'
            }</td>
          </tr>`
        )
        .join("");

      count.textContent =
        rows.length + (rows.length === 1 ? " reglamento" : " reglamentos");
    }

    search.addEventListener("input", apply);
    filter.addEventListener("change", apply);
    apply();
  }

  // ---- Auditoría ABC-S ----------------------------------------------------
  function renderAbc() {
    const abc = D.abc;
    if (!abc) return;

    $("#abcTitulo").textContent = abc.titulo;

    const prom =
      Math.round(
        (abc.criterios.reduce((s, c) => s + c.pct, 0) / abc.criterios.length) * 10
      ) / 10;
    const aprobados = abc.criterios.filter((c) => c.pct >= 90).length;
    const criticos = abc.criterios.filter((c) => c.pct < 60).length;

    $("#abcSummary").innerHTML = `
      <div class="abc-kpi abc-gauge">
        <div class="ak-value">${abc.totalGerencia}%</div>
        <div class="ak-label">Total Gerencia</div>
      </div>
      <div class="abc-kpi">
        <div class="ak-value">${prom}%</div>
        <div class="ak-label">Promedio de criterios</div>
      </div>
      <div class="abc-kpi">
        <div class="ak-value">${aprobados}/${abc.criterios.length}</div>
        <div class="ak-label">Criterios &ge; 90%</div>
      </div>
      <div class="abc-kpi">
        <div class="ak-value">${criticos}</div>
        <div class="ak-label">Criterios cr&iacute;ticos (&lt;60%)</div>
      </div>`;

    $("#abcBars").innerHTML = abc.criterios
      .map(
        (c) => `
        <div class="bar-row">
          <div class="bar-top">
            <span class="bar-name">${c.n}. ${c.nombre}</span>
            <span class="bar-val">${c.pct}%</span>
          </div>
          <div class="bar-track"><span class="bar-fill" style="width:${c.pct}%;background:${pctColor(c.pct)}"></span></div>
        </div>`
      )
      .join("");

    $("#abcScale").innerHTML = abc.escala
      .map(
        (s) =>
          `<li><span class="sc-nivel">${s.nivel}</span><span class="sc-desc">${s.desc}</span></li>`
      )
      .join("");

    $("#abcTableBody").innerHTML = abc.criterios
      .map((c) => {
        let estado, cls;
        if (c.pct >= 90) { estado = "Conforme"; cls = "tag-ok"; }
        else if (c.pct >= 60) { estado = "Parcial"; cls = "tag-warn"; }
        else { estado = "Crítico"; cls = "tag-pending"; }
        return `
          <tr>
            <td>${c.n}</td>
            <td>${c.nombre}</td>
            <td><strong style="color:${pctColor(c.pct)}">${c.pct}%</strong></td>
            <td><span class="tag ${cls}">${estado}</span></td>
          </tr>`;
      })
      .join("");
  }

  // ---- Cursos: gráficos circulares de cumplimiento -----------------------
  function renderCursos() {
    const cont = $("#cursosGrid");
    if (!cont || !D.cursos) return;
    cont.innerHTML = D.cursos
      .map((c) => {
        const pct = typeof c.pct === "number" ? c.pct : 0;
        const color = pctColor(pct);
        const deg = (pct / 100) * 360;
        return `
        <div class="curso-card">
          <div class="curso-donut" style="background:conic-gradient(${color} 0deg ${deg}deg, var(--line) ${deg}deg 360deg)">
            <div class="curso-donut-hole">
              <span class="cd-pct" style="color:${color}">${pct}%</span>
            </div>
          </div>
          <div class="curso-info">
            <h3>${c.nombre}</h3>
            <p class="curso-meta"><strong>${c.cumplen}</strong> de <strong>${c.total}</strong> cumplen</p>
          </div>
        </div>`;
      })
      .join("");
  }

  // ---- Tabla de personal y cursos (estilo SKIONLINE) ---------------------
  function renderPersonal() {
    if (!D.personal || !D.cursos) return;
    const search = $("#perSearch");
    const filter = $("#perFilter");
    const tbody = $("#perTableBody");
    const count = $("#perCount");
    if (!tbody) return;

    const cursos = D.cursos;

    function apply() {
      const q = (search.value || "").trim().toLowerCase();
      const f = filter.value; // "" | curso id (no cumple)
      const rows = D.personal.filter((p) => {
        const matchQ =
          !q ||
          (p.nombre && p.nombre.toLowerCase().includes(q)) ||
          (p.rut && p.rut.toLowerCase().includes(q)) ||
          (p.cargo && p.cargo.toLowerCase().includes(q));
        const matchF = !f || p.cursos[f] === false;
        return matchQ && matchF;
      });

      tbody.innerHTML = rows
        .map((p, i) => {
          const celdas = cursos
            .map((c) => {
              const ok = p.cursos[c.id] === true;
              return `<td class="cell-center">${
                ok
                  ? '<span class="tag tag-ok">Cumple</span>'
                  : '<span class="tag tag-pending">Pendiente</span>'
              }</td>`;
            })
            .join("");
          return `
          <tr>
            <td>${i + 1}</td>
            <td><strong>${p.nombre}</strong></td>
            <td>${p.cargo || "—"}</td>
            ${celdas}
          </tr>`;
        })
        .join("");

      count.textContent =
        rows.length + (rows.length === 1 ? " persona" : " personas");
    }

    search.addEventListener("input", apply);
    filter.addEventListener("change", apply);
    apply();
  }

  // ---- Detalle de reportes ABC-S (búsqueda por RUT o nombre) -------------
  function renderReportes() {
    if (!D.reportes) return;
    const search = $("#repSearch");
    const results = $("#repResults");
    const count = $("#repCount");
    const selSemana = $("#repSemana");
    const missCount = $("#repMissCount");
    const exportBtn = $("#repExport");
    if (!search || !results) return;

    const esc = (s) =>
      String(s == null ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    // Normaliza texto: minúsculas, sin acentos
    const norm = (s) =>
      String(s || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");

    // Solo dígitos y K para comparar RUT
    const rutDigits = (s) =>
      String(s || "").toUpperCase().replace(/[^0-9K]/g, "");

    // Clave de nombre: tokens (>1 letra) ordenados, para cruzar con turnos
    const nameKey = (s) =>
      norm(s)
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .split(" ")
        .filter((t) => t.length > 1)
        .sort()
        .join(" ");

    // Conjuntos de quienes SÍ entregaron reporte (por RUT y por nombre)
    const reportRutSet = new Set();
    const reportNameSet = new Set();
    D.reportes.forEach((r) => {
      if (r.rutKey) reportRutSet.add(r.rutKey);
      reportNameSet.add(nameKey(r.nombre));
    });

    // Pobla los selects una sola vez
    if (selSemana && selSemana.options.length <= 1) {
      [...new Set(D.reportes.map((r) => r.semana).filter(Boolean))].forEach((s) => {
        const o = document.createElement("option");
        o.value = s;
        o.textContent = s;
        selSemana.appendChild(o);
      });
    }
    // Multi-selects (Turno y RF) con casillas
    const closeAllMenus = () => {
      document
        .querySelectorAll("#reportesPanel .ms-menu")
        .forEach((m) => (m.hidden = true));
      document
        .querySelectorAll("#reportesPanel .ms-toggle")
        .forEach((t) => t.setAttribute("aria-expanded", "false"));
    };
    function makeMultiSelect(prefix, values, allLabel) {
      const toggle = $("#" + prefix + "Toggle");
      const label = $("#" + prefix + "Label");
      const menu = $("#" + prefix + "Menu");
      const selected = new Set();
      if (!toggle || !menu) return { get: () => [] };
      function updateLabel() {
        if (selected.size === 0) label.textContent = allLabel;
        else if (selected.size === 1) label.textContent = [...selected][0];
        else label.textContent = selected.size + " seleccionados";
      }
      menu.innerHTML = values
        .map(
          (v) =>
            `<label class="ms-opt"><input type="checkbox" value="${esc(
              v
            )}" /><span>${esc(v)}</span></label>`
        )
        .join("");
      menu.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        cb.addEventListener("change", () => {
          if (cb.checked) selected.add(cb.value);
          else selected.delete(cb.value);
          updateLabel();
          apply();
        });
      });
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        const willOpen = menu.hidden;
        closeAllMenus();
        menu.hidden = !willOpen;
        toggle.setAttribute("aria-expanded", String(willOpen));
      });
      menu.addEventListener("click", (e) => e.stopPropagation());
      updateLabel();
      return { get: () => [...selected] };
    }
    document.addEventListener("click", closeAllMenus);

    const turnosVals = (() => {
      const s = new Set();
      (D.turnos || []).forEach((p) => p.turno && s.add(p.turno));
      D.reportes.forEach((r) => r.turno && s.add(r.turno));
      return [...s].sort();
    })();
    const rfVals = (() => {
      const s = new Set();
      D.reportes.forEach((r) => r.rc && s.add(r.rc));
      return [...s].sort();
    })();
    const turnoMS = makeMultiSelect("repTurno", turnosVals, "Todos");
    const rfMS = makeMultiSelect("repRf", rfVals, "Todos");

    // Personas que están en turnos (tarja) pero NO entregaron reporte
    function missingList() {
      const turnos = turnoMS.get();
      return (D.turnos || []).filter((p) => {
        if (turnos.length && turnos.indexOf(p.turno) === -1) return false;
        if (p.rutKey && reportRutSet.has(p.rutKey)) return false;
        if (reportNameSet.has(nameKey(p.nombre))) return false;
        return true;
      });
    }

    // Paleta para los gráficos de respuestas
    const chartColors = [
      "#24407a", "#2e8b57", "#e1251b", "#f0a500", "#5b8def",
      "#8e5bd0", "#00a3a3", "#d0608e", "#7a7a24", "#c0392b",
    ];

    // Gráficos: respuestas de los trabajadores + % de cumplimiento
    function renderRepCharts(dataset) {
      const charts = $("#repCharts");
      if (!charts) return;

      // Distribución de respuestas (campo p1: evento / hallazgo)
      const counts = {};
      dataset.forEach((r) => {
        const k = (r.p1 || "—").toString().trim().toUpperCase() || "—";
        counts[k] = (counts[k] || 0) + 1;
      });
      const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      const maxV = entries.length ? entries[0][1] : 1;
      const totalR = dataset.length;
      const barsHtml = entries.length
        ? entries
            .map((e, i) => {
              const pct = totalR ? Math.round((e[1] / totalR) * 100) : 0;
              const w = Math.round((e[1] / maxV) * 100);
              const color = chartColors[i % chartColors.length];
              return `
              <div class="bar-row">
                <div class="bar-top">
                  <span class="bar-name">${esc(e[0])}</span>
                  <span class="bar-val">${e[1]} · ${pct}%</span>
                </div>
                <div class="bar-track"><span class="bar-fill" style="width:${w}%;background:${color}"></span></div>
              </div>`;
            })
            .join("")
        : '<div class="rep-empty">Sin datos para esos filtros.</div>';

      // Cumplimiento: en turno con reporte vs. sin reporte (respeta filtro de turno)
      const turnosSel = turnoMS.get();
      const totalTurnos = (D.turnos || []).filter(
        (p) => !turnosSel.length || turnosSel.indexOf(p.turno) !== -1
      ).length;
      const missing = missingList().length;
      const delivered = Math.max(totalTurnos - missing, 0);
      const cmpl = totalTurnos ? Math.round((delivered / totalTurnos) * 100) : 0;
      const okColor = "#2e8b57";
      const missColor = "#e1251b";
      const donutBg = totalTurnos
        ? `conic-gradient(${okColor} 0deg ${cmpl * 3.6}deg, ${missColor} ${cmpl * 3.6}deg 360deg)`
        : "var(--line)";

      charts.innerHTML = `
        <div class="rep-chart-card">
          <div class="rep-chart-title">Respuestas de los trabajadores</div>
          <div class="rep-bars">${barsHtml}</div>
        </div>
        <div class="rep-chart-card">
          <div class="rep-chart-title">Porcentaje de cumplimiento</div>
          <div class="rep-cmpl">
            <div class="rep-donut" style="background:${donutBg}">
              <div class="rep-donut-val">${cmpl}%<small>cumple</small></div>
            </div>
            <div class="rep-cmpl-legend">
              <div class="legend-item"><span class="legend-dot" style="background:${okColor}"></span>Con reporte <b>${delivered}</b></div>
              <div class="legend-item"><span class="legend-dot" style="background:${missColor}"></span>Sin reporte <b>${missing}</b></div>
              <div class="legend-item"><span class="legend-dot" style="background:var(--muted)"></span>Total en turno <b>${totalTurnos}</b></div>
            </div>
          </div>
        </div>`;
    }

    function apply() {
      const raw = (search.value || "").trim();
      const semana = selSemana ? selSemana.value : "";
      const turnos = turnoMS.get();
      const rfs = rfMS.get();

      // Chip comparativo: en turno sin reporte
      if (missCount) {
        const n = missingList().length;
        missCount.textContent =
          n + (n === 1 ? " en turno sin reporte" : " en turno sin reporte");
      }

      // Gráficos: overview por semana/turno/RF (ignora la búsqueda de texto)
      const overview = D.reportes.filter((r) => {
        if (semana && r.semana !== semana) return false;
        if (turnos.length && turnos.indexOf(r.turno) === -1) return false;
        if (rfs.length && rfs.indexOf(r.rc) === -1) return false;
        return true;
      });
      renderRepCharts(overview);

      if (!raw && !semana && !turnos.length && !rfs.length) {
        results.innerHTML = "";
        count.textContent = "Escribe un RUT o nombre, o filtra por semana/turno";
        return;
      }

      const qRut = rutDigits(raw);
      const qName = norm(raw);
      const looksRut = /^[0-9]/.test(raw.replace(/[.\-\s]/g, "")) && qRut.length >= 4;

      const matches = D.reportes.filter((r) => {
        if (raw) {
          if (looksRut) {
            if (!(r.rutKey && r.rutKey.indexOf(qRut) !== -1)) return false;
          } else if (norm(r.nombre).indexOf(qName) === -1) {
            return false;
          }
        }
        if (semana && r.semana !== semana) return false;
        if (turnos.length && turnos.indexOf(r.turno) === -1) return false;
        if (rfs.length && rfs.indexOf(r.rc) === -1) return false;
        return true;
      });

      if (matches.length === 0) {
        results.innerHTML =
          '<div class="rep-empty">Sin reportes para esos filtros.</div>';
        count.textContent = "0 reportes";
        return;
      }

      // Agrupa por persona (rutKey si existe, si no por nombre normalizado)
      const groups = new Map();
      matches.forEach((r) => {
        const key = r.rutKey || "n:" + norm(r.nombre);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
      });

      let html = "";
      groups.forEach((reps) => {
        const f = reps[0];
        const rutTxt = f.rutMostrar
          ? f.rutMostrar
          : '<span class="rep-norut">sin RUT en tarja</span>';
        const turnoTxt = f.turno ? esc(f.turno) : "—";
        const filas = reps
          .map(
            (r) => `
            <tr>
              <td>${esc(r.fecha)}</td>
              <td>${esc(r.semana)}</td>
              <td><strong>${esc(r.rc)}</strong></td>
              <td>${esc(r.p1)}</td>
              <td>${esc(r.p2)}</td>
              <td>${esc(r.p3)}</td>
            </tr>`
          )
          .join("");
        html += `
          <div class="rep-ficha">
            <div class="rep-ficha-head">
              <div>
                <div class="rep-nombre">${esc(f.nombre)}</div>
                <div class="rep-sub">RUT ${rutTxt}</div>
              </div>
              <span class="mini-chip">${reps.length} ${
          reps.length === 1 ? "reporte" : "reportes"
        }</span>
            </div>
            <div class="rep-ficha-meta">
              <div><span class="rfm-label">Turno</span><span>${turnoTxt}</span></div>
              <div><span class="rfm-label">Cargo</span><span>${esc(f.cargo) || "—"}</span></div>
              <div><span class="rfm-label">Gerencia</span><span>${esc(f.gerencia) || "—"}</span></div>
              <div><span class="rfm-label">Empresa</span><span>${esc(f.empresa) || "—"}</span></div>
            </div>
            <div class="table-wrap">
              <table class="records-table rep-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Semana</th>
                    <th>RF</th>
                    <th>1. Evento / hallazgo</th>
                    <th>2. ¿Dónde?</th>
                    <th>3. ¿Cómo evitarlo?</th>
                  </tr>
                </thead>
                <tbody>${filas}</tbody>
              </table>
            </div>
          </div>`;
      });

      results.innerHTML = html;
      const np = groups.size;
      const nr = matches.length;
      count.textContent =
        `${np} ${np === 1 ? "persona" : "personas"} · ${nr} ${
          nr === 1 ? "reporte" : "reportes"
        }`;
    }

    // Exporta CSV: personas en turnos sin reporte (respeta el filtro de turno)
    function exportMissing() {
      const miss = missingList();
      const turnos = turnoMS.get();
      if (miss.length === 0) {
        alert("No hay personas en turno sin reporte para exportar.");
        return;
      }
      const rows = [["RUT", "Nombre", "Turno", "Cargo"]];
      miss.forEach((p) => {
        rows.push([p.rutMostrar || "", p.nombre || "", p.turno || "", p.cargo || ""]);
      });
      const csv = rows
        .map((r) =>
          r
            .map((c) => {
              const v = String(c == null ? "" : c);
              return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
            })
            .join(";")
        )
        .join("\r\n");
      const blob = new Blob(["\ufeff" + csv], {
        type: "text/csv;charset=utf-8;",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const suf = turnos.length
        ? "_" + turnos.join("-").replace(/[^0-9A-Za-z]+/g, "")
        : "_todos";
      a.href = url;
      a.download = "en_turno_sin_reporte" + suf + ".csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    search.addEventListener("input", apply);
    if (selSemana) selSemana.addEventListener("change", apply);
    if (exportBtn) exportBtn.addEventListener("click", exportMissing);
    apply();
  }

  $("#printBtn").addEventListener("click", () => window.print());

  // ---- Init ---------------------------------------------------------------
  renderContract();
  renderKpis();
  renderResso();
  renderBars();
  renderDonut();
  renderAccess();
  renderReglamentos();
  renderAbc();
  renderCursos();
  renderPersonal();
  renderReportes();
})();
