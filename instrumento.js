// =============================================================================
//  Instrumento RESSO V10 — Página standalone (sin login, solo documental)
//  Subconjunto de app.js: KPIs + Cumplimiento RESSO (PHVA) + modal de evidencia.
// =============================================================================
(function () {
  "use strict";

  const D = window.DASHBOARD_DATA;
  if (!D || !D.resso) {
    console.error("No se encontró DASHBOARD_DATA.resso");
    return;
  }

  const $ = (sel) => document.querySelector(sel);

  function pctColor(p) {
    if (p >= 90) return "#2e8b57";
    if (p >= 70) return "#f0a500";
    return "#e1251b";
  }

  $("#updatedAt").textContent = "Actualizado: " + D.generatedAt;

  // ---- Cálculo de porcentajes (preguntas → elemento → grupo), ponderado
  // siempre por peso, de abajo hacia arriba (ver app.js para más contexto). --
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

  function elementPct(e) {
    if (!e.preguntas || e.preguntas.length === 0) return e.pct;
    const { aporte, pesoTotal } = pesoPonderado(e.preguntas);
    if (!pesoTotal) return e.pct;
    return Math.round((aporte / pesoTotal) * 100);
  }

  function groupPct(grupo) {
    const preguntas = [];
    grupo.elementos.forEach((e) => preguntas.push(...(e.preguntas || [])));
    const { aporte, pesoTotal } = pesoPonderado(preguntas);
    return pesoTotal ? Math.round((aporte / pesoTotal) * 100) : 0;
  }

  function groupPeso(grupo) {
    let total = 0;
    grupo.elementos.forEach((e) =>
      (e.preguntas || []).forEach((p) => {
        if (typeof p.peso === "number") total += p.peso;
      })
    );
    return Math.round(total * 100) / 100;
  }

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

  // ---- KPI cards ----------------------------------------------------------
  function renderKpis() {
    const k = D.kpis;
    const doc = documentalPct();
    const total = Math.round(doc);
    const expClass = "exp-" + (k.nivelExposicion || "").toLowerCase().replace(/[^a-z]/g, "");
    const cards = [
      { label: "Cumplimiento documental", value: Math.round(doc) + "%", accent: pctColor(doc) },
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

  // ---- Evolución documental (histórico mensual + hoy en vivo) -------------
  function renderHistorial() {
    const el = $("#historialBars");
    if (!el || !D.historialDocumental) return;
    const puntos = [...D.historialDocumental, { mes: "Hoy", pct: documentalPct() }];
    el.innerHTML = puntos
      .map((p) => {
        const pct = Math.round(p.pct * 10) / 10;
        return `
        <div class="bar-row">
          <div class="bar-top">
            <span class="bar-name">${p.mes}</span>
            <span class="bar-val">${pct}%</span>
          </div>
          <div class="bar-track"><span class="bar-fill" style="width:${pct}%;background:${pctColor(pct)}"></span></div>
        </div>`;
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
                    const tieneEvid = !!(p.responsable || (p.comentarios && p.comentarios.length));
                    const evidBtn = tieneEvid
                      ? `<button class="preg-evid" data-evid="${p.n}" title="Ver responsable y seguimiento">💬</button>`
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

  // ---- Interacción: desplegar/colapsar preguntas + modal de evidencia ----
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
    const sinEvid = !responsableHtml && !comentariosHtml
      ? `<div class="evid-empty">Esta pregunta no tiene responsable ni comentarios cargados.</div>`
      : "";

    modal.querySelector(".evid-body").innerHTML = `
      <div class="evid-head">
        <div class="evid-tag" style="background:${g.color}">${e.id} · ${g.ciclo}</div>
        <div class="evid-score" style="color:${vColor}">${vShow}</div>
      </div>
      <div class="evid-question"><strong>Pregunta ${p.n}.</strong> ${escapeHtml(p.texto)}</div>
      ${responsableHtml}
      ${comentariosHtml}
      ${sinEvid}`;

    modal.classList.add("open");
    document.body.style.overflow = "hidden";
  }

  function cerrarEvidencia() {
    $("#evidModal").classList.remove("open");
    document.body.style.overflow = "";
  }

  $("#evidModal").addEventListener("click", (ev) => {
    if (ev.target.closest("[data-close-evid]") || ev.target.id === "evidModal") {
      cerrarEvidencia();
    }
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") cerrarEvidencia();
  });

  $("#printBtn").addEventListener("click", () => window.print());

  // ---- Init ---------------------------------------------------------------
  renderKpis();
  renderHistorial();
  renderResso();
})();
