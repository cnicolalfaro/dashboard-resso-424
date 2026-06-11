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

  // ---- Imprimir -----------------------------------------------------------
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
})();
