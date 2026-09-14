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

  const RIM_FORM_DEFS = [
    {
      id: "RIM_R_01_REGLAMENTO_INTERNO_DE_VENTILACION",
      short: "RIM 01",
      label: "Reglamento Interno de Ventilación",
    },
    {
      id: "RIM_R_035_REGLAMENTO_DE_EMERGENCIA_MINA_CHUQUICAMATA",
      short: "RIM 035",
      label: "Reglamento de Emergencia Mina Chuquicamata",
    },
    {
      id: "RIM_REGLAMENTO_CONTROL_DE_INGRESO_DE_PERSONAS_A_LA_FAENA",
      short: "RIM Ingreso",
      label: "Reglamento Control de Ingreso de Personas a la Faena",
    },
  ];

  const cleanRutKey = (value) =>
    String(value || "").toUpperCase().replace(/[^0-9K]/g, "");

  const normKey = (value) =>
    String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const personMatchKey = (person) =>
    cleanRutKey(person && (person.rutKey || person.rut || "")) ||
    normKey(person && (person.nombre || person.name || ""));

  const rimStatusFromRecords = (records, formId) => {
    const formRecords = (records || []).filter((r) => r.formulario === formId);
    if (formRecords.some((r) => String(r.rimEstado || "").toUpperCase() === "APROBADO")) {
      return "APROBADO";
    }
    if (formRecords.some((r) => String(r.rimEstado || "").toUpperCase() === "REPROBADO")) {
      return "REPROBADO";
    }
    return formRecords.length ? "PENDIENTE" : "FALTA";
  };

  // Un aprobado "necesitó reevaluación" si en algún intento del cuestionario
  // reprobó (resultadoQuiz = REPROBADO) antes de terminar con el cumplimiento
  // final en APROBADO (rimEstado, guiado por la columna ENTREGA).
  const rimApprovedNeedsReeval = (records, formId) => {
    const formRecords = (records || []).filter((r) => r.formulario === formId);
    const aprobado = formRecords.some((r) => String(r.rimEstado || "").toUpperCase() === "APROBADO");
    if (!aprobado) return false;
    return formRecords.some((r) => String(r.resultadoQuiz || "").toUpperCase() === "REPROBADO");
  };

  const buildRimRosterSummary = (formId, turnoFiltro) => {
    const reportsByKey = new Map();
    (D.reportes || []).forEach((r) => {
      const key = cleanRutKey(r.rutKey) || normKey(r.nombre);
      if (!key) return;
      if (!reportsByKey.has(key)) reportsByKey.set(key, []);
      reportsByKey.get(key).push(r);
    });

    const roster = [];
    const seen = new Set();
    (D.turnos || []).forEach((p) => {
      if (turnoFiltro && p.turno !== turnoFiltro) return;
      const key = personMatchKey(p);
      if (!key || seen.has(key)) return;
      seen.add(key);
      roster.push({ key, person: p });
    });

    const summary = {
      total: roster.length,
      aprobados: 0,
      aprobadosReeval: 0,
      reprobados: 0,
      faltan: 0,
    };

    roster.forEach(({ key, person }) => {
      const records = reportsByKey.get(key) || [];
      const status = rimStatusFromRecords(records, formId);
      if (status === "APROBADO") {
        summary.aprobados += 1;
        if (rimApprovedNeedsReeval(records, formId)) summary.aprobadosReeval += 1;
      }
      else if (status === "REPROBADO") summary.reprobados += 1;
      else summary.faltan += 1;
      if (!person) summary.faltan += 0;
    });

    summary.aprobadosDirectos = summary.aprobados - summary.aprobadosReeval;
    summary.pct = summary.total ? Math.round((summary.aprobados / summary.total) * 1000) / 10 : 0;
    return summary;
  };

  // Paleta exclusiva para las donas de cumplimiento RIM: nunca en rojo,
  // el avance bajo se ve como un verde más claro en vez de una alerta.
  const rimPctColor = (p) => {
    if (p >= 90) return "#1f7a43";
    if (p >= 50) return "#2e8b57";
    return "#7bc79a";
  };

  // ---- Merge de evidencias (evaluación %, comentarios y fotos del Excel) --
  // Las evidencias viven en D.evidencias = { "<n>": { eval, obs, obsAuditor,
  // ruta, imgs:[dataURI] } } y se fusionan en cada pregunta por su número.
  (function mergeEvidencias() {
    const ev = D.evidencias;
    if (!ev || !D.resso) return;
    D.resso.forEach((g) =>
      g.elementos.forEach((e) =>
        (e.preguntas || []).forEach((p) => {
          const d = ev[String(p.n)];
          if (!d) return;
          if (d.eval !== undefined && d.eval !== null) p.pct = d.eval;
          if (d.obs) p.obs = d.obs;
          if (d.obsAuditor) p.obsAuditor = d.obsAuditor;
          if (d.ruta) p.ruta = d.ruta;
          if (d.imgs && d.imgs.length) p.imgs = d.imgs;
        })
      )
    );
  })();

  const $ = (sel) => document.querySelector(sel);

  function pctColor(p) {
    if (p >= 90) return "#2e8b57";
    if (p >= 70) return "#f0a500";
    return "#e1251b";
  }

  // ---- Fecha de actualización -------------------------------------------
  $("#updatedAt").textContent = "Actualizado: " + D.generatedAt;
  document
    .querySelectorAll(".js-updated")
    .forEach((el) => (el.textContent = "Actualizado: " + D.generatedAt));

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
  // Los porcentajes se calculan siempre ponderados por peso (peso * pct / 100),
  // de abajo hacia arriba, desde las preguntas individuales. No se usa la tabla
  // "RESULTADOS GLOBALES" del Excel como atajo: sus Pond. por ciclo no suman
  // 100% entre sí (25+55+17+17=114%), así que calculamos todo directamente
  // desde el peso real de cada pregunta para evitar arrastrar ese error.
  const expanded = new Set();

  function pesoPonderado(preguntas) {
    let aporte = 0;
    let pesoTotal = 0;
    (preguntas || []).forEach((p) => {
      if (typeof p.peso !== "number") return;
      pesoTotal += p.peso;
      if (typeof p.pct === "number") aporte += (p.peso * p.pct) / 100;
    });
    return { aporte, pesoTotal };
  }

  // % de un elemento: promedio ponderado por peso de sus preguntas; si ninguna
  // pregunta tiene valor, usa el % del elemento cargado desde el Excel (e.pct).
  function elementPct(e) {
    if (!e.preguntas || e.preguntas.length === 0) return e.pct;
    const { aporte, pesoTotal } = pesoPonderado(e.preguntas);
    if (!pesoTotal) return e.pct;
    return Math.round((aporte / pesoTotal) * 100);
  }

  // % de un grupo (ciclo): promedio ponderado por peso de TODAS sus preguntas
  // (no promedio simple de sus elementos), consistente con documentalPct().
  function groupPct(grupo) {
    const preguntas = [];
    grupo.elementos.forEach((e) => preguntas.push(...(e.preguntas || [])));
    const { aporte, pesoTotal } = pesoPonderado(preguntas);
    return pesoTotal ? Math.round((aporte / pesoTotal) * 100) : 0;
  }

  // Peso total de un grupo (ciclo), calculado desde sus propias preguntas
  // (para mostrar el "Pond." real del ciclo sin depender de tablas separadas).
  function groupPeso(grupo) {
    let total = 0;
    grupo.elementos.forEach((e) =>
      (e.preguntas || []).forEach((p) => {
        if (typeof p.peso === "number") total += p.peso;
      })
    );
    return Math.round(total * 100) / 100;
  }

  // Cumplimiento documental ponderado por peso: suma de aportes (peso * eval / 100)
  // sobre la suma total de pesos de las 40 preguntas. Las preguntas N/A o sin
  // evaluar aportan 0 pero su peso sí cuenta.
  function documentalPct() {
    let aporte = 0;
    let pesoTotal = 0;
    D.resso.forEach((g) =>
      g.elementos.forEach((e) =>
        (e.preguntas || []).forEach((p) => {
          if (typeof p.peso !== "number") return;
          pesoTotal += p.peso;
          if (typeof p.pct === "number") aporte += (p.peso * p.pct) / 100;
        })
      )
    );
    return pesoTotal ? (aporte / pesoTotal) * 100 : 0;
  }

  // Cumplimiento terreno ponderado por peso, igual criterio que documentalPct()
  // pero sobre D.ressoTerreno (checklist de revisión en campo).
  function terrenoPct() {
    if (!D.ressoTerreno) return (D.kpis && D.kpis.cumplimientoTerreno) || 0;
    let aporte = 0;
    let pesoTotal = 0;
    D.ressoTerreno.forEach((s) =>
      (s.items || []).forEach((it) => {
        if (typeof it.peso !== "number") return;
        pesoTotal += it.peso;
        if (typeof it.pct === "number") aporte += (it.peso * it.pct) / 100;
      })
    );
    return pesoTotal ? (aporte / pesoTotal) * 100 : 0;
  }

  // ---- KPI cards ----------------------------------------------------------
  function renderKpis() {
    const k = D.kpis;
    const doc = documentalPct();
    const terreno = terrenoPct();
    const total = Math.round((doc + terreno) / 2);
    const expClass =
      "exp-" + (k.nivelExposicion || "").toLowerCase().replace(/[^a-z]/g, "");
    const cards = [
      { label: "Cumplimiento documental", value: Math.round(doc) + "%", accent: pctColor(doc) },
      { label: "Cumplimiento terreno", value: Math.round(terreno) + "%", accent: pctColor(terreno) },
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
                    const pesoShow = typeof p.peso === "number"
                      ? `<div class="preg-peso" title="Ponderado">${String(p.peso).replace(".", ",")}%</div>`
                      : `<div class="preg-peso"></div>`;
                    const nImg = p.imgs && p.imgs.length ? p.imgs.length : 0;
                    const tieneEvid = !!(p.obs || p.obsAuditor || p.ruta || nImg || p.responsable || (p.comentarios && p.comentarios.length));
                    const evidBtn = tieneEvid
                      ? `<button class="preg-evid" data-evid="${p.n}" title="Ver evidencia y comentarios">${nImg ? "📷 " + nImg : "💬"}</button>`
                      : `<span class="preg-evid-empty"></span>`;
                    return `
                    <div class="preg-row">
                      <div class="preg-num">${p.n}</div>
                      <div class="preg-text">${p.texto}</div>
                      ${pesoShow}
                      ${evidBtn}
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
                <div class="rc-ciclo">${grupo.id} · ${grupo.ciclo} · Pond. ${groupPeso(grupo)}%</div>
                <h3>${grupo.titulo}</h3>
              </div>
              <div class="rc-pct">${prom}%</div>
            </div>
            <div class="resso-elementos">${elementos}</div>
          </div>`;
      })
      .join("");
  }

  // % de una sección terreno: promedio de sus ítems con valor; si ninguno
  // tiene valor, usa el % de la sección (0 mientras no se audite en campo).
  function seccionPct(s) {
    if (!s.items || s.items.length === 0) return s.pct;
    const nums = s.items
      .map((it) => it.pct)
      .filter((v) => typeof v === "number");
    if (nums.length === 0) return s.pct;
    return Math.round(nums.reduce((sum, v) => sum + v, 0) / nums.length);
  }

  // ---- Revisión Terreno (checklist por categoría, solo lectura) ----------
  const expandedTerreno = new Set();
  function renderRessoTerreno() {
    const grid = $("#ressoTerrenoGrid");
    if (!grid || !D.ressoTerreno) return;
    $("#ressoTerrenoPct").textContent = Math.round(terrenoPct()) + "%";
    grid.innerHTML = D.ressoTerreno
      .map((seccion) => {
        const sp = seccionPct(seccion);
        const isOpen = expandedTerreno.has(seccion.nombre);
        const itemsHtml = (seccion.items || [])
          .map((it) => {
            const v = it.pct;
            const vShow = v === "NA" ? "N/A" : typeof v === "number" ? v + "%" : "—";
            const vColor = typeof v === "number" ? pctColor(v) : "#9aa3b2";
            const pesoShow = typeof it.peso === "number"
              ? `<div class="preg-peso" title="Ponderado">${String(it.peso).replace(".", ",")}%</div>`
              : `<div class="preg-peso"></div>`;
            const grupoShow = it.grupo ? `<span class="preg-grupo">${it.grupo}: </span>` : "";
            return `
            <div class="preg-row">
              <div class="preg-num">${it.numero}</div>
              <div class="preg-text">${grupoShow}${it.texto}</div>
              ${pesoShow}
              <span class="preg-evid-empty"></span>
              <div class="preg-score" style="color:${vColor}">${vShow}</div>
            </div>`;
          })
          .join("");
        return `
          <div class="resso-el">
            <div class="re-top">
              <button class="re-toggle" data-terr="${seccion.nombre}" aria-expanded="${isOpen}">${isOpen ? "▾" : "▸"}</button>
              <span class="re-name">${seccion.nombre}</span>
              <span class="re-count">${(seccion.items || []).length} ítems</span>
              <span class="re-val">${sp}%</span>
            </div>
            <div class="re-bar"><span style="width:${sp}%;background:${pctColor(sp)}"></span></div>
            <div class="preg-list${isOpen ? " open" : ""}">${itemsHtml}</div>
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
    const evidBtn = ev.target.closest(".preg-evid");
    if (evidBtn) {
      abrirEvidencia(parseInt(evidBtn.getAttribute("data-evid"), 10));
      return;
    }
    const btn = ev.target.closest(".re-toggle");
    if (!btn) return;
    const id = btn.getAttribute("data-el");
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
    renderResso();
  });

  $("#ressoTerrenoGrid") &&
    $("#ressoTerrenoGrid").addEventListener("click", (ev) => {
      const btn = ev.target.closest(".re-toggle");
      if (!btn) return;
      const id = btn.getAttribute("data-terr");
      if (expandedTerreno.has(id)) expandedTerreno.delete(id);
      else expandedTerreno.add(id);
      renderRessoTerreno();
    });

  // ---- Modal de evidencia (comentarios + fotos) --------------------------
  function findPregunta(n) {
    for (const g of D.resso) {
      for (const e of g.elementos) {
        for (const p of e.preguntas || []) {
          if (p.n === n) return { p, e, g };
        }
      }
    }
    return null;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function abrirEvidencia(n) {
    const found = findPregunta(n);
    if (!found) return;
    const { p, e, g } = found;
    const modal = $("#evidModal");
    const v = p.pct;
    const vShow = v === "NA" ? "N/A" : typeof v === "number" ? v + "%" : "Sin evaluar";
    const vColor = typeof v === "number" ? pctColor(v) : "#9aa3b2";

    const obsHtml = p.obs
      ? `<div class="evid-block"><div class="evid-block-title">Evidencia / Observaciones</div><p>${escapeHtml(p.obs).replace(/\n/g, "<br>")}</p></div>`
      : "";
    const responsableHtml = p.responsable
      ? `<div class="evid-block"><div class="evid-block-title">Responsable</div><p>${escapeHtml(p.responsable)}${p.link ? ` · <a class="evid-link" href="${escapeHtml(p.link)}" target="_blank" rel="noopener">${escapeHtml(p.link)} ↗</a>` : ""}</p></div>`
      : "";
    const comentariosHtml = p.comentarios && p.comentarios.length
      ? `<div class="evid-block"><div class="evid-block-title">Seguimiento</div>` +
        p.comentarios
          .map((c) => `<p><strong>${escapeHtml(c.fecha)}:</strong> ${escapeHtml(c.texto).replace(/\n/g, "<br>")}</p>`)
          .join("") +
        `</div>`
      : "";
    const auditorHtml = p.obsAuditor
      ? `<div class="evid-block evid-auditor"><div class="evid-block-title">Observaciones del Auditor</div><p>${escapeHtml(p.obsAuditor).replace(/\n/g, "<br>")}</p></div>`
      : "";
    const rutaHtml = p.ruta
      ? `<div class="evid-block"><div class="evid-block-title">Ruta de evidencia</div><a class="evid-link" href="${escapeHtml(p.ruta)}" target="_blank" rel="noopener">Abrir carpeta en SharePoint ↗</a></div>`
      : "";
    const imgsHtml = p.imgs && p.imgs.length
      ? `<div class="evid-block"><div class="evid-block-title">Fotografías (${p.imgs.length})</div><div class="evid-thumbs">` +
        p.imgs
          .map((src, i) => `<img class="evid-thumb" src="${src}" data-img="${i}" alt="Foto ${i + 1}">`)
          .join("") +
        `</div></div>`
      : "";
    const sinEvid = !obsHtml && !responsableHtml && !comentariosHtml && !auditorHtml && !rutaHtml && !imgsHtml
      ? `<div class="evid-empty">Esta pregunta no tiene evidencia ni comentarios cargados.</div>`
      : "";

    modal.querySelector(".evid-body").innerHTML = `
      <div class="evid-head">
        <div class="evid-tag" style="background:${g.color}">${e.id} · ${g.ciclo}</div>
        <div class="evid-score" style="color:${vColor}">${vShow}</div>
      </div>
      <div class="evid-question"><strong>Pregunta ${p.n}.</strong> ${escapeHtml(p.texto)}</div>
      ${responsableHtml}
      ${obsHtml}
      ${comentariosHtml}
      ${auditorHtml}
      ${rutaHtml}
      ${imgsHtml}
      ${sinEvid}`;

    // Lightbox de imágenes
    modal.querySelectorAll(".evid-thumb").forEach((img) => {
      img.addEventListener("click", () => abrirLightbox(img.getAttribute("src")));
    });

    modal.classList.add("open");
    document.body.style.overflow = "hidden";
  }

  function cerrarEvidencia() {
    $("#evidModal").classList.remove("open");
    document.body.style.overflow = "";
  }

  function abrirLightbox(src) {
    const lb = $("#imgLightbox");
    lb.querySelector("img").src = src;
    lb.classList.add("open");
  }
  function cerrarLightbox() {
    $("#imgLightbox").classList.remove("open");
  }

  $("#evidModal").addEventListener("click", (ev) => {
    if (ev.target.closest("[data-close-evid]") || ev.target.id === "evidModal") {
      cerrarEvidencia();
    }
  });
  $("#imgLightbox").addEventListener("click", cerrarLightbox);
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      cerrarLightbox();
      cerrarEvidencia();
    }
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
    if (!cont) return;

    const turnoSelect = $("#rimTurnoFilter");
    if (turnoSelect && turnoSelect.options.length <= 1) {
      const turnos = [...new Set((D.turnos || []).map((p) => p.turno).filter(Boolean))].sort();
      turnos.forEach((t) => {
        const o = document.createElement("option");
        o.value = t;
        o.textContent = t;
        turnoSelect.appendChild(o);
      });
      turnoSelect.addEventListener("change", () => {
        renderCursos();
        renderPlanReglamentos();
      });
    }
    const turnoFiltro = turnoSelect ? turnoSelect.value : "";

    const rimCourses = RIM_FORM_DEFS.map((form) => {
      const summary = buildRimRosterSummary(form.id, turnoFiltro);
      return {
        nombre: `${form.short} · ${form.label}`,
        total: summary.total,
        cumplen: summary.aprobados,
        directos: summary.aprobadosDirectos,
        reevaluados: summary.aprobadosReeval,
        faltan: summary.faltan,
        pct: summary.pct,
      };
    });

    const REEVAL_COLOR = "#20b2aa";

    cont.innerHTML = rimCourses
      .map((c) => {
        const pct = typeof c.pct === "number" ? c.pct : 0;
        const color = rimPctColor(pct);
        const total = c.total || 0;
        const degDirectos = total ? (c.directos / total) * 360 : 0;
        const degReeval = total ? (c.reevaluados / total) * 360 : 0;
        const degFin = degDirectos + degReeval;
        const donutBg = c.reevaluados
          ? `conic-gradient(${color} 0deg ${degDirectos}deg, ${REEVAL_COLOR} ${degDirectos}deg ${degFin}deg, var(--line) ${degFin}deg 360deg)`
          : `conic-gradient(${color} 0deg ${degFin}deg, var(--line) ${degFin}deg 360deg)`;
        const reevalLegend = c.reevaluados
          ? `<div class="legend-item"><span class="legend-dot" style="background:${REEVAL_COLOR}"></span>Aprobados en reevaluación <span class="lg-val">${c.reevaluados}</span></div>`
          : "";
        return `
        <div class="curso-card">
          <div class="curso-donut" style="background:${donutBg}">
            <div class="curso-donut-hole">
              <span class="cd-pct" style="color:${color}">${pct}%</span>
            </div>
          </div>
          <div class="curso-info">
            <h3>${c.nombre}</h3>
            <p class="curso-meta"><strong>${c.cumplen}</strong> de <strong>${c.total}</strong> cumplen, <strong>${c.faltan || 0}</strong> faltan</p>
            <div class="curso-legend">
              <div class="legend-item"><span class="legend-dot" style="background:${color}"></span>Aprobados a la primera <span class="lg-val">${c.directos}</span></div>
              ${reevalLegend}
            </div>
          </div>
        </div>`;
      })
      .join("");
  }

  // ---- Plan de cierre de brechas: reglamentos internos de minería --------
  // Calendario Jul-Dic con avance real (Forms RIM + tarja, guiado por ENTREGA)
  // para los 3 reglamentos con formulario, y avance por difusión documental
  // para el resto. Proyecta el cierre a fin de año.
  function renderPlanReglamentos() {
    const kpis = $("#planReglamentosKpis");
    const mesesGrid = $("#planMesesGrid");
    const body = $("#planReglamentosBody");
    if (!kpis || !mesesGrid || !body || !D.reglamentos) return;

    const mesNombres = {
      7: "Julio", 8: "Agosto", 9: "Septiembre",
      10: "Octubre", 11: "Noviembre", 12: "Diciembre",
    };

    // "Hoy" del proyecto: se toma de D.generatedAt para que el plan no
    // dependa del reloj del navegador de quien mira el dashboard.
    let hoyMes = 7;
    const gm = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(D.generatedAt || "");
    if (gm && Number(gm[3]) === 2026) hoyMes = Number(gm[2]);

    const turnoSelect = $("#rimTurnoFilter");
    const turnoFiltro = turnoSelect ? turnoSelect.value : "";

    const items = D.reglamentos.map((r) => {
      // Para los reglamentos sin Forms RIM, la difusión digital recién
      // ocurre en su mes programado: no se dan por cumplidos antes de tiempo.
      const avance = r.rimFormId
        ? buildRimRosterSummary(r.rimFormId, turnoFiltro).pct
        : r.mesIndex <= hoyMes && r.difundido
        ? 100
        : 0;
      let estado = "Programado";
      if (avance >= 90) estado = "Cumplido";
      else if (r.mesIndex === hoyMes) estado = "En curso";
      else if (r.mesIndex < hoyMes) estado = "Atrasado";
      return { ...r, avance, estado };
    });

    const total = items.length;
    const cumplidos = items.filter((it) => it.estado === "Cumplido").length;
    const enCurso = items.filter((it) => it.estado === "En curso").length;
    const atrasados = items.filter((it) => it.estado === "Atrasado").length;
    const pctGlobal = total ? Math.round((cumplidos / total) * 1000) / 10 : 0;

    kpis.innerHTML = `
      <div class="card" style="border-left-color:var(--sk-blue)">
        <div class="label">Reglamentos aplicables</div>
        <div class="value">${total}</div>
      </div>
      <div class="card" style="border-left-color:var(--sk-green)">
        <div class="label">Cumplidos</div>
        <div class="value">${cumplidos}</div>
      </div>
      <div class="card" style="border-left-color:#f0a500">
        <div class="label">En curso (${mesNombres[hoyMes] || "—"})</div>
        <div class="value">${enCurso}</div>
      </div>
      <div class="card" style="border-left-color:var(--sk-red)">
        <div class="label">Atrasados</div>
        <div class="value">${atrasados}</div>
      </div>
      <div class="card" style="border-left-color:var(--sk-blue-dark)">
        <div class="label">Avance global</div>
        <div class="value">${pctGlobal}%</div>
      </div>`;

    mesesGrid.innerHTML = Object.keys(mesNombres)
      .map((mIdxStr) => {
        const mIdx = Number(mIdxStr);
        const delMes = items.filter((it) => it.mesIndex === mIdx);
        const cumplenMes = delMes.filter((it) => it.estado === "Cumplido").length;
        const pctMes = delMes.length ? Math.round((cumplenMes / delMes.length) * 100) : 0;
        const cls = mIdx === hoyMes ? "plan-mes-card is-current" : "plan-mes-card";
        return `
        <div class="${cls}">
          <div class="pm-title">${mesNombres[mIdx]}</div>
          <div class="pm-count">${cumplenMes} / ${delMes.length} reglamentos</div>
          <div class="bar-track"><span class="bar-fill" style="width:${pctMes}%"></span></div>
        </div>`;
      })
      .join("");

    body.innerHTML = items
      .map((it, i) => {
        const tagCls =
          it.estado === "Cumplido" ? "tag-ok" :
          it.estado === "En curso" ? "tag-warn" :
          it.estado === "Atrasado" ? "tag-pending" : "tag-future";
        return `
        <tr>
          <td>${i + 1}</td>
          <td><strong>${it.codigo}</strong></td>
          <td>${it.nombre}</td>
          <td>${mesNombres[it.mesIndex] || "—"}</td>
          <td>${it.rimFormId ? "Forms RIM" : "Difusión documental"}</td>
          <td><strong>${it.avance}%</strong></td>
          <td><span class="tag ${tagCls}">${it.estado}</span></td>
        </tr>`;
      })
      .join("");
  }

  // ---- Tabla de personal y cursos (estilo SKIONLINE) ---------------------
  function renderPersonal() {
    if (!D.personal) return;
    const search = $("#perSearch");
    const filter = $("#perFilter");
    const tbody = $("#perTableBody");
    const count = $("#perCount");
    if (!tbody) return;

    const cursos = (D.cursos || []).filter((c) => c.id !== "DIFUSION");
    const reportsByPerson = new Map();
    (D.reportes || []).forEach((r) => {
      const key = cleanRutKey(r.rutKey) || normKey(r.nombre);
      if (!key) return;
      if (!reportsByPerson.has(key)) reportsByPerson.set(key, []);
      reportsByPerson.get(key).push(r);
    });

    function getRimStatus(person, formId) {
      const key = personMatchKey(person);
      const records = reportsByPerson.get(key) || [];
      return rimStatusFromRecords(records, formId);
    }

    function getRimSummary(person) {
      const statuses = RIM_FORM_DEFS.map((form) => getRimStatus(person, form.id));
      return {
        pending: statuses.some((s) => s === "PENDIENTE"),
        repro: statuses.some((s) => s === "REPROBADO"),
      };
    }

    function apply() {
      const q = (search.value || "").trim().toLowerCase();
      const f = filter.value; // "" | curso id (no cumple)
      const rows = D.personal.filter((p) => {
        const matchQ =
          !q ||
          (p.nombre && p.nombre.toLowerCase().includes(q)) ||
          (p.rut && p.rut.toLowerCase().includes(q)) ||
          (p.cargo && p.cargo.toLowerCase().includes(q));
        const rimSummary = getRimSummary(p);
        const matchF =
          !f ||
          (f === "IRL" && p.cursos.IRL === false) ||
          (f === "RIM" && rimSummary.pending) ||
          (f === "RIM_REPROBADO" && rimSummary.repro);
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
          const rimCeldas = RIM_FORM_DEFS.map((form) => {
            const status = getRimStatus(p, form.id);
            const label =
              status === "APROBADO"
                ? "Cumple"
                : status === "REPROBADO"
                ? "Reprobado"
                : "Pendiente";
            return `<td class="cell-center"><span class="tag ${
              status === "APROBADO" ? "tag-ok" : "tag-pending"
            }">${label}</span></td>`;
          }).join("");
          return `
          <tr>
            <td>${i + 1}</td>
            <td><strong>${p.nombre}</strong></td>
            <td>${p.cargo || "—"}</td>
            ${celdas}
            ${rimCeldas}
          </tr>`;
        })
        .join("");

      count.textContent =
        rows.length + (rows.length === 1 ? " persona" : " personas");

      const approvedByForm = RIM_FORM_DEFS.map((form) => ({
        short: form.short,
        summary: buildRimRosterSummary(form.id),
      }));

      const rimDone = $("#perRimDone");
      const rimMiss = $("#perRimMiss");
      const rimRepro = $("#perRimRepro");
      if (rimDone) rimDone.textContent = `${approvedByForm[0].short}: ${approvedByForm[0].summary.aprobados} cumplen / ${approvedByForm[0].summary.faltan} faltan`;
      if (rimMiss) rimMiss.textContent = `${approvedByForm[1].short}: ${approvedByForm[1].summary.aprobados} cumplen / ${approvedByForm[1].summary.faltan} faltan`;
      if (rimRepro) rimRepro.textContent = `${approvedByForm[2].short}: ${approvedByForm[2].summary.aprobados} cumplen / ${approvedByForm[2].summary.faltan} faltan`;
    }

    search.addEventListener("input", apply);
    filter.addEventListener("change", apply);
    apply();
  }

  $("#printBtn").addEventListener("click", () => window.print());

  // ---- Navegación por secciones (menú principal → vistas) ----------------
  function setupNav() {
    const views = Array.prototype.slice.call(document.querySelectorAll(".view"));
    function show(id) {
      views.forEach((v) => { v.hidden = v.id !== id; });
      window.scrollTo(0, 0);
    }
    document.querySelectorAll("[data-goto]").forEach((btn) =>
      btn.addEventListener("click", () => show(btn.getAttribute("data-goto")))
    );
    document.querySelectorAll("[data-back]").forEach((btn) =>
      btn.addEventListener("click", () => show("homeView"))
    );
    show("homeView");
  }

  // ---- Incidentes y medidas correctivas ----------------------------------
  function renderIncidentes() {
    const data = D.incidentes;
    if (!data || !data.length) return;

    const norm = (s) =>
      String(s || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");

    const estadoColor = (e) => {
      const n = norm(e);
      if (n.indexOf("cerrad") > -1) return "#2e8b57";
      if (n.indexOf("proceso") > -1) return "#f0a500";
      if (n.indexOf("pendiente") > -1) return "#e1251b";
      if (n.indexOf("abierto") > -1) return "#e1251b";
      return "#9aa3b2";
    };

    // Interpreta el estado de verificacion (tolera el typo "PENIDENTE").
    const verifInfo = (v) => {
      const n = norm(v);
      if (!n) return { txt: "—", col: "#9aa3b2" };
      if (n.indexOf("verificad") > -1) return { txt: "Verificada", col: "#2e8b57" };
      if (n.indexOf("no aplica") > -1) return { txt: "No aplica", col: "#9aa3b2" };
      if (n.indexOf("penid") > -1 || n.indexOf("pendient") > -1)
        return { txt: "Pendiente", col: "#f0a500" };
      return { txt: String(v), col: "#5d6b82" };
    };

    // Un incidente esta "cerrado" si tiene medidas y todas estan cerradas.
    const incCerrado = (it) =>
      it.medidas.length > 0 &&
      it.medidas.every((m) => norm(m.estatus).indexOf("cerrad") > -1);

    // ---- KPIs ----
    const totalInc = data.length;
    let totalMed = 0,
      medCerradas = 0;
    data.forEach((it) =>
      it.medidas.forEach((m) => {
        totalMed++;
        if (norm(m.estatus).indexOf("cerrad") > -1) medCerradas++;
      })
    );
    const incPend = data.filter((it) => !incCerrado(it)).length;
    const pctCerr = totalMed ? Math.round((medCerradas / totalMed) * 100) : 0;

    const kpis = [
      { label: "Incidentes registrados", value: totalInc, accent: "#24407a" },
      { label: "Medidas correctivas", value: totalMed, accent: "#24407a" },
      { label: "Medidas cerradas", value: pctCerr + "%", accent: pctColor(pctCerr) },
      { label: "Incidentes con pendientes", value: incPend, accent: incPend ? "#e1251b" : "#2e8b57" },
    ];
    $("#incKpis").innerHTML = kpis
      .map(
        (c) =>
          `<div class="card" style="--accent:${c.accent}"><div class="label">${c.label}</div><div class="value">${c.value}</div></div>`
      )
      .join("");

    // ---- Barras por categoria ----
    const catMap = {};
    data.forEach((it) => {
      const c = it.categoria || "SIN CATEGORÍA";
      catMap[c] = (catMap[c] || 0) + 1;
    });
    const catArr = Object.keys(catMap)
      .map((k) => ({ cat: k, n: catMap[k] }))
      .sort((a, b) => b.n - a.n);
    const maxCat = catArr.reduce((m, x) => Math.max(m, x.n), 0) || 1;
    $("#incCatBars").innerHTML = catArr
      .map(
        (x) => `
        <div class="bar-row">
          <div class="bar-top">
            <span class="bar-name">${escapeHtml(x.cat)}</span>
            <span class="bar-val">${x.n}</span>
          </div>
          <div class="bar-track"><span class="bar-fill" style="width:${
            (x.n / maxCat) * 100
          }%;background:#24407a"></span></div>
        </div>`
      )
      .join("");

    // ---- Donut estado de medidas ----
    const estMap = {};
    data.forEach((it) =>
      it.medidas.forEach((m) => {
        const e = (m.estatus || "SIN ESTADO").toUpperCase();
        estMap[e] = (estMap[e] || 0) + 1;
      })
    );
    const estArr = Object.keys(estMap).map((k) => ({
      label: k,
      value: estMap[k],
      color: estadoColor(k),
    }));
    const totEst = estArr.reduce((s, e) => s + e.value, 0);
    const donut = $("#incEstadoDonut");
    let acc = 0;
    const segs = estArr
      .filter((e) => e.value > 0)
      .map((e) => {
        const start = (acc / totEst) * 360;
        acc += e.value;
        const end = (acc / totEst) * 360;
        return `${e.color} ${start}deg ${end}deg`;
      })
      .join(", ");
    donut.style.background = totEst ? `conic-gradient(${segs})` : "var(--line)";
    donut.setAttribute("data-total", totEst);
    $("#incEstadoLegend").innerHTML = estArr
      .map(
        (e) => `
        <div class="legend-item">
          <span class="legend-dot" style="background:${e.color}"></span>
          <span>${escapeHtml(e.label)}</span>
          <span class="lg-val">${e.value}</span>
        </div>`
      )
      .join("");

    // ---- Filtros (poblar selects una vez) ----
    const selCat = $("#incCat");
    const selTurno = $("#incTurno");
    if (selCat && selCat.options.length <= 1) {
      catArr
        .map((x) => x.cat)
        .sort()
        .forEach((c) => {
          const o = document.createElement("option");
          o.value = c;
          o.textContent = c;
          selCat.appendChild(o);
        });
    }
    if (selTurno && selTurno.options.length <= 1) {
      [...new Set(data.map((it) => it.turno).filter(Boolean))]
        .sort()
        .forEach((t) => {
          const o = document.createElement("option");
          o.value = t;
          o.textContent = t;
          selTurno.appendChild(o);
        });
    }

    const search = $("#incSearch");
    const results = $("#incResults");
    const count = $("#incCount");
    const clearChartsBtn = $("#incClearFilters");
    const selEstado = $("#incEstado");
    const open = new Set();
    const chartFilter = { month: "", pattern: "", medTheme: "" };
    let patternMembers = {};

    const parseFecha = (s) => {
      const m = String(s || "").match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
      if (!m) return null;
      const d = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10) - 1;
      const y = parseInt(m[3], 10);
      const dt = new Date(y, mo, d);
      if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d)
        return null;
      return dt;
    };

    const monthKey = (dt) =>
      dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0");

    const monthLabel = (k) => {
      const m = String(k).match(/^(\d{4})-(\d{2})$/);
      if (!m) return k;
      const y = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10) - 1;
      const names = [
        "Ene",
        "Feb",
        "Mar",
        "Abr",
        "May",
        "Jun",
        "Jul",
        "Ago",
        "Sep",
        "Oct",
        "Nov",
        "Dic",
      ];
      return names[mo] + " " + y;
    };

    function buildTrend(rows) {
      const map = {};
      rows.forEach((it) => {
        const dt = parseFecha(it.fecha);
        if (!dt) return;
        const mk = monthKey(dt);
        map[mk] = (map[mk] || 0) + 1;
      });
      const keys = Object.keys(map).sort();
      const points = keys.map((k) => ({ key: k, n: map[k] }));
      let acc = 0;
      points.forEach((p, i) => {
        acc += p.n;
        p.acc = acc;
        const start = Math.max(0, i - 2);
        const slice = points.slice(start, i + 1);
        const avg = slice.reduce((s, x) => s + x.n, 0) / slice.length;
        p.avg3 = Math.round(avg * 10) / 10;
      });
      return points;
    }

    function renderTrend(rows) {
      const cont = $("#incTrendChart");
      if (!cont) return;
      const points = buildTrend(rows);
      if (!points.length) {
        cont.innerHTML =
          '<div class="rep-empty">No hay fechas válidas para construir la tendencia.</div>';
        return;
      }

      const total = points.reduce((s, p) => s + p.n, 0);
      const maxN = Math.max.apply(
        null,
        points.map((p) => p.n).concat([1])
      );
      const maxAvg = Math.max.apply(
        null,
        points.map((p) => p.avg3).concat([1])
      );
      const maxY = Math.max(maxN, maxAvg);
      const top = points.reduce((a, b) => (a.n >= b.n ? a : b));

      const w = 760;
      const h = 240;
      const padX = 34;
      const padY = 24;
      const step = points.length > 1 ? (w - padX * 2) / (points.length - 1) : 0;
      const x = (i) => padX + i * step;
      const y = (v) => h - padY - (v / maxY) * (h - padY * 2);

      const pointsN = points.map((p, i) => x(i) + "," + y(p.n)).join(" ");
      const pointsAvg = points.map((p, i) => x(i) + "," + y(p.avg3)).join(" ");

      const dotsN = points
        .map(
          (p, i) =>
            `<circle cx="${x(i)}" cy="${y(p.n)}" r="3" class="inc-line-dot inc-line-dot-n" title="${monthLabel(p.key)}: ${p.n}"></circle>`
        )
        .join("");
      const dotsAvg = points
        .map(
          (p, i) =>
            `<circle cx="${x(i)}" cy="${y(p.avg3)}" r="2.6" class="inc-line-dot inc-line-dot-avg" title="${monthLabel(p.key)}: prom ${String(p.avg3).replace(".", ",")}"></circle>`
        )
        .join("");

      const grid = [0.25, 0.5, 0.75, 1]
        .map((g) => {
          const yy = h - padY - g * (h - padY * 2);
          return `<line x1="${padX}" y1="${yy}" x2="${w - padX}" y2="${yy}" class="inc-line-grid"></line>`;
        })
        .join("");

      const labels = points
        .map(
          (p) =>
            `<span class="inc-trend-label${chartFilter.month === p.key ? " active" : ""}" data-month="${p.key}" title="Filtrar registro por ${monthLabel(p.key)}">${monthLabel(p.key)}<small>${p.n}</small></span>`
        )
        .join("");

      cont.innerHTML = `
        <div class="inc-trend-kpis">
          <span class="mini-chip">Meses con incidentes: ${points.length}</span>
          <span class="mini-chip">Total filtrado: ${total}</span>
          <span class="mini-chip">Mes pico: ${monthLabel(top.key)} (${top.n})</span>
        </div>
        <div class="inc-trend-legend">
          <span><i class="lg-line lg-line-n"></i> Incidentes mensuales</span>
          <span><i class="lg-line lg-line-avg"></i> Promedio móvil (3 meses)</span>
        </div>
        <div class="inc-trend-svg-wrap" role="img" aria-label="Curva comparativa horizontal de tendencia de incidentes">
          <svg viewBox="0 0 ${w} ${h}" class="inc-trend-svg">
            <line x1="${padX}" y1="${h - padY}" x2="${w - padX}" y2="${h - padY}" class="inc-line-axis"></line>
            <line x1="${padX}" y1="${padY}" x2="${padX}" y2="${h - padY}" class="inc-line-axis"></line>
            ${grid}
            <polyline points="${pointsN}" class="inc-line-poly-n"></polyline>
            <polyline points="${pointsAvg}" class="inc-line-poly-avg"></polyline>
            ${dotsN}
            ${dotsAvg}
          </svg>
        </div>
        <div class="inc-trend-labels">${labels}</div>
        <div class="inc-trend-note">
          Comparación de curva mensual vs su promedio móvil para visualizar cambios y patrones en el tiempo.
        </div>`;
    }

    const stopWords = new Set([
      "de",
      "la",
      "el",
      "los",
      "las",
      "por",
      "para",
      "con",
      "sin",
      "una",
      "uno",
      "unos",
      "unas",
      "del",
      "que",
      "al",
      "se",
      "en",
      "un",
      "su",
      "sus",
      "durante",
      "desde",
      "sobre",
      "entre",
      "hacia",
      "tras",
      "trabajador",
      "trabajadores",
      "equipo",
      "camioneta",
      "minibus",
      "mini",
      "bus",
      "dano",
      "material",
      "nivel",
      "evento",
    ]);

    const medidaDefs = [
      {
        id: "capacitacion",
        label: "CAPACITACIÓN",
        terms: ["taller", "capacit", "reinstru", "difusion", "boletin", "refuerza"],
        desc: "Medidas orientadas a formar o reforzar conductas seguras en personas.",
        ej: "Ej.: taller de percepción del riesgo, difusión del evento, refuerzo de manejo defensivo.",
      },
      {
        id: "administrativas",
        label: "ADMINISTRATIVAS",
        terms: ["sancion", "administrativa", "nota interna", "obligatorio", "reporte"],
        desc: "Medidas de gestión interna, control documental o acciones disciplinarias.",
        ej: "Ej.: nota interna obligatoria, sanción administrativa, exigencia de reporte inmediato.",
      },
      {
        id: "operacionales",
        label: "OPERACIONALES",
        terms: ["inspeccion", "control", "caminatas", "procedimiento", "planificacion"],
        desc: "Medidas aplicadas en la ejecución diaria de tareas y supervisión en terreno.",
        ej: "Ej.: caminatas de control, mejorar planificación, reforzar procedimiento operativo.",
      },
      {
        id: "ingenieria",
        label: "INGENIERÍA",
        terms: ["repar", "cortar", "instalar", "manguera", "mantencion", "mejorar"],
        desc: "Medidas técnicas sobre equipos, infraestructura o condiciones físicas del trabajo.",
        ej: "Ej.: cortar perno sobredimensionado, reparación de líneas, instalación/mejora técnica.",
      },
    ];

    const clasificarMedida = (txt) => {
      const t = norm(txt || "");
      for (let i = 0; i < medidaDefs.length; i++) {
        if (medidaDefs[i].terms.some((k) => t.indexOf(k) > -1)) return medidaDefs[i].id;
      }
      return "operacionales";
    };

    const tokensFromName = (name) => {
      const raw = norm(name || "").replace(/[^a-z0-9\s]/g, " ");
      return raw
        .split(/\s+/)
        .filter((t) => t && t.length >= 4 && !stopWords.has(t) && !/^\d+$/.test(t));
    };

    const jaccard = (a, b) => {
      let inter = 0;
      a.forEach((x) => {
        if (b.has(x)) inter++;
      });
      const uni = a.size + b.size - inter;
      return uni ? inter / uni : 0;
    };

    function detectPatterns(rows) {
      const byTheme = {};

      const defs = [
        {
          label: "ART",
          terms: ["art", "analisis", "riesgo", "trabajo"],
        },
        {
          label: "MAQUINARIAS",
          terms: [
            "maquinaria",
            "manitou",
            "manipulador",
            "camion",
            "camioneta",
            "vehiculo",
            "minibus",
            "bus",
            "retroceso",
            "operador",
          ],
        },
        {
          label: "AGUA / SERVICIOS",
          terms: ["agua", "manguera", "lavamanos", "higienico", "servicio"],
        },
        {
          label: "CAMPAMENTO",
          terms: ["campamento", "pabellon"],
        },
        {
          label: "CONDUCCION / TRAYECTO",
          terms: ["trayecto", "conduccion", "manejo", "choque", "colision"],
        },
      ];

      const pickTheme = (it) => {
        const nameNorm = norm(it.nombre).replace(/[^a-z0-9\s]/g, " ");
        const tk = new Set(
          nameNorm
            .split(/\s+/)
            .filter((t) => t && t.length >= 3 && !stopWords.has(t))
        );

        for (let i = 0; i < defs.length; i++) {
          if (defs[i].terms.some((t) => tk.has(t) || nameNorm.indexOf(t) > -1)) {
            return defs[i].label;
          }
        }

        const first = Array.from(tk)[0];
        return first ? first.toUpperCase() : "OTROS EVENTOS";
      };

      rows.forEach((it) => {
        const th = pickTheme(it);
        if (!byTheme[th]) byTheme[th] = [];
        byTheme[th].push(it);
      });

      const groups = Object.keys(byTheme)
        .map((th) => {
          const arr = byTheme[th];
          const eventos = arr
            .map((it) => it.nombre || it.incidente || "Sin detalle")
            .filter((v, i, all) => all.indexOf(v) === i);
          const tokensFreq = {};
          arr.forEach((it) => {
            const tks = tokensFromName(it.nombre);
            tks.forEach((t) => {
              tokensFreq[t] = (tokensFreq[t] || 0) + 1;
            });
          });
          const common = Object.keys(tokensFreq)
            .filter((t) => tokensFreq[t] >= Math.ceil(arr.length * 0.4))
            .sort((a, b) => tokensFreq[b] - tokensFreq[a])
            .slice(0, 3);
          return {
            n: arr.length,
            categoria: th,
            clave: common.length
              ? "Similitud nombre: " + common.join(", ")
              : "Similitud por nombre del evento",
            eventoPrincipal: eventos[0] || "Sin detalle",
            eventos: eventos.slice(0, 5),
            ids: arr.map((it) => String(it.item)),
          };
        })
        .filter((g) => g.n >= 2)
        .sort((a, b) => b.n - a.n)
        .slice(0, 8);

      if (groups.length) return groups;

      return [
        {
          n: rows.length,
          categoria: "OTROS EVENTOS",
          clave: "Sin grupos repetidos con 2 o más casos",
          eventoPrincipal: "Revisar filtros para ampliar coincidencias",
          eventos: rows
            .map((it) => it.nombre || it.incidente || "Sin detalle")
            .slice(0, 5),
          ids: rows.map((it) => String(it.item)),
        },
      ];
    }

    function renderMedidasTrends(rows) {
      const cont = $("#incMedTrendChart");
      if (!cont) return;

      const bag = {};
      medidaDefs.forEach((d) => (bag[d.id] = { label: d.label, total: 0, cerradas: 0 }));

      rows.forEach((it) => {
        (it.medidas || []).forEach((m) => {
          const key = clasificarMedida(m.medida || "");
          bag[key].total += 1;
          if (norm(m.estatus).indexOf("cerrad") > -1) bag[key].cerradas += 1;
        });
      });

      const arr = Object.keys(bag)
        .map((k) => {
          const x = bag[k];
          const pct = x.total ? Math.round((x.cerradas / x.total) * 100) : 0;
          return { id: k, label: x.label, total: x.total, pct };
        })
        .filter((x) => x.total > 0)
        .sort((a, b) => b.total - a.total)
        .slice(0, 6);

      if (!arr.length) {
        cont.innerHTML =
          '<div class="rep-empty">No hay medidas para construir tendencias.</div>';
        return;
      }

      const maxN = Math.max.apply(
        null,
        arr.map((x) => x.total).concat([1])
      );

      const barsHtml =
        '<div class="inc-med-vbars">' +
        arr
          .map((x) => {
            const hPct = Math.max(8, Math.round((x.total / maxN) * 100));
            return `
            <div class="inc-med-item${chartFilter.medTheme === x.id ? " active" : ""}" data-med-theme="${x.id}" title="${escapeHtml(x.label)}: ${x.total} medidas · ${x.pct}% cerradas. Click para filtrar registro.">
              <div class="inc-med-n">${x.total}</div>
              <div class="inc-med-track"><span class="inc-med-fill" style="height:${hPct}%"></span></div>
              <div class="inc-med-label">${escapeHtml(x.label)}</div>
              <div class="inc-med-sub">${x.pct}% cerradas</div>
            </div>`;
          })
          .join("") +
        "</div>";

      const guideHtml =
        '<div class="inc-med-guide">' +
        '<div class="inc-med-guide-title">Cómo se clasifican las medidas</div>' +
        medidaDefs
          .map(
            (d) => `
            <div class="inc-med-guide-row">
              <div class="inc-med-guide-tag">${escapeHtml(d.label)}</div>
              <div class="inc-med-guide-text">
                <div>${escapeHtml(d.desc)}</div>
                <small>${escapeHtml(d.ej)}</small>
              </div>
            </div>`
          )
          .join("") +
        "</div>";

      cont.innerHTML = barsHtml + guideHtml;
    }

    function renderPatterns(rows) {
      const cont = $("#incPatternChart");
      if (!cont) return;
      const patterns = detectPatterns(rows);
      if (!patterns.length) {
        cont.innerHTML =
          '<div class="rep-empty">No se detectaron patrones repetidos con los filtros actuales.</div>';
        return;
      }
      const sorted = patterns.slice().sort((a, b) => b.n - a.n);
      patternMembers = {};

      const maxN = Math.max.apply(
        null,
        sorted.map((p) => p.n).concat([1])
      );
      const rowsHtml = sorted
        .map((p, i) => {
          const pid = "pat_" + i + "_" + norm(p.categoria).replace(/[^a-z0-9]+/g, "_");
          patternMembers[pid] = new Set((p.ids || []).map(String));
          const hPct = Math.max(8, Math.round((p.n / maxN) * 100));
          const sample = (p.eventos && p.eventos[0]) || p.eventoPrincipal || "Sin detalle";
          const assoc = (p.eventos || []).slice(0, 5).join(" | ");
          const tip =
            `${p.categoria}: ${p.n} eventos` +
            (assoc ? `. Asociados: ${assoc}` : "");
          return `
          <div class="inc-pv-item${chartFilter.pattern === pid ? " active" : ""}" data-pattern="${pid}" title="${escapeHtml(tip)}. Click para filtrar registro.">
            <div class="inc-pv-n">${p.n}</div>
            <div class="inc-pv-track">
              <span class="inc-pv-fill" style="height:${hPct}%"></span>
            </div>
            <div class="inc-pv-cat">${escapeHtml(p.categoria)}</div>
            <div class="inc-pv-sample">${escapeHtml(sample)}</div>
          </div>`;
        })
        .join("");

      cont.innerHTML = `<div class="inc-pattern-vbars" role="img" aria-label="Gráfico vertical de patrones similares ordenado de mayor a menor">${rowsHtml}</div>`;
    }

    function matchText(it, q) {
      if (!q) return true;
      const hay =
        norm(it.nombre) +
        " " +
        norm(it.incidente) +
        " " +
        norm(it.categoria) +
        " " +
        it.medidas.map((m) => norm(m.medida) + " " + norm(m.responsable)).join(" ");
      return hay.indexOf(q) > -1;
    }

    function monthOfIncident(it) {
      const dt = parseFecha(it.fecha);
      return dt ? monthKey(dt) : "";
    }

    function matchChartFilters(it) {
      if (chartFilter.month && monthOfIncident(it) !== chartFilter.month) return false;
      if (chartFilter.pattern) {
        const members = patternMembers[chartFilter.pattern];
        if (!members || !members.has(String(it.item))) return false;
      }
      if (chartFilter.medTheme) {
        const has = (it.medidas || []).some(
          (m) => clasificarMedida(m.medida || "") === chartFilter.medTheme
        );
        if (!has) return false;
      }
      return true;
    }

    function apply() {
      const q = norm(search.value.trim());
      const fc = selCat.value;
      const ft = selTurno.value;
      const fe = selEstado.value;
      const baseRows = data.filter((it) => {
        if (fc && it.categoria !== fc) return false;
        if (ft && it.turno !== ft) return false;
        if (fe === "cerrado" && !incCerrado(it)) return false;
        if (fe === "pendiente" && incCerrado(it)) return false;
        return matchText(it, q);
      });

      renderTrend(baseRows);
      renderPatterns(baseRows);
      renderMedidasTrends(baseRows);

      const rows = baseRows.filter(matchChartFilters);

      const activeChartFilters = [];
      if (chartFilter.month) activeChartFilters.push("Mes: " + monthLabel(chartFilter.month));
      if (chartFilter.pattern) activeChartFilters.push("Patrón seleccionado");
      if (chartFilter.medTheme) {
        const m = medidaDefs.find((d) => d.id === chartFilter.medTheme);
        activeChartFilters.push("Medida: " + (m ? m.label : chartFilter.medTheme));
      }

      if (clearChartsBtn) clearChartsBtn.disabled = activeChartFilters.length === 0;

      count.textContent =
        rows.length +
        (rows.length === 1 ? " incidente" : " incidentes") +
        (activeChartFilters.length ? " · " + activeChartFilters.join(" | ") : "");

      results.innerHTML = rows
        .map((it) => {
          const cerrado = incCerrado(it);
          const isOpen = open.has(it.item);
          const tieneAuditor =
            !!norm(it.comentarioAuditor) ||
            it.medidas.some((m) => !!norm(m.comentarioAuditor));
          const auditorMark = tieneAuditor
            ? '<span class="inc-aud-flag" title="Tiene comentarios del auditor">▲</span>'
            : "";
          const estTag = cerrado
            ? '<span class="tag tag-ok">Cerrado</span>'
            : '<span class="tag tag-pending">Con pendientes</span>';
          const medRows = it.medidas
            .map(
              (m, i) => {
                const vi = verifInfo(m.verifMedidas);
                return `
              <tr>
                <td class="cell-center">${i + 1}</td>
                <td>${escapeHtml(m.medida)}</td>
                <td>${escapeHtml(m.responsable) || "—"}</td>
                <td class="cell-center">${escapeHtml(m.fechaCierre) || "—"}</td>
                <td class="cell-center"><span class="inc-estado" style="--ec:${estadoColor(
                  m.estatus
                )}">${escapeHtml(m.estatus) || "—"}</span></td>
                <td class="cell-center"><span class="inc-verif-badge" style="--vc:${
                  vi.col
                }">${escapeHtml(vi.txt)}</span></td>
                <td>${
                  m.comentarioAuditor
                    ? escapeHtml(m.comentarioAuditor)
                    : '<span class="inc-aud-empty">—</span>'
                }</td>
              </tr>`;
              }
            )
            .join("");
          const sinMed = !it.medidas.length
            ? '<tr><td colspan="7" class="inc-empty">Sin medidas correctivas registradas.</td></tr>'
            : "";
          return `
            <div class="inc-card${isOpen ? " open" : ""}" data-item="${escapeHtml(
            it.item
          )}">
              <button type="button" class="inc-head" data-toggle="${escapeHtml(
                it.item
              )}">
                <span class="inc-caret">▸</span>
                <span class="inc-cat">${escapeHtml(it.categoria)}</span>
                <span class="inc-title">${auditorMark}${escapeHtml(it.nombre)}</span>
                <span class="inc-meta">${escapeHtml(it.fecha)} · ${escapeHtml(
            it.turno
          )} · ${it.medidas.length} ${
            it.medidas.length === 1 ? "medida" : "medidas"
          }</span>
                ${estTag}
              </button>
              <div class="inc-body"${isOpen ? "" : " hidden"}>
                <div class="inc-desc"><strong>Incidente:</strong> ${escapeHtml(
                  it.incidente
                )}</div>
                <div class="table-wrap">
                  <table class="records-table inc-med-table">
                    <thead>
                      <tr>
                        <th class="cell-center">N°</th>
                        <th>Medida correctiva</th>
                        <th>Responsable</th>
                        <th class="cell-center">Fecha cierre</th>
                        <th class="cell-center">Estado</th>
                        <th class="cell-center">Verificada</th>
                        <th>Comentario auditor</th>
                      </tr>
                    </thead>
                    <tbody>${medRows}${sinMed}</tbody>
                  </table>
                </div>
                ${
                  it.verifMedidas || it.verifEficacia || it.comentarios || it.comentarioAuditor
                    ? `<div class="inc-verif">
                        ${
                          it.verifMedidas
                            ? `<span class="mini-chip" style="--vc:${
                                verifInfo(it.verifMedidas).col
                              }">Verif. medidas: ${escapeHtml(
                                verifInfo(it.verifMedidas).txt
                              )}</span>`
                            : ""
                        }
                        ${
                          it.verifEficacia
                            ? `<span class="mini-chip" style="--vc:${
                                verifInfo(it.verifEficacia).col
                              }">Verif. eficacia: ${escapeHtml(
                                verifInfo(it.verifEficacia).txt
                              )}</span>`
                            : ""
                        }
                        ${
                          it.comentarios
                            ? `<span class="mini-chip alt">${escapeHtml(
                                it.comentarios
                              )}</span>`
                            : ""
                        }
                        ${
                          it.comentarioAuditor
                            ? `<span class="mini-chip aud"><strong>Auditor:</strong> ${escapeHtml(
                                it.comentarioAuditor
                              )}</span>`
                            : ""
                        }
                      </div>`
                    : ""
                }
              </div>
            </div>`;
        })
        .join("");

      if (!rows.length) {
        results.innerHTML =
          '<div class="inc-empty-state">No se encontraron incidentes con los filtros aplicados.</div>';
      }
    }

    results.addEventListener("click", (ev) => {
      const head = ev.target.closest(".inc-head");
      if (!head) return;
      const id = head.getAttribute("data-toggle");
      if (open.has(id)) open.delete(id);
      else open.add(id);
      apply();
    });

    const trendBox = $("#incTrendChart");
    if (trendBox) {
      trendBox.addEventListener("click", (ev) => {
        const el = ev.target.closest("[data-month]");
        if (!el) return;
        const mk = el.getAttribute("data-month") || "";
        chartFilter.month = chartFilter.month === mk ? "" : mk;
        apply();
      });
    }

    const patternBox = $("#incPatternChart");
    if (patternBox) {
      patternBox.addEventListener("click", (ev) => {
        const el = ev.target.closest("[data-pattern]");
        if (!el) return;
        const pid = el.getAttribute("data-pattern") || "";
        chartFilter.pattern = chartFilter.pattern === pid ? "" : pid;
        apply();
      });
    }

    const medBox = $("#incMedTrendChart");
    if (medBox) {
      medBox.addEventListener("click", (ev) => {
        const el = ev.target.closest("[data-med-theme]");
        if (!el) return;
        const mid = el.getAttribute("data-med-theme") || "";
        chartFilter.medTheme = chartFilter.medTheme === mid ? "" : mid;
        apply();
      });
    }

    if (clearChartsBtn) {
      clearChartsBtn.addEventListener("click", () => {
        chartFilter.month = "";
        chartFilter.pattern = "";
        chartFilter.medTheme = "";
        apply();
      });
    }

    search.addEventListener("input", apply);
    selCat.addEventListener("change", apply);
    selTurno.addEventListener("change", apply);
    selEstado.addEventListener("change", apply);
    apply();
  }

  // ---- Init ---------------------------------------------------------------
  renderContract();
  renderKpis();
  renderResso();
  renderRessoTerreno();
  renderBars();
  renderDonut();
  renderAccess();
  renderReglamentos();
  renderAbc();
  renderCursos();
  renderPlanReglamentos();
  renderPersonal();
  renderIncidentes();
  setupNav();
})();
