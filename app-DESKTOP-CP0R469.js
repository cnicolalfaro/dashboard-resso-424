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

  // Cumplimiento documental ponderado por peso (igual que el Excel):
  // suma de aportes (peso * eval / 100) sobre la suma total de pesos.
  // Las preguntas N/A o sin evaluar aportan 0 pero su peso sí cuenta.
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
    return pesoTotal ? Math.round((aporte / pesoTotal) * 100) : 0;
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
                    const pesoShow = typeof p.peso === "number"
                      ? `<div class="preg-peso" title="Ponderado">${String(p.peso).replace(".", ",")}%</div>`
                      : `<div class="preg-peso"></div>`;
                    const nImg = p.imgs && p.imgs.length ? p.imgs.length : 0;
                    const tieneEvid = !!(p.obs || p.obsAuditor || p.ruta || nImg);
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
    const sinEvid = !obsHtml && !auditorHtml && !rutaHtml && !imgsHtml
      ? `<div class="evid-empty">Esta pregunta no tiene evidencia ni comentarios cargados.</div>`
      : "";

    modal.querySelector(".evid-body").innerHTML = `
      <div class="evid-head">
        <div class="evid-tag" style="background:${g.color}">${e.id} · ${g.ciclo}</div>
        <div class="evid-score" style="color:${vColor}">${vShow}</div>
      </div>
      <div class="evid-question"><strong>Pregunta ${p.n}.</strong> ${escapeHtml(p.texto)}</div>
      ${obsHtml}
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
    const cargoVals = (() => {
      const s = new Set();
      D.reportes.forEach((r) => r.cargoTarja && s.add(r.cargoTarja));
      (D.turnos || []).forEach((p) => p.cargo && s.add(p.cargo));
      return [...s].sort();
    })();
    const turnoMS = makeMultiSelect("repTurno", turnosVals, "Todos");
    const rfMS = makeMultiSelect("repRf", rfVals, "Todos");
    const cargoMS = makeMultiSelect("repCargo", cargoVals, "Todos");

    // Personas que están en turnos (tarja) pero NO entregaron reporte
    function missingList() {
      const turnos = turnoMS.get();
      const cargos = cargoMS.get();
      return (D.turnos || []).filter((p) => {
        if (turnos.length && turnos.indexOf(p.turno) === -1) return false;
        if (cargos.length && cargos.indexOf(p.cargo) === -1) return false;
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

      const totalR = dataset.length;

      // Arma barras a partir de un conteo {clave: n}
      function buildBars(counts) {
        const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        const maxV = entries.length ? entries[0][1] : 1;
        return entries.length
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
      }

      // Distribución de respuestas (campo p1: evento / hallazgo)
      const counts = {};
      dataset.forEach((r) => {
        const k = (r.p1 || "—").toString().trim().toUpperCase() || "—";
        counts[k] = (counts[k] || 0) + 1;
      });
      const barsHtml = buildBars(counts);

      // Distribución por RF (campo rc)
      const rfCounts = {};
      dataset.forEach((r) => {
        const k = (r.rc || "S/RF").toString().trim().toUpperCase() || "S/RF";
        rfCounts[k] = (rfCounts[k] || 0) + 1;
      });
      const rfBarsHtml = buildBars(rfCounts);

      // Cumplimiento: en turno con reporte vs. sin reporte (respeta filtro de turno y cargo)
      const turnosSel = turnoMS.get();
      const cargosSel = cargoMS.get();
      const totalTurnos = (D.turnos || []).filter(
        (p) =>
          (!turnosSel.length || turnosSel.indexOf(p.turno) !== -1) &&
          (!cargosSel.length || cargosSel.indexOf(p.cargo) !== -1)
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
          <div class="rep-chart-title">Riesgos Fatales (RF) reportados</div>
          <div class="rep-bars">${rfBarsHtml}</div>
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
      const cargos = cargoMS.get();

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
        if (cargos.length && cargos.indexOf(r.cargoTarja) === -1) return false;
        return true;
      });
      renderRepCharts(overview);

      if (!raw && !semana && !turnos.length && !rfs.length && !cargos.length) {
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
        if (cargos.length && cargos.indexOf(r.cargoTarja) === -1) return false;
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
    const selEstado = $("#incEstado");
    const open = new Set();

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

    function apply() {
      const q = norm(search.value.trim());
      const fc = selCat.value;
      const ft = selTurno.value;
      const fe = selEstado.value;
      const rows = data.filter((it) => {
        if (fc && it.categoria !== fc) return false;
        if (ft && it.turno !== ft) return false;
        if (fe === "cerrado" && !incCerrado(it)) return false;
        if (fe === "pendiente" && incCerrado(it)) return false;
        return matchText(it, q);
      });

      count.textContent =
        rows.length + (rows.length === 1 ? " incidente" : " incidentes");

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
  renderBars();
  renderDonut();
  renderAccess();
  renderReglamentos();
  renderAbc();
  renderCursos();
  renderPersonal();
  renderReportes();
  renderIncidentes();
  setupNav();
})();
