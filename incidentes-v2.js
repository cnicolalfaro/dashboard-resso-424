(function () {
  "use strict";

  const D = window.DASHBOARD_DATA;
  if (!D || !document.querySelector("#viewIncidentes")) return;

  const $ = (selector) => document.querySelector(selector);
  const STORAGE = "resso424.incidentes.v1";
  const SOURCE = "resso424.incidentes.source";
  const SOURCE_VERSION = "csv-v10";
  const SOURCE_META = "resso424.incidentes.sourceMeta";
  const CATEGORIES = "resso424.incidentes.categories";
  const AREAS = "resso424.incidentes.areas";
  const CRITICALITY = "resso424.incidentes.categoryCriticality";
  const EXCEL_FILE = "Consolidado Incidentes y Medidas Correctivas (Formato Interno) 05.08.csv";
  const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  const DAY_MS = 86400000;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const escapeHtml = (value) => String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  const clean = (value) => String(value || "").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").trim();
  const norm = (value) => clean(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const loadJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch (_) { return fallback; } };
  const saveJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));

  function isoToDisplay(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return `${String(value.getDate()).padStart(2, "0")}-${String(value.getMonth() + 1).padStart(2, "0")}-${value.getFullYear()}`;
    if (typeof value === "number" && window.XLSX && XLSX.SSF) {
      const parsed = XLSX.SSF.parse_date_code(value);
      return parsed ? `${String(parsed.d).padStart(2, "0")}-${String(parsed.m).padStart(2, "0")}-${parsed.y}` : "";
    }
    const text = clean(value);
    let match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[3]}-${match[2]}-${match[1]}`;
    match = text.match(/^(\d{1,2})([-/])(\d{1,2})\2(\d{2,4})$/);
    if (match) {
      const year = match[4].length === 2 ? `20${match[4]}` : match[4];
      const excelOrder = match[2] === "/";
      return `${(excelOrder ? match[3] : match[1]).padStart(2, "0")}-${(excelOrder ? match[1] : match[3]).padStart(2, "0")}-${year}`;
    }
    match = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    return match ? `${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}-${match[3]}` : text;
  }
  function displayToIso(value) {
    const text = clean(value);
    const match = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : text;
  }
  function parseDate(value) {
    const match = isoToDisplay(value).match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (!match) return null;
    const date = new Date(+match[3], +match[2] - 1, +match[1]);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  function normalizeStatus(value) {
    const text = clean(value);
    if (/^cerrado$/i.test(text)) return "CERRADO";
    if (/^abierto$/i.test(text)) return "ABIERTO";
    if (/^(n\/?a|no aplica)$/i.test(text)) return "NO APLICA";
    if (/^falta turno b$/i.test(text)) return "FALTA TURNO B";
    if (/^no existe en sharepoint ni carpeta fisica$/i.test(text)) return "NO EXISTE EN SHAREPOINT NI CARPETA FÍSICA";
    return text;
  }
  function normalizeVerification(value) {
    const text = clean(value);
    return /^(PENIDENTE|PENDEINTE)$/i.test(text) ? "PENDIENTE" : text;
  }
  function normalizeShift(value) { const text = clean(value); return /^10x10\s*b$/i.test(text) ? "10X10 B" : text; }
  function normalizeClosing(value) {
    if (value instanceof Date || typeof value === "number") return { date: isoToDisplay(value), note: "" };
    const text = clean(value);
    if (/^(NO APLICA|SIN FECHA|NO EXISTE EN SHAREPOINT)$/i.test(text)) return { date: "", note: text.toUpperCase() };
    return { date: isoToDisplay(text), note: "" };
  }
  const isClosed = (measure) => norm(measure.estatus).includes("cerrad");
  const isNA = (measure) => { const status = norm(measure.estatus); return status === "n/a" || status === "na" || status.includes("no aplica"); };
  const isPending = (measure) => { const status = norm(measure.estatus); return status.includes("abiert") || status.includes("pendient") || status.includes("proceso"); };
  const hasFinalReportGap = (incident) => incident.medidas.some((measure) => norm([measure.medida, measure.responsable, measure.fechaCierreNota].join(" ")).includes("sin informe final"));
  function measureDueInfo(measure) {
    const due = parseDate(measure.fechaCierre);
    const days = due ? Math.ceil((due - today) / DAY_MS) : null;
    return { due, days, dueMonth: due ? `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}` : "", risk: days == null ? "none" : days < 0 ? "overdue" : days <= 10 ? "soon" : "ok" };
  }
  function incidentStatus(incident) {
    if (hasFinalReportGap(incident)) return "pending";
    if (!incident.medidas.length || incident.medidas.some((measure) => isPending(measure) || isNA(measure))) return "pending";
    if (incident.medidas.length && incident.medidas.every(isClosed)) return "closed";
    return "none";
  }
  function latestClose(incident) {
    const dates = incident.medidas.filter(isClosed).map((measure) => displayToIso(measure.fechaCierre)).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
    return dates.length ? isoToDisplay(dates[dates.length - 1]) : "";
  }
  function normalizeIncident(incident, index) {
    const normalized = {
      item: clean(incident.item || incident.id || index + 1), nombre: clean(incident.nombre || incident.evento || "Evento sin nombre"),
      fecha: isoToDisplay(incident.fecha), turno: normalizeShift(incident.turno), categoria: clean(incident.categoria || "SIN CATEGORÍA").toUpperCase() === "N1" ? "NIVEL 1" : clean(incident.categoria || "SIN CATEGORÍA"),
      area: clean(incident.area), incidente: clean(incident.incidente || incident.descripcion), verifMedidas: normalizeVerification(incident.verifMedidas),
      verifEficacia: normalizeVerification(incident.verifEficacia), comentarios: clean(incident.comentarios), fechaCierreGeneral: isoToDisplay(incident.fechaCierreGeneral),
      medidas: (incident.medidas || []).map((measure) => {
        const closing = normalizeClosing(measure.fechaCierre);
        return { medida: clean(measure.medida || measure.descripcion), responsable: clean(measure.responsable), fechaInicio: isoToDisplay(incident.fecha), fechaCierre: closing.date, fechaCierreNota: clean(measure.fechaCierreNota) || closing.note, estatus: normalizeStatus(measure.estatus) };
      }),
    };
    const finalReportGap = hasFinalReportGap(normalized);
    const closedTemplate = finalReportGap ? normalized.medidas.find(isClosed) : null;
    if (closedTemplate) normalized.medidas.forEach((measure) => {
      if (!measure.estatus) measure.estatus = "CERRADO";
      if (!measure.fechaCierre) measure.fechaCierre = closedTemplate.fechaCierre;
      if (!measure.responsable) measure.responsable = closedTemplate.responsable;
    });
    if (!normalized.fechaCierreGeneral && incidentStatus(normalized) === "closed") normalized.fechaCierreGeneral = latestClose(normalized);
    return normalized;
  }

  function parseWorkbook(workbook) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "", raw: true });
    const key = (value) => norm(value).replace(/[^a-z0-9]/g, "");
    const headerIndex = rows.findIndex((row) => row.some((cell) => key(cell) === "item") && row.some((cell) => key(cell) === "nombredelevento"));
    if (headerIndex < 0) throw new Error("No se encontró la fila ITEM / NOMBRE DEL EVENTO.");
    const headers = rows[headerIndex].map(key);
    const col = (...names) => headers.findIndex((header) => names.includes(header));
    const columns = { item: col("item"), fecha: col("fecha"), turno: col("turno"), nombre: col("nombredelevento"), categoria: col("categoria"), incidente: col("incidente"), medida: col("medidacorrectiva"), responsable: col("responsable"), cierre: col("fechacierreaccion", "fechacierreaccin", "fechacierre"), estatus: col("estatus"), verifMedidas: col("verificacionmedidas", "verificacinmedidas"), verifEficacia: col("verificaciondeeficacia", "verificacioneficacia", "verificacindeeficacia"), comentarios: col("comentarios"), area: col("area", "sector"), cierreGeneral: col("fechacierregeneral") };
    const value = (row, column) => column >= 0 ? row[column] : "";
    const incidents = [];
    let current = null;
    rows.slice(headerIndex + 1).forEach((row) => {
      const item = clean(value(row, columns.item));
      if (item) {
        current = { item, nombre: clean(value(row, columns.nombre)), fecha: isoToDisplay(value(row, columns.fecha)), turno: value(row, columns.turno), categoria: value(row, columns.categoria), area: value(row, columns.area), incidente: value(row, columns.incidente), verifMedidas: value(row, columns.verifMedidas), verifEficacia: value(row, columns.verifEficacia), comentarios: value(row, columns.comentarios), fechaCierreGeneral: value(row, columns.cierreGeneral), medidas: [] };
        incidents.push(current);
      }
      if (!current) return;
      const verification = clean(value(row, columns.verifMedidas));
      const effectiveness = clean(value(row, columns.verifEficacia));
      const comment = clean(value(row, columns.comentarios));
      if (verification && !current.verifMedidas) current.verifMedidas = verification;
      if (effectiveness && !current.verifEficacia) current.verifEficacia = effectiveness;
      if (comment && !clean(current.comentarios).includes(comment)) current.comentarios = [current.comentarios, comment].filter(Boolean).join("\n");
      const measure = clean(value(row, columns.medida));
      if (measure) current.medidas.push({ medida: measure, responsable: value(row, columns.responsable), fechaCierre: value(row, columns.cierre), estatus: value(row, columns.estatus) });
    });
    return incidents.map(normalizeIncident);
  }

  let data = [];
  let categories = [];
  let areas = [];
  let criticality = loadJson(CRITICALITY, {});
  const state = { search: "", category: "", shift: "", area: "", status: "", month: "", focusedItem: "", pendingCategory: "", pendingMonth: "", pendingRisk: "", followupItem: "", openItems: new Set() };

  async function loadData() {
    let source = localStorage.getItem(SOURCE);
    let stored = loadJson(STORAGE, []);
    if (source !== SOURCE_VERSION || !stored.length) {
      const response = await fetch(encodeURI(EXCEL_FILE));
      if (!response.ok) throw new Error(`No se pudo cargar Excel (${response.status}).`);
      stored = parseWorkbook(XLSX.read(await response.arrayBuffer(), { type: "array", cellDates: true, codepage: 1252 }));
      saveJson(STORAGE, stored); localStorage.setItem(SOURCE, SOURCE_VERSION);
      saveJson(SOURCE_META, { file: EXCEL_FILE, lastModified: response.headers.get("Last-Modified") || "", importedAt: new Date().toISOString() });
    }
    data = stored.map(normalizeIncident);
    saveJson(STORAGE, data);
    categories = [...new Set(loadJson(CATEGORIES, []).filter((item) => clean(item).toUpperCase() !== "N1").concat(data.map((item) => item.categoria)).filter(Boolean))].sort();
    areas = [...new Set(loadJson(AREAS, []).concat(data.map((item) => item.area)).filter(Boolean))].sort();
    categories.forEach((category) => { if (!criticality[category]) criticality[category] = "normal"; });
    saveJson(CATEGORIES, categories); saveJson(AREAS, areas); saveJson(CRITICALITY, criticality);
  }

  function setOptions(select, values, allLabel) {
    if (!select) return;
    const selected = select.value;
    select.innerHTML = `<option value="">${allLabel}</option>` + values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
    if (values.includes(selected)) select.value = selected;
  }
  function setFormOptions(select, values, placeholder) {
    if (!select) return;
    const selected = select.value;
    select.innerHTML = `<option value="">${placeholder}</option>` + values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
    if (values.includes(selected)) select.value = selected;
  }
  function ensureSelectValue(select, value) {
    if (!select || !value) return;
    if (![...select.options].some((option) => option.value === value)) select.add(new Option(value, value));
    select.value = value;
  }
  function populateOptions() {
    const shifts = [...new Set(data.map((item) => item.turno).filter(Boolean))].sort();
    setOptions($("#incCat"), categories, "Todas"); setOptions($("#incTurno"), shifts, "Todos"); setOptions($("#incArea"), areas, "Todas");
    setFormOptions($("#incForm").elements.turno, shifts, "Seleccionar turno");
    setFormOptions($("#incForm").elements.categoria, categories, "Seleccionar categoría");
    setFormOptions($("#incForm").elements.area, areas, "Por definir");
    setOptions($("#incPendingCategory"), categories, "Todas");
    const months = [...new Set(pendingRecords().map((record) => record.dueMonth).filter(Boolean))].sort().map((value) => ({ value, label: `${MONTHS[+value.slice(5) - 1]} ${value.slice(0, 4)}` }));
    const monthSelect = $("#incPendingMonth");
    if (monthSelect) {
      const selected = monthSelect.value;
      monthSelect.innerHTML = '<option value="">Todos</option>' + months.map((month) => `<option value="${month.value}">${month.label}</option>`).join("");
      if (months.some((month) => month.value === selected)) monthSelect.value = selected;
    }
  }

  function filteredIncidents(options = {}) {
    const exactItemSearch = state.search && data.some((incident) => incident.item === clean(state.search))
      ? clean(state.search)
      : "";
    return data.filter((incident) => {
      if (!options.ignoreFocused && state.focusedItem && incident.item !== state.focusedItem) return false;
      if (exactItemSearch && incident.item !== exactItemSearch) return false;
      if (!options.ignoreCategory && state.category && incident.categoria !== state.category) return false;
      if (state.shift && incident.turno !== state.shift) return false;
      if (state.area && incident.area !== state.area) return false;
      if (state.status && incidentStatus(incident) !== state.status) return false;
      if (!options.ignorePendingRisk && state.pendingRisk && followupStatus(incident).key !== state.pendingRisk) return false;
      if (!options.ignoreMonth && state.month) { const date = parseDate(incident.fecha); if (!date || String(date.getMonth()) !== state.month) return false; }
      if (state.search && !exactItemSearch) {
        const haystack = norm([incident.item, incident.nombre, incident.incidente, incident.categoria, incident.area, ...incident.medidas.flatMap((measure) => [measure.medida, measure.responsable])].join(" "));
        if (!haystack.includes(norm(state.search))) return false;
      }
      return true;
    });
  }

  function renderKpis(rows) {
    const measures = rows.flatMap((item) => item.medidas);
    const closed = measures.filter(isClosed).length;
    const open = measures.filter(isPending).length;
    const closedIncidents = rows.filter((item) => followupStatus(item).key === "closed").length;
    const openIncidents = rows.filter((item) => followupStatus(item).key === "open").length;
    const cards = [
      ["Total de incidentes", rows.length, "blue", "Eventos únicos filtrados."],
      ["Incidentes cerrados", closedIncidents, "green", "Incidentes con seguimiento cerrado."],
      ["Incidentes abiertos", openIncidents, "red", "Incidentes con seguimiento abierto."],
      ["Medidas correctivas totales", measures.length, "blue", "Acciones asociadas a esos incidentes."],
      ["Medidas cerradas", closed, "green", "Acciones con estatus Cerrado."],
      ["Medidas abiertas", open, "amber", "Acciones abiertas, pendientes o en proceso."],
    ];
    $("#incKpis").innerHTML = cards.map(([label, value, tone, help]) => `<article class="inc-kpi inc-kpi-${tone}"><span>${label}</span><strong>${value}</strong><small>${help}</small></article>`).join("");
  }

  function renderOpenBars(rows) {
    const colors = { low: "#3971c8", normal: "#e6ad18", critical: "#e87522" };
    const groups = [...new Set(rows.map((item) => item.categoria))].map((category) => ({ category, value: rows.filter((item) => item.categoria === category).length })).filter((item) => item.value).sort((a, b) => b.value - a.value || a.category.localeCompare(b.category));
    const max = Math.max(1, ...groups.map((item) => item.value));
    $("#incOpenBars").innerHTML = groups.map((item) => { const level=criticality[item.category]||"normal"; return `<button class="inc-open-bar risk-${level}${state.category===item.category?" active":""}" data-category="${escapeHtml(item.category)}" title="${escapeHtml(item.category)} · ${item.value} incidentes"><strong>${item.value}</strong><span class="inc-open-track"><i style="height:${Math.max(8, item.value / max * 100)}%;background:${colors[level]}"></i></span><small>${escapeHtml(item.category)}</small></button>`; }).join("") || '<div class="inc-empty-state">No hay incidentes para estos filtros.</div>';
  }

  function renderTrend(rows) {
    const series = { 2025: Array(12).fill(0), 2026: Array(12).fill(0) };
    rows.forEach((item) => { const date = parseDate(item.fecha); if (date && series[date.getFullYear()]) series[date.getFullYear()][date.getMonth()]++; });
    const width = 720, height = 205, px = 28, py = 22, max = Math.max(1, ...series[2025], ...series[2026]);
    const x = (index) => px + index * ((width - px * 2) / 11), y = (value) => height - py - value / max * (height - py * 2);
    const line = (year) => series[year].map((value, index) => `${x(index)},${y(value)}`).join(" ");
    const dots = (year) => series[year].map((value, index) => `<circle class="inc-year-dot year-${year}" cx="${x(index)}" cy="${y(value)}" r="3.5"><title>${MONTHS[index]} ${year}: ${value}</title></circle>${value ? `<text class="inc-year-value year-${year}" x="${x(index)}" y="${y(value) + (year === 2025 ? -9 : 14)}">${value}</text>` : ""}`).join("");
    const grid = [0.25,0.5,0.75,1].map((ratio)=>{const yy=height-py-ratio*(height-py*2);return `<line x1="${px}" y1="${yy}" x2="${width-px}" y2="${yy}" class="inc-chart-grid-line"></line>`;}).join("");
    $("#incTrendChart").innerHTML = `<svg viewBox="0 0 ${width} ${height}" class="inc-exec-line" role="img" aria-label="Comparación mensual de incidentes 2025 y 2026">${grid}<line x1="${px}" y1="${height-py}" x2="${width-px}" y2="${height-py}" class="inc-line-axis"></line><polyline points="${line(2025)}" class="inc-year-line year-2025"></polyline><polyline points="${line(2026)}" class="inc-year-line year-2026"></polyline>${dots(2025)}${dots(2026)}</svg><div class="inc-exec-months">${MONTHS.map((month, index) => `<button data-month="${index}" class="${state.month === String(index) ? "active" : ""}">${month}</button>`).join("")}</div>`;
  }

  function pendingRecords() {
    return data.flatMap((incident) => incident.medidas.filter(isPending).map((measure) => {
      const dueInfo = measureDueInfo(measure);
      return { incident, measure, days: dueInfo.days, dueMonth: dueInfo.dueMonth, risk: dueInfo.risk };
    }));
  }
  function donutSvg(groups, total) {
    if (!total) return '<div class="inc-risk-donut empty"><span>0<small>pendientes</small></span></div>';
    const radius = 38, circumference = Math.PI * 2 * radius; let accumulated = 0;
    const circles = groups.filter((group) => group.count).map((group) => { const length = group.count / total * circumference, offset = -accumulated / total * circumference; accumulated += group.count; return `<circle class="inc-risk-segment${state.pendingRisk === group.key ? " active" : ""}" cx="50" cy="50" r="${radius}" fill="none" stroke="${group.color}" stroke-width="13" stroke-dasharray="${length} ${circumference-length}" stroke-dashoffset="${offset}" transform="rotate(-90 50 50)" data-risk="${group.key}"><title>${group.label}: ${group.count}</title></circle>`; }).join("");
    const selectedGroup = state.pendingRisk ? groups.find((group) => group.key === state.pendingRisk) : null;
    const shown = state.pendingRisk ? (selectedGroup ? selectedGroup.count : 0) : total;
    const label = state.pendingRisk ? { overdue:"vencidas", soon:"por vencer", ok:"en plazo", none:"sin fecha de cierre" }[state.pendingRisk] : "pendientes";
    return `<div class="inc-risk-donut"><svg viewBox="0 0 100 100">${circles}</svg><span>${shown}<small>${label}</small></span></div>`;
  }
  function renderFollowup() {
    const base = pendingRecords().filter((record) => (!state.pendingCategory || record.incident.categoria === state.pendingCategory) && (!state.pendingMonth || record.dueMonth === state.pendingMonth));
    const groups = [{key:"overdue",label:"Vencida",color:"#d64532"},{key:"soon",label:"Por vencer",color:"#ef8b2c"},{key:"ok",label:"En plazo",color:"#3971c8"},{key:"none",label:"Sin fecha de cierre",color:"#8b96a8"}].map((group) => ({ key:group.key, label:group.label, color:group.color, count:base.filter((record)=>record.risk===group.key).length }));
    const rows = state.pendingRisk ? base.filter((record) => record.risk === state.pendingRisk) : base;
    $("#incPendingCount").textContent = rows.length; $("#incPendingChart").innerHTML = donutSvg(groups, base.length);
    document.querySelectorAll("[data-pending-risk]").forEach((button) => button.classList.toggle("active", button.dataset.pendingRisk === state.pendingRisk));
    $("#incPendingList").innerHTML = rows.map((record) => { const date = record.measure.fechaCierre; const text = record.days == null ? (record.measure.fechaCierreNota && record.measure.fechaCierreNota !== "SIN FECHA" ? `Sin fecha de cierre · ${record.measure.fechaCierreNota}` : "Sin fecha de cierre") : record.days < 0 ? `${date} · ${Math.abs(record.days)} días de atraso` : record.days <= 30 ? `${date} · ${record.days ? `Vence en ${record.days} días` : "Vence hoy"}` : `${date} · En plazo`; return `<button class="inc-followup-row" data-item="${escapeHtml(record.incident.item)}"><span class="inc-followup-item">${escapeHtml(record.incident.item)}</span><span class="inc-followup-event"><strong>${escapeHtml(record.incident.nombre)}</strong><small>${escapeHtml(record.measure.medida)}</small></span><span class="inc-followup-category">${escapeHtml(record.incident.categoria)}</span><span class="inc-followup-owner">${escapeHtml(record.measure.responsable) || "Sin responsable"}</span><span class="inc-due-badge ${record.risk}">${text}</span></button>`; }).join("") || '<div class="inc-empty-state">No hay medidas para estos filtros.</div>';
  }

  function renderCategories() {
    const base = filteredIncidents({ ignoreCategory: true });
    $("#incCategoryNav").innerHTML = categories.map((category) => `<button data-category="${escapeHtml(category)}" class="${state.category === category ? "active" : ""}"><span>${escapeHtml(category)}</span><strong>${base.filter((item)=>item.categoria===category).length}</strong></button>`).join("");
  }
  function annotateDueAlerts(rows) {
    document.querySelectorAll("#incResults .inc-event-row").forEach((eventRow, incidentIndex) => {
      const incident = rows[incidentIndex];
      if (!incident) return;
      const measureRows = eventRow.querySelectorAll("tbody tr");
      incident.medidas.forEach((measure, measureIndex) => {
        if (!isPending(measure)) return;
        const dueInfo = measureDueInfo(measure);
        if (dueInfo.risk !== "overdue" && dueInfo.risk !== "soon") return;
        const closeCell = measureRows[measureIndex]?.children[3];
        if (!closeCell) return;
        const label = dueInfo.risk === "overdue" ? `${Math.abs(dueInfo.days)} días de atraso` : dueInfo.days ? `Vence en ${dueInfo.days} días` : "Vence hoy";
        closeCell.classList.add("inc-due-cell", dueInfo.risk);
        closeCell.title = label;
        closeCell.insertAdjacentHTML("beforeend", `<span class="inc-due-inline ${dueInfo.risk}">${label}</span>`);
      });
    });
  }
  function followupStatus(incident) {
    return incidentStatus(incident) === "closed"
      ? { key: "closed", label: "Cerrado" }
      : { key: "open", label: "Abierto" };
  }
  function verificationState(value) {
    const text = norm(value);
    return !!text && !text.includes("pendient") && !text.includes("sin informacion") && text !== "-";
  }
  function verificationBadge(label, value) {
    const ok = verificationState(value);
    return `<span class="inc-verif-check ${ok ? "ok" : "missing"}"><b>${ok ? "✓" : "×"}</b>${label}: ${escapeHtml(value) || "Pendiente"}</span>`;
  }
  function measureDueText(measure) {
    if (isClosed(measure)) return { status: "Cerrado", date: measure.fechaCierre || "Sin fecha", condition: "Cerrada", risk: "closed" };
    if (isNA(measure)) return { status: "Abierto", date: measure.fechaCierre || measure.fechaCierreNota || "No aplica", condition: "Vencida", risk: "overdue" };
    const due = measureDueInfo(measure);
    if (due.days == null) return { status: "Abierto", date: measure.fechaCierre || measure.fechaCierreNota || "Sin fecha", condition: "Vencida", risk: "overdue" };
    if (due.days < 0) return { status: "Abierto", date: measure.fechaCierre, condition: "Vencida", risk: "overdue" };
    return { status: "Abierto", date: measure.fechaCierre, condition: "En plazo", risk: "ok" };
  }
  function followupDonut(groups, total, shown, shownLabel) {
    if (!total) return '<div class="inc-risk-donut empty"><span>0<small>incidentes</small></span></div>';
    const radius = 38, circumference = Math.PI * 2 * radius; let accumulated = 0;
    if (state.pendingRisk) {
      const selected = groups.find((group) => group.key === state.pendingRisk);
      const color = selected ? selected.color : "#8b96a8";
      return `<div class="inc-risk-donut"><svg viewBox="0 0 100 100"><circle class="inc-risk-segment active" cx="50" cy="50" r="${radius}" fill="none" stroke="${color}" stroke-width="13" stroke-dasharray="${circumference} 0" stroke-dashoffset="0" transform="rotate(-90 50 50)" data-risk="${state.pendingRisk}"><title>${shownLabel}: ${shown}</title></circle></svg><span>${shown}<small>${shownLabel}</small></span></div>`;
    }
    const circles = groups.filter((group) => group.count).map((group) => { const length = group.count / total * circumference, offset = -accumulated / total * circumference; accumulated += group.count; return `<circle class="inc-risk-segment${state.pendingRisk === group.key ? " active" : ""}" cx="50" cy="50" r="${radius}" fill="none" stroke="${group.color}" stroke-width="13" stroke-dasharray="${length} ${circumference-length}" stroke-dashoffset="${offset}" transform="rotate(-90 50 50)" data-risk="${group.key}"><title>${group.label}: ${group.count}</title></circle>`; }).join("");
    return `<div class="inc-risk-donut"><svg viewBox="0 0 100 100">${circles}</svg><span>${shown}<small>${shownLabel}</small></span></div>`;
  }
  function renderFollowupV2(rows, groupRows = rows) {
    const defs = [
      { key: "closed", label: "Cerrado", color: "#2f9461" },
      { key: "open", label: "Abierto", color: "#d64532" },
    ];
    const groupEnriched = groupRows.map((incident) => ({ incident, status: followupStatus(incident) }));
    const enriched = rows.map((incident) => ({ incident, status: followupStatus(incident) }));
    const groups = defs.map((def) => ({ ...def, count: groupEnriched.filter((row) => row.status.key === def.key).length }));
    const listed = state.pendingRisk ? enriched.filter((row) => row.status.key === state.pendingRisk) : enriched;
    if (state.followupItem && !listed.some((row) => row.incident.item === state.followupItem)) state.followupItem = "";
    const selectedForTone = state.followupItem ? enriched.find((row) => row.incident.item === state.followupItem) : null;
    const activeTone = state.pendingRisk || (selectedForTone ? selectedForTone.status.key : "all");
    $("#incPendingChart").closest(".inc-followup-panel").dataset.risk = activeTone;
    $("#incPendingCount").textContent = listed.length;
    const selectedGroup = state.pendingRisk ? groups.find((group) => group.key === state.pendingRisk) : null;
    $("#incPendingChart").innerHTML = followupDonut(groups, enriched.length, selectedGroup ? selectedGroup.count : enriched.length, selectedGroup ? `incidentes ${selectedGroup.label.toLowerCase()}s` : "incidentes");
    document.querySelectorAll("[data-pending-risk]").forEach((button) => button.classList.toggle("active", button.dataset.pendingRisk === state.pendingRisk));
    $("#incPendingList").innerHTML = listed.map(({ incident, status }) => `<button class="inc-followup-row${state.followupItem === incident.item ? " active" : ""}" data-item="${escapeHtml(incident.item)}"><span class="inc-followup-item">${escapeHtml(incident.item)}</span><span class="inc-followup-category">${escapeHtml(incident.categoria)}</span><span class="inc-followup-event"><strong>${escapeHtml(incident.nombre)}</strong></span><span class="inc-due-badge ${status.key}">${status.label}</span></button>`).join("") || '<div class="inc-empty-state">No hay incidentes para estos filtros.</div>';
    const selected = state.followupItem ? listed.find((row) => row.incident.item === state.followupItem) : null;
    if (!selected) { $("#incPendingDetail").innerHTML = ""; return; }
    const verification = `${verificationBadge("Verif. medidas", selected.incident.verifMedidas)}${verificationBadge("Verif. eficacia", selected.incident.verifEficacia)}`;
    const detailMeasures = selected.incident.medidas.map((measure, index) => { const due = measureDueText(measure); return `<li class="measure-risk-${due.risk}"><span class="inc-measure-index">${index + 1}</span><strong>${escapeHtml(measure.medida) || "Medida sin descripción"}</strong><span>${escapeHtml(measure.responsable) || "Sin responsable"}</span><span class="inc-measure-state ${due.status === "Cerrado" ? "closed" : "open"}">${due.status}</span><span class="inc-measure-date">${escapeHtml(due.date)}</span><span class="inc-measure-condition ${due.risk}">${escapeHtml(due.condition)}</span></li>`; }).join("") || '<li class="inc-no-measures-row"><strong>Sin medidas correctivas registradas</strong><span>El incidente queda abierto hasta registrar medidas y verificaciones.</span></li>';
    $("#incPendingDetail").innerHTML = `<div class="inc-detail-card"><div><span>Item ${escapeHtml(selected.incident.item)}</span><h3>${escapeHtml(selected.incident.nombre)}</h3><p>${escapeHtml(selected.incident.incidente) || "Sin descripción"}</p></div><div class="inc-detail-meta"><span class="meta-category">Categoría: ${escapeHtml(selected.incident.categoria)}</span><span class="meta-state ${selected.status.key}">Estado: ${escapeHtml(selected.status.label)}</span><span class="meta-date">Fecha: ${escapeHtml(selected.incident.fecha) || "Sin fecha"}</span><span class="meta-shift">Turno: ${escapeHtml(selected.incident.turno) || "Sin turno"}</span><span class="meta-area">Área: ${escapeHtml(selected.incident.area) || "Por definir"}</span><span class="meta-close ${selected.incident.fechaCierreGeneral ? "ok" : "missing"}">Cierre general: ${escapeHtml(selected.incident.fechaCierreGeneral) || "Sin cierre general"}</span></div><div class="inc-detail-verifications">${verification}</div><div class="inc-measure-head"><span>N°</span><span>Medida correctiva</span><span>Responsable</span><span>Estatus</span><span>Fecha de cierre</span><span>Condición</span></div><ul>${detailMeasures}</ul>${selected.incident.comentarios ? `<div class="inc-detail-comments"><strong>Comentarios</strong><p>${escapeHtml(selected.incident.comentarios)}</p></div>` : ""}</div>`;
  }
  function renderTableV2(rows) {
    $("#incCount").textContent = `${rows.length} ${rows.length === 1 ? "incidente" : "incidentes"}`;
    $("#incResults").innerHTML = rows.map((incident) => {
      const followup = followupStatus(incident), status = followup.key, label = followup.label, open = state.openItems.has(incident.item);
      const measuresText = incident.medidas.map((measure, index) => `${index + 1}. ${measure.medida}`).filter(Boolean).join("\n") || "Sin medidas correctivas";
      const measuresSummary = incident.medidas.length ? `<ol>${incident.medidas.map((measure) => `<li>${escapeHtml(measure.medida) || "Medida sin descripción"}</li>`).join("")}</ol>` : "Sin medidas correctivas";
      const measures = incident.medidas.map((measure) => `<tr><td>${escapeHtml(measure.medida)||"—"}</td><td>${escapeHtml(measure.responsable)||"—"}</td><td>${escapeHtml(incident.fecha)||"—"}</td><td>${escapeHtml(measure.fechaCierre)||"—"}</td><td><span class="inc-status ${isClosed(measure)?"closed":isNA(measure)?"na":isPending(measure)?"open":"none"}">${escapeHtml(measure.estatus)||"Sin estado"}</span></td></tr>`).join("");
      return `<article class="inc-event-row ${open?"open":""}" style="--measure-count:${Math.max(1, incident.medidas.length)}"><div class="inc-event-summary" data-item="${escapeHtml(incident.item)}"><span class="inc-event-item">${escapeHtml(incident.item)}</span><span class="inc-event-category">${escapeHtml(incident.categoria)}</span><span class="inc-event-area">${escapeHtml(incident.area)||"Por definir"}</span><span class="inc-event-name"><strong>${escapeHtml(incident.nombre)}</strong><small>${escapeHtml(incident.fecha)} · ${escapeHtml(incident.turno)}</small></span><span class="inc-event-measures" title="${escapeHtml(measuresText)}">${measuresSummary}</span><span class="inc-event-state ${status}">${label}</span><span class="inc-row-actions"><button class="inc-open-btn">›</button><button class="inc-edit-btn" data-edit="${escapeHtml(incident.item)}">Editar</button></span></div><div class="inc-event-detail" ${open?"":"hidden"}><div class="inc-event-facts"><div><span>Categoría</span><strong>${escapeHtml(incident.categoria)}</strong></div><div><span>Área de trabajo</span><strong>${escapeHtml(incident.area)||"Por definir"}</strong></div><div><span>Turno</span><strong>${escapeHtml(incident.turno)||"—"}</strong></div><div><span>Fecha general de cierre</span><strong>${escapeHtml(incident.fechaCierreGeneral)||"—"}</strong></div><div><span>Verificación de medidas</span><strong>${escapeHtml(incident.verifMedidas)||"—"}</strong></div><div><span>Verificación de eficacia</span><strong>${escapeHtml(incident.verifEficacia)||"—"}</strong></div></div><div class="inc-event-description"><span>Descripción del incidente</span><p>${escapeHtml(incident.incidente)||"Sin descripción"}</p></div><div class="table-wrap"><table class="records-table inc-exec-table"><thead><tr><th>Medida correctiva</th><th>Responsable</th><th>Inicio del incidente</th><th>Cierre</th><th>Estatus</th></tr></thead><tbody>${measures||'<tr><td colspan="5">Sin medidas.</td></tr>'}</tbody></table></div>${incident.comentarios?`<div class="inc-event-comments"><span>Comentarios</span><p>${escapeHtml(incident.comentarios)}</p></div>`:""}<button class="inc-download-folders" data-download="${escapeHtml(incident.item)}">Descargar carpetas</button></div></article>`;
    }).join("") || '<div class="inc-empty-state">No hay incidentes para estos filtros.</div>';
    annotateDueAlerts(rows);
  }
  function renderTable() {
    const rows = filteredIncidents(); $("#incCount").textContent = `${rows.length} ${rows.length === 1 ? "incidente" : "incidentes"}`;
    $("#incResults").innerHTML = rows.map((incident) => { const status = incidentStatus(incident), label = {closed:"Cerrado",pending:"Pendiente",na:"No aplica",none:"Sin estado"}[status], open = state.openItems.has(incident.item); const measures = incident.medidas.map((measure) => `<tr><td>${escapeHtml(measure.medida)||"—"}</td><td>${escapeHtml(measure.responsable)||"—"}</td><td>${escapeHtml(incident.fecha)||"—"}</td><td>${escapeHtml(measure.fechaCierre)||"—"}</td><td><span class="inc-status ${isClosed(measure)?"closed":isNA(measure)?"na":isPending(measure)?"open":"none"}">${escapeHtml(measure.estatus)||"Sin estado"}</span></td></tr>`).join(""); return `<article class="inc-event-row ${open?"open":""}"><div class="inc-event-summary" data-item="${escapeHtml(incident.item)}"><span class="inc-event-item">${escapeHtml(incident.item)}</span><span class="inc-event-category">${escapeHtml(incident.categoria)}</span><span class="inc-event-area">${escapeHtml(incident.area)||"Por definir"}</span><span class="inc-event-name"><strong>${escapeHtml(incident.nombre)}</strong><small>${escapeHtml(incident.fecha)} · ${escapeHtml(incident.turno)}</small></span><span class="inc-event-measures">${incident.medidas.length}</span><span class="inc-event-state ${status}">${label}</span><span class="inc-row-actions"><button class="inc-open-btn">›</button><button class="inc-edit-btn" data-edit="${escapeHtml(incident.item)}">Editar</button></span></div><div class="inc-event-detail" ${open?"":"hidden"}><div class="inc-event-facts"><div><span>Categoría</span><strong>${escapeHtml(incident.categoria)}</strong></div><div><span>Área de trabajo</span><strong>${escapeHtml(incident.area)||"Por definir"}</strong></div><div><span>Turno</span><strong>${escapeHtml(incident.turno)||"—"}</strong></div><div><span>Fecha general de cierre</span><strong>${escapeHtml(incident.fechaCierreGeneral)||"—"}</strong></div><div><span>Verificación de medidas</span><strong>${escapeHtml(incident.verifMedidas)||"—"}</strong></div><div><span>Verificación de eficacia</span><strong>${escapeHtml(incident.verifEficacia)||"—"}</strong></div></div><div class="inc-event-description"><span>Descripción del incidente</span><p>${escapeHtml(incident.incidente)||"Sin descripción"}</p></div><div class="table-wrap"><table class="records-table inc-exec-table"><thead><tr><th>Medida correctiva</th><th>Responsable</th><th>Inicio del incidente</th><th>Cierre</th><th>Estatus</th></tr></thead><tbody>${measures||'<tr><td colspan="5">Sin medidas.</td></tr>'}</tbody></table></div>${incident.comentarios?`<div class="inc-event-comments"><span>Comentarios</span><p>${escapeHtml(incident.comentarios)}</p></div>`:""}<button class="inc-download-folders" data-download="${escapeHtml(incident.item)}">Descargar carpetas</button></div></article>`; }).join("") || '<div class="inc-empty-state">No hay incidentes para estos filtros.</div>';
    annotateDueAlerts(rows);
  }
  function renderAll() { const rows = filteredIncidents(); const followupGroups = filteredIncidents({ ignorePendingRisk: true }); const selectedIncident = state.followupItem ? data.find((incident) => incident.item === state.followupItem) : null; $("#incidentesPanel").dataset.risk = state.pendingRisk || (selectedIncident ? followupStatus(selectedIncident).key : "all"); renderKpis(rows); renderOpenBars(rows); renderTrend(filteredIncidents({ ignoreMonth: true })); renderCategories(); renderTableV2(rows); renderFollowupV2(rows, followupGroups); const meta=loadJson(SOURCE_META,{}); const modified=meta.lastModified?new Date(meta.lastModified).toLocaleDateString("es-CL"):"fecha no disponible"; const maxItem=Math.max(0,...data.map((incident)=>Number(incident.item)).filter(Number.isFinite)); const sequenceNote=maxItem>data.length?` · último item ${maxItem}`:""; $("#incSourceLabel").textContent = `Consolidado local · ${data.length} incidentes activos${sequenceNote} · actualizado ${modified}`; $("#incCategoryCount").textContent = categories.length; $("#incAreaCount").textContent = areas.length; }

  function addMeasureRow(measure = {}) {
    const row = document.createElement("div"); row.className = "inc-measure-row";
    row.innerHTML = `<label>Medida correctiva *<textarea data-field="medida" required>${escapeHtml(measure.medida||"")}</textarea></label><label>Responsable<input data-field="responsable" value="${escapeHtml(measure.responsable||"")}" /></label><label>Fecha de cierre<input data-field="fechaCierre" type="date" value="${displayToIso(measure.fechaCierre)}" /></label><label>Estatus<select data-field="estatus"><option value="">Sin estado</option>${["ABIERTO","PENDIENTE","EN PROCESO","CERRADO","NO APLICA"].map((value)=>`<option${measure.estatus===value?" selected":""}>${value}</option>`).join("")}</select></label><button type="button" class="inc-remove-med">×</button>`;
    row.querySelector(".inc-remove-med").onclick = () => { row.remove(); if (!$("#incMeasureRows").children.length) addMeasureRow(); };
    $("#incMeasureRows").appendChild(row);
  }
  let editingItem = "";
  function resetForm() { editingItem = ""; $("#incForm").reset(); $("#incMeasureRows").innerHTML = ""; addMeasureRow(); }
  function openForm(incident) {
    $("#incTaxonomyPanel").hidden = true; resetForm();
    populateOptions();
    if (incident) { editingItem = incident.item; Object.entries({nombre:incident.nombre,fecha:displayToIso(incident.fecha),fechaCierreGeneral:displayToIso(incident.fechaCierreGeneral),incidente:incident.incidente,verifMedidas:incident.verifMedidas,verifEficacia:incident.verifEficacia,comentarios:incident.comentarios}).forEach(([name,value])=>{const field=$("#incForm").elements[name];if(field)field.value=value||"";}); ensureSelectValue($("#incForm").elements.turno,incident.turno); ensureSelectValue($("#incForm").elements.categoria,incident.categoria); ensureSelectValue($("#incForm").elements.area,incident.area); $("#incMeasureRows").innerHTML=""; incident.medidas.forEach(addMeasureRow); if(!incident.medidas.length)addMeasureRow(); }
    $("#incForm").hidden = false; $("#incToggleForm").textContent = "Cerrar formulario"; $("#incForm").scrollIntoView({behavior:"smooth",block:"start"});
  }
  function saveData(message) { saveJson(STORAGE, data); localStorage.setItem(SOURCE, SOURCE_VERSION); $("#incManagerMsg").textContent = message || ""; renderAll(); }

  async function downloadFolders(incident) {
    const safe = (value) => clean(value).replace(/[<>:"/\\|?*]+/g,"-").slice(0,80)||"Sin definir";
    const zip = new JSZip(), root = zip.folder("Incidentes").folder(safe(incident.categoria)).folder(safe(incident.nombre));
    const leaves = new Set((incident.medidas.length?incident.medidas:[{}]).map((measure)=>`${safe(incident.fecha||"Sin fecha")} - ${safe(measure.responsable||"Sin responsable")}`)); leaves.forEach((leaf)=>root.folder(leaf));
    const blob = await zip.generateAsync({type:"blob"}), link=document.createElement("a"); link.href=URL.createObjectURL(blob); link.download=`Incidente ${safe(incident.item)} - ${safe(incident.nombre)}.zip`; link.click(); setTimeout(()=>URL.revokeObjectURL(link.href),1000);
  }

  function renderTaxonomy(mode) {
    const panel=$("#incTaxonomyPanel"), isCategory=mode==="category", values=isCategory?categories:areas; panel.dataset.mode=mode; panel.hidden=false; $("#incTaxonomyTitle").textContent=isCategory?"Categorías":"Áreas de trabajo"; $("#incTaxonomyHelp").textContent=isCategory?"Agrega categorías y edita nombre o criticidad.":"Agrega y edita áreas de trabajo.";
    $("#incTaxonomyList").innerHTML=values.map((value)=>`<div class="inc-taxonomy-row"><input value="${escapeHtml(value)}" readonly />${isCategory?`<select disabled>${[["low","Bajo"],["normal","Normal"],["critical","Crítico"]].map(([key,label])=>`<option value="${key}"${criticality[value]===key?" selected":""}>${label}</option>`).join("")}</select>`:""}<span>${data.filter((item)=>(isCategory?item.categoria:item.area)===value).length} incidentes</span><button data-tax-edit="${escapeHtml(value)}">Editar</button></div>`).join("");
  }
  function exportRows() {
    return filteredIncidents({ ignoreFocused: true }).flatMap((item) => {
      const status = { closed: "Cerrado", pending: "Pendiente", na: "No aplica", none: "Sin estado" }[incidentStatus(item)] || "Sin estado";
      const measures = item.medidas.length ? item.medidas : [{}];
      return measures.map((measure, index) => ({
        CondicionMedida: measure.medida ? measureDueText(measure).condition : "",
        Item: item.item,
        FechaIncidente: item.fecha,
        Turno: item.turno,
        Categoria: item.categoria,
        Area: item.area,
        NombreEvento: item.nombre,
        DescripcionIncidente: item.incidente,
        EstadoIncidente: status,
        VerificacionMedidas: item.verifMedidas,
        VerificacionEficacia: item.verifEficacia,
        Comentarios: item.comentarios,
        NumeroMedida: measure.medida ? index + 1 : "",
        MedidaCorrectiva: measure.medida || "",
        Responsable: measure.responsable || "",
        FechaCierre: measure.fechaCierre || measure.fechaCierreNota || "",
        EstatusMedida: measure.estatus || "",
      }));
    });
  }
  function exportWorkbook() {
    const incidents = filteredIncidents({ ignoreFocused: true });
    const filters = [
      state.category ? `Categoría: ${state.category}` : "",
      state.status ? `Estado: ${{ closed: "Cerrado", pending: "Pendiente", na: "No aplica", none: "Sin estado" }[state.status] || state.status}` : "",
      state.pendingRisk ? `Seguimiento: ${{ closed: "Incidente cerrado", open: "Incidente abierto" }[state.pendingRisk] || state.pendingRisk}` : "",
      state.month ? `Mes: ${MONTHS[+state.month]}` : "",
      state.search ? `Búsqueda: ${state.search}` : "",
    ].filter(Boolean).join(" | ") || "Sin filtros";
    const header = ["N° REPORTE", "ITEM ORIGINAL", "FECHA", "TURNO", "CATEGORÍA", "ÁREA", "NOMBRE DEL EVENTO", "INCIDENTE", "N° MEDIDA", "MEDIDA CORRECTIVA", "RESPONSABLE", "FECHA CIERRE ACCIÓN", "ESTATUS", "CONDICIÓN MEDIDA", "VERIFICACIÓN MEDIDAS", "VERIFICACIÓN EFICACIA", "COMENTARIOS"];
    const aoa = [
      ["CONSOLIDADO DE INCIDENTES Y MEDIDAS CORRECTIVAS"],
      [`Exportado: ${new Date().toLocaleString("es-CL")}`],
      [`Filtros aplicados: ${filters}`],
      [`Incidentes exportados: ${incidents.length}`],
      [],
      header,
    ];
    const merges = [];
    const rowKinds = ["title", "meta", "meta", "meta", "spacer", "header"];
    incidents.forEach((item, itemIndex) => {
      const status = { closed: "Cerrado", pending: "Pendiente", na: "No aplica", none: "Sin estado" }[incidentStatus(item)] || "Sin estado";
      const measures = item.medidas.length ? item.medidas : [{}];
      const start = aoa.length;
      measures.forEach((measure, index) => {
        const condition = measure.medida ? measureDueText(measure).condition : "";
        aoa.push([
          index ? "" : itemIndex + 1,
          index ? "" : item.item,
          index ? "" : item.fecha,
          index ? "" : item.turno,
          index ? "" : item.categoria,
          index ? "" : item.area,
          index ? "" : item.nombre,
          index ? "" : item.incidente,
          measure.medida ? index + 1 : "",
          measure.medida || "",
          measure.responsable || "",
          measure.fechaCierre || measure.fechaCierreNota || "",
          measure.estatus || status,
          condition,
          index ? "" : item.verifMedidas,
          index ? "" : item.verifEficacia,
          index ? "" : item.comentarios,
        ]);
        rowKinds.push(index ? "measure" : "incident");
      });
      const end = aoa.length - 1;
      if (end > start) [0,1,2,3,4,5,6,7,14,15,16].forEach((column) => merges.push({ s: { r: start, c: column }, e: { r: end, c: column } }));
      aoa.push(Array(header.length).fill(""));
      rowKinds.push("spacer");
    });
    const worksheet = XLSX.utils.aoa_to_sheet(aoa);
    worksheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: header.length - 1 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: header.length - 1 } }, { s: { r: 2, c: 0 }, e: { r: 2, c: header.length - 1 } }, { s: { r: 3, c: 0 }, e: { r: 3, c: header.length - 1 } }, ...merges];
    worksheet["!cols"] = [
      { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 18 }, { wch: 16 }, { wch: 34 }, { wch: 54 }, { wch: 9 }, { wch: 58 }, { wch: 28 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 20 }, { wch: 20 }, { wch: 34 },
    ];
    worksheet["!rows"] = rowKinds.map((kind) => ({ hpt: kind === "title" ? 28 : kind === "meta" ? 20 : kind === "header" ? 26 : kind === "spacer" ? 8 : kind === "incident" ? 42 : 34 }));
    worksheet["!freeze"] = { xSplit: 0, ySplit: 1 };
    worksheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 5, c: 0 }, e: { r: 5, c: header.length - 1 } }) };
    const range = XLSX.utils.decode_range(worksheet["!ref"]);
    for (let row = range.s.r; row <= range.e.r; row++) {
      const kind = rowKinds[row] || "measure";
      for (let col = range.s.c; col <= range.e.c; col++) {
        const address = XLSX.utils.encode_cell({ r: row, c: col });
        if (!worksheet[address]) worksheet[address] = { t: "s", v: "" };
        const cell = worksheet[address];
        cell.s = {
          font: { name: "Calibri", sz: kind === "title" ? 14 : kind === "header" ? 11 : 10, bold: kind === "title" || kind === "header" || kind === "incident" },
          alignment: { vertical: "center", wrapText: true },
          border: { top: { style: "thin", color: { rgb: "9AA6B6" } }, bottom: { style: "thin", color: { rgb: "9AA6B6" } }, left: { style: "thin", color: { rgb: "9AA6B6" } }, right: { style: "thin", color: { rgb: "9AA6B6" } } },
          fill: { fgColor: { rgb: kind === "title" ? "1F3C74" : kind === "meta" ? "EEF3FB" : kind === "header" ? "DCE6F2" : kind === "spacer" ? "FFFFFF" : kind === "incident" ? "EEF3FB" : "FFFFFF" } },
        };
        if (kind === "title") cell.s.font.color = { rgb: "FFFFFF" };
        if (kind === "spacer") cell.s.border = {};
      }
    }
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Incidentes");
    return workbook;
  }
  let taxonomyMode="category";

  function bindEvents() {
    document.querySelector('[data-goto="viewIncidentes"]').addEventListener("click",()=>document.body.classList.add("incidents-mode")); document.querySelectorAll("#viewIncidentes [data-back]").forEach((button)=>button.addEventListener("click",()=>document.body.classList.remove("incidents-mode")));
    [["#incSearch","input","search"],["#incCat","change","category"],["#incTurno","change","shift"],["#incArea","change","area"],["#incEstado","change","status"]].forEach(([selector,event,key])=>$(selector).addEventListener(event,()=>{state[key]=$(selector).value;state.focusedItem="";state.followupItem="";renderAll();}));
    $("#incCategoryNav").onclick=(event)=>{const button=event.target.closest("[data-category]");if(!button)return;state.category=state.category===button.dataset.category?"":button.dataset.category;$("#incCat").value=state.category;state.focusedItem="";state.followupItem="";renderAll();};
    $("#incOpenBars").onclick=(event)=>{const button=event.target.closest("[data-category]");if(!button)return;state.category=state.category===button.dataset.category?"":button.dataset.category;$("#incCat").value=state.category;state.focusedItem="";state.followupItem="";renderAll();$("#incidentesPanel").scrollIntoView({behavior:"smooth"});};
    $("#incTrendChart").onclick=(event)=>{const button=event.target.closest("[data-month]");if(!button)return;state.month=state.month===button.dataset.month?"":button.dataset.month;state.followupItem="";renderAll();};
    $("#incPendingChart").onclick=(event)=>{if(event.target.closest(".inc-risk-donut > span"))return;const segment=event.target.closest("[data-risk]");if(!segment)return;state.pendingRisk=state.pendingRisk===segment.dataset.risk?"":segment.dataset.risk;state.focusedItem="";state.followupItem="";renderAll();};
    $(".inc-followup-legend").onclick=(event)=>{const button=event.target.closest("[data-pending-risk]");if(!button)return;state.pendingRisk=state.pendingRisk===button.dataset.pendingRisk?"":button.dataset.pendingRisk;state.focusedItem="";state.followupItem="";renderAll();};
    $("#incClearPendingFilters").onclick=()=>{state.pendingCategory="";state.pendingMonth="";state.pendingRisk="";state.focusedItem="";state.followupItem="";renderAll();};
    $("#incClearDetailFilters").onclick=()=>{state.search="";state.category="";state.shift="";state.area="";state.status="";state.month="";state.focusedItem="";state.pendingRisk="";state.followupItem="";state.openItems.clear();$("#incSearch").value="";$("#incCat").value="";$("#incTurno").value="";$("#incArea").value="";$("#incEstado").value="";renderAll();};
    $("#incPendingList").onclick=(event)=>{const row=event.target.closest("[data-item]");if(!row)return;const item=row.dataset.item;if(state.followupItem===item){state.followupItem="";state.focusedItem="";}else{state.followupItem=item;state.focusedItem=item;}renderAll();};
    $("#incResults").onclick=(event)=>{const edit=event.target.closest("[data-edit]");if(edit){openForm(data.find((item)=>item.item===edit.dataset.edit));return;}const download=event.target.closest("[data-download]");if(download){downloadFolders(data.find((item)=>item.item===download.dataset.download));return;}const row=event.target.closest("[data-item]");if(!row)return;const item=row.dataset.item;if(state.focusedItem===item){state.openItems.has(item)?state.openItems.delete(item):state.openItems.add(item);}else{state.focusedItem=item;state.followupItem=item;state.openItems=new Set([item]);}renderAll();};
    $("#incToggleForm").onclick=()=>{$("#incForm").hidden?openForm():($("#incForm").hidden=true,$("#incToggleForm").textContent="+ Crear nuevo incidente");}; $("#incCancelForm").onclick=()=>{$("#incForm").hidden=true;$("#incToggleForm").textContent="+ Crear nuevo incidente";}; $("#incAddMedida").onclick=()=>addMeasureRow();
    $("#incForm").onsubmit=(event)=>{event.preventDefault();const fd=new FormData(event.target);const measures=Array.prototype.map.call($("#incMeasureRows").children,(row)=>{const result={};row.querySelectorAll("[data-field]").forEach((field)=>{result[field.dataset.field]=field.value;});return result;});const incident=normalizeIncident({item:editingItem||`INC-${Date.now()}`,nombre:fd.get("nombre"),fecha:isoToDisplay(fd.get("fecha")),turno:fd.get("turno"),categoria:fd.get("categoria"),area:fd.get("area"),fechaCierreGeneral:isoToDisplay(fd.get("fechaCierreGeneral")),incidente:fd.get("incidente"),verifMedidas:fd.get("verifMedidas"),verifEficacia:fd.get("verifEficacia"),comentarios:fd.get("comentarios"),medidas:measures});const index=data.findIndex((item)=>item.item===editingItem);index>=0?data.splice(index,1,incident):data.push(incident);$("#incForm").hidden=true;$("#incToggleForm").textContent="+ Crear nuevo incidente";saveData(`${incident.item} guardado correctamente.`);};
    $("#incManageCategories").onclick=()=>{if(!$("#incTaxonomyPanel").hidden&&taxonomyMode==="category"){$("#incTaxonomyPanel").hidden=true;return;}taxonomyMode="category";renderTaxonomy(taxonomyMode);}; $("#incManageAreas").onclick=()=>{if(!$("#incTaxonomyPanel").hidden&&taxonomyMode==="area"){$("#incTaxonomyPanel").hidden=true;return;}taxonomyMode="area";renderTaxonomy(taxonomyMode);}; $("#incCloseTaxonomy").onclick=()=>$("#incTaxonomyPanel").hidden=true;
    $("#incTaxonomyForm").onsubmit=(event)=>{event.preventDefault();const name=clean($("#incTaxonomyName").value);if(!name)return;const values=taxonomyMode==="category"?categories:areas;if(!values.some((value)=>norm(value)===norm(name)))values.push(name);values.sort();if(taxonomyMode==="category")criticality[name]="normal";saveJson(CATEGORIES,categories);saveJson(AREAS,areas);saveJson(CRITICALITY,criticality);$("#incTaxonomyName").value="";populateOptions();renderTaxonomy(taxonomyMode);renderAll();};
    $("#incTaxonomyList").onclick=(event)=>{const button=event.target.closest("[data-tax-edit]");if(!button)return;const row=button.closest(".inc-taxonomy-row"),input=row.querySelector("input"),select=row.querySelector("select"),old=button.dataset.taxEdit;if(button.textContent==="Editar"){input.readOnly=false;if(select)select.disabled=false;button.textContent="Guardar";return;}const name=clean(input.value);if(!name)return;data.forEach((item)=>{if((taxonomyMode==="category"?item.categoria:item.area)===old)item[taxonomyMode==="category"?"categoria":"area"]=name;});const values=taxonomyMode==="category"?categories:areas,idx=values.indexOf(old);if(idx>=0)values[idx]=name;if(select){delete criticality[old];criticality[name]=select.value;}saveJson(CATEGORIES,categories);saveJson(AREAS,areas);saveJson(CRITICALITY,criticality);saveData(`${old} actualizado a ${name}.`);populateOptions();renderTaxonomy(taxonomyMode);};
    $("#incExcelFile").onchange=async(event)=>{const file=event.target.files[0];if(!file)return;data=parseWorkbook(XLSX.read(await file.arrayBuffer(),{type:"array",cellDates:true,codepage:1252}));saveData(`${data.length} incidentes importados.`);populateOptions();}; $("#incExportExcel").onclick=()=>XLSX.writeFile(exportWorkbook(),"Incidentes_filtrados_ordenados.xlsx",{cellStyles:true});
  }

  async function init() {
    try { await loadData(); populateOptions(); addMeasureRow(); bindEvents(); renderAll(); } catch (error) { $("#incManagerMsg").textContent = error.message; console.error(error); }
  }
  init();
})();
