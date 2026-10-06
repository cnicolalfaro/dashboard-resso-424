(function () {
  "use strict";

  let rendered = false;

  function render(DATA) {
  if (rendered || !DATA || !Array.isArray(DATA.documentos) || !Array.isArray(DATA.personas)) return;
  rendered = true;
  document.body.classList.add("is-ready");
  const docs = DATA.documentos;
  // Personas vigentes (cuentan en KPI y %); los finiquitados / fuera de tarja solo se ven en la matriz.
  const allPeople = DATA.personas;
  const people = allPeople.filter(p => !p.estado);
  const nDocs = docs.length;
  const namiPeople = DATA.namiLinks && DATA.namiLinks.people ? DATA.namiLinks.people : {};

  function normalizeRut(value) {
    return String(value || '').toUpperCase().replace(/[^0-9K]/g, '');
  }

  function safeSharePointUrl(value) {
    const url = String(value || '');
    return /^https:\/\/empresassk\.sharepoint\.com\//i.test(url) ? url : '';
  }

  function statusColor(pct) {
    if (pct < 30) return 'var(--critical)';
    if (pct < 60) return 'var(--serious)';
    if (pct < 85) return 'var(--warning)';
    return 'var(--good)';
  }
  function statusLabel(pct) {
    if (pct < 30) return 'Crítico';
    if (pct < 60) return 'En curso';
    if (pct < 85) return 'Avanzado';
    return 'Al día';
  }
  function fmtPct(n) { return n.toFixed(1).replace('.0', '') + '%'; }
  function modoLabel(d) {
    if (d.modo === 'resultado') return 'campo Resultado';
    if (d.modo === 'plataforma') return 'plataforma (Aprobado/Pendiente)';
    if (d.modo === 'maestra_capacitacion') return 'maestra de capacitación (fecha de evaluación)';
    return `100% correcto (máx ${d.max_score} pts)`;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function titleCase(s) {
    if (!s) return '';
    return s.toLowerCase().replace(/(^|\s)([a-záéíóúñ])/g, (m, sp, c) => sp + c.toUpperCase());
  }

  // ---------- Meta + KPIs ----------
  document.getElementById('metaRow').innerHTML =
    `<span>Generado ${esc(DATA.generado)}</span><span>·</span><span>${docs.length} documentos evaluados</span>`;

  const personasAlDia = people.filter(p => p.avance_pct >= 99.95).length;
  const personasSinAvance = people.filter(p => p.avance_pct <= 0.05).length;

  const kpis = [
    { label: 'Dotación activa (tarja)', value: DATA.total_dotacion_activa, foot: DATA.total_no_vigentes ? `Vigentes en ${DATA.dotacion_fuente || 'la tarja'} · ${DATA.total_no_vigentes} no vigentes (finiquitados) solo se ven en la matriz` : 'Personas cruzadas contra la tarja', accent: false },
    { label: 'Avance promedio', value: fmtPct(DATA.avance_promedio_pct), foot: `Promedio simple entre los ${nDocs} documentos`, accent: true },
    { label: 'Al día en todo', value: personasAlDia, foot: `De ${DATA.total_dotacion_activa} personas · ${fmtPct(100*personasAlDia/DATA.total_dotacion_activa)}`, accent: false },
    { label: 'Sin ningún documento', value: personasSinAvance, foot: 'No aprueban aún ningún tema', accent: false },
  ];
  document.getElementById('kpis').innerHTML = kpis.map(k => `
    <div class="kpi ${k.accent ? 'accent' : ''}">
      <div class="label">${esc(k.label)}</div>
      <div class="value">${k.value}</div>
      <div class="foot">${esc(k.foot)}</div>
    </div>`).join('');

  // ---------- Categorías (RF / RIM / MA / IRL-otros) ----------
  const CATEGORIES = {
    RF:  { label: 'Riesgos de Fatalidad',       short: 'RF',  color: 'var(--cat-rf)'  },
    RIM: { label: 'Reglamentos Internos Mineros', short: 'RIM', color: 'var(--cat-rim)' },
    MA:  { label: 'Medio Ambiente',              short: 'MA',  color: 'var(--cat-ma)'  },
    IRL: { label: 'IRL y otras capacitaciones',  short: 'IRL', color: 'var(--cat-irl)' },
  };
  const MA_KEYWORDS = ['MEDIO AMBIENTE', 'AMBIENTAL', 'RESIDUOS', 'SUSTANCIAS PELIGROSAS', 'PROC-GMA', 'PRO-022'];
  const RIM_KEYWORDS = ['REGLAMENTO', 'R-035', 'R-01 ', 'R-008', 'CONTROL DE INGRESO', 'VENTILACION', 'VENTILACIÓN'];

  function categorize(title) {
    const t = title.toUpperCase();
    if (/RF-?\s?\d+/.test(t)) return 'RF';
    if (RIM_KEYWORDS.some(k => t.includes(k))) return 'RIM';
    if (MA_KEYWORDS.some(k => t.includes(k))) return 'MA';
    return 'IRL';
  }

  // Enlaces NAMI. Formato compacto (import_nami_links.py v2):
  //   namiLinks = { base, docOrder, people: { RUT: { folder, docs: {"6": "Riesgos_de_Fatalidad/x.pdf"} } } }
  const namiBase = DATA.namiLinks && DATA.namiLinks.base ? String(DATA.namiLinks.base) : '';
  const namiDocOrderOk = !(DATA.namiLinks && Array.isArray(DATA.namiLinks.docOrder)) ||
    DATA.namiLinks.docOrder.length === docs.length &&
    DATA.namiLinks.docOrder.every((title, i) => title === docs[i].titulo);

  function encodePath(path) {
    return String(path).split('/').map(encodeURIComponent).join('/');
  }
  function namiFileUrl(relPath) {
    return `https://empresassk.sharepoint.com/${encodePath(namiBase + '/' + relPath)}?web=1`;
  }

  // Solo se enlaza la evidencia real: el PDF NAMI de ese curso para ese trabajador.
  // Sin PDF no hay link (antes se enlazaba la carpeta de la familia, que no contiene
  // evidencia de cursos como Protección Auditiva o Anexo IRL).
  function namiLinkFor(person, docIndex) {
    const links = namiPeople[normalizeRut(person.rut)];
    const file = links && links.folder && namiBase && namiDocOrderOk && links.docs && links.docs[docIndex];
    if (file) return { url: safeSharePointUrl(namiFileUrl(`${links.folder}/${file}`)), level: 'doc' };
    return qrLinkFor(person, docIndex);
  }

  // Certificados QR de Microsoft Forms (import_qr_links.py): se enlazan cuando no hay certificado NAMI.
  //   qrLinks = { base, docOrder, people: { RUT: { folder, docs: {"20": "Riesgos_de_Fatalidad/RUT_RF-01.pdf"} } } }
  const qrBase = DATA.qrLinks && DATA.qrLinks.base ? String(DATA.qrLinks.base) : '';
  const qrPeople = DATA.qrLinks && DATA.qrLinks.people ? DATA.qrLinks.people : {};
  const qrDocOrderOk = Boolean(DATA.qrLinks) && Array.isArray(DATA.qrLinks.docOrder) &&
    DATA.qrLinks.docOrder.length === docs.length &&
    DATA.qrLinks.docOrder.every((title, i) => title === docs[i].titulo);

  function qrLinkFor(person, docIndex) {
    const links = qrPeople[normalizeRut(person.rut)];
    const file = links && links.folder && qrBase && qrDocOrderOk && links.docs && links.docs[docIndex];
    return file
      ? { url: safeSharePointUrl(`https://empresassk.sharepoint.com/${encodePath(qrBase + '/' + links.folder + '/' + file)}?web=1`), level: 'qr' }
      : { url: '', level: '' };
  }

  // Cursos que tienen al menos un certificado en NAMI (para el filtro de la matriz).
  const namiCourseSet = new Set();
  if (namiDocOrderOk) Object.values(namiPeople).forEach(p => Object.keys(p.docs || {}).forEach(i => namiCourseSet.add(Number(i))));

  const docsByCat = { RF: [], RIM: [], MA: [], IRL: [] };
  docs.forEach((d, i) => docsByCat[categorize(d.titulo)].push(i));

  const catStats = Object.keys(CATEGORIES).map(key => {
    const idxs = docsByCat[key];
    const avg = idxs.length ? idxs.reduce((s, i) => s + docs[i].avance_pct, 0) / idxs.length : 0;
    return { key, ...CATEGORIES[key], count: idxs.length, avance_pct: Math.round(avg * 10) / 10, idxs };
  });

  // ---------- Pie chart ----------
  function polar(cx, cy, r, angleDeg) {
    const a = (angleDeg - 90) * Math.PI / 180;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  }
  function renderPie() {
    const R = 84, CX = 96, CY = 96, SIZE = 192;
    const total = catStats.reduce((s, c) => s + c.count, 0) || 1;
    let angle = 0;
    const slices = catStats.filter(c => c.count > 0).map(c => {
      const sweep = (c.count / total) * 360;
      const start = angle, end = angle + sweep;
      angle = end;
      const p1 = polar(CX, CY, R, start);
      const p2 = polar(CX, CY, R, end);
      const large = sweep > 180 ? 1 : 0;
      const path = sweep >= 359.99
        ? `M ${CX-R},${CY} A ${R},${R} 0 1 1 ${CX+R+0.001},${CY} A ${R},${R} 0 1 1 ${CX-R},${CY} Z`
        : `M ${CX},${CY} L ${p1.x},${p1.y} A ${R},${R} 0 ${large} 1 ${p2.x},${p2.y} Z`;
      return { ...c, path };
    });

    const svg = `
      <svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="Distribución de documentos por familia">
        ${slices.map(s => `<path class="pie-slice" d="${s.path}" fill="${s.color}" data-cat="${s.key}" stroke="var(--surface)" stroke-width="2"><title>${esc(s.label)}: ${s.count} documentos · ${fmtPct(s.avance_pct)} en promedio</title></path>`).join('')}
      </svg>`;
    const wrap = document.getElementById('pieWrap');
    wrap.style.width = SIZE + 'px';
    wrap.style.height = SIZE + 'px';
    wrap.innerHTML = svg + `<div class="pie-center"><span class="n">${docs.length}</span><span class="lbl">documentos</span></div>`;

    wrap.querySelectorAll('.pie-slice').forEach(el => {
      el.addEventListener('click', () => scrollToCategory(el.dataset.cat));
    });

    document.getElementById('pieLegend').innerHTML = catStats.map(c => `
      <div class="pie-legend-row" data-cat="${c.key}">
        <span class="swatch" style="background:${c.color}"></span>
        <span class="name">${esc(c.label)}</span>
        <span class="stat">${c.count} · ${fmtPct(c.avance_pct)}</span>
      </div>`).join('');
    document.querySelectorAll('.pie-legend-row').forEach(el => {
      el.addEventListener('click', () => scrollToCategory(el.dataset.cat));
    });
  }

  function scrollToCategory(key) {
    openCats.add(key);
    renderDocs();
    document.getElementById(`cathead-${key}`).scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- Document bars (agrupados por categoría) ----------
  let activeDocIndex = null;
  const openCats = new Set();

  function docRowHtml(i) {
    const d = docs[i];
    const pct = d.avance_pct;
    const color = statusColor(pct);
    const pendientes = DATA.total_dotacion_activa - d.aprobados;
    return `
      <div class="docrow ${activeDocIndex === i ? 'active' : ''}" data-idx="${i}">
        <div class="name">${esc(d.titulo)}<span class="sub">${modoLabel(d)} · fuente: ${esc((d.fuentes || ['Microsoft Forms']).join(' + '))}</span></div>
        <div class="barwrap">
          <div class="bartrack"><div class="barfill" style="width:${pct}%;background:${color}"></div></div>
          <div class="pct">${fmtPct(pct)}</div>
        </div>
        <div class="count">${d.aprobados} / ${DATA.total_dotacion_activa}<br><span style="color:var(--critical)">${pendientes} faltan</span></div>
      </div>`;
  }

  function renderDocs() {
    const container = document.getElementById('categoryGroups');
    container.innerHTML = catStats.map(c => {
      const idxs = c.idxs.slice().sort((a, b) => docs[a].avance_pct - docs[b].avance_pct);
      const color = statusColor(c.avance_pct);
      const isOpen = openCats.has(c.key);
      return `
      <div class="cat-group">
        <div class="cat-group-head" id="cathead-${c.key}" data-cat="${c.key}" aria-expanded="${isOpen}">
          <span class="swatch" style="background:${c.color}"></span>
          <span class="title">${esc(c.label)}</span>
          <span class="sub">${c.count} documentos</span>
          <span class="spacer"></span>
          <div class="barwrap">
            <div class="bartrack"><div class="barfill" style="width:${c.avance_pct}%;background:${color}"></div></div>
            <div class="pct">${fmtPct(c.avance_pct)}</div>
          </div>
          <span class="chev">▾</span>
        </div>
        <div class="cat-group-body ${isOpen ? 'open' : ''}" id="catbody-${c.key}">
          <div class="doclist">${idxs.map(docRowHtml).join('')}</div>
        </div>
      </div>`;
    }).join('');

    container.querySelectorAll('.cat-group-head').forEach(head => {
      head.addEventListener('click', () => {
        const key = head.dataset.cat;
        const body = document.getElementById(`catbody-${key}`);
        const open = body.classList.toggle('open');
        head.setAttribute('aria-expanded', String(open));
        if (open) openCats.add(key); else openCats.delete(key);
      });
    });
    container.querySelectorAll('.docrow').forEach(row => {
      row.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const idx = Number(row.dataset.idx);
        activeDocIndex = activeDocIndex === idx ? null : idx;
        document.getElementById('docFilterSelect').value = activeDocIndex === null ? '' : String(activeDocIndex);
        renderPeople();
        renderDocs();
      });
    });
  }

  // ---------- Targeted trainings (custom population, e.g. solo supervisores) ----------
  function renderTargeted() {
    const list = DATA.capacitaciones_dirigidas || [];
    const section = document.getElementById('targeted-section');
    if (!list.length) { section.style.display = 'none'; return; }
    section.style.display = '';

    const container = document.getElementById('targetedList');
    container.innerHTML = list.map((d, i) => {
      const pct = d.avance_pct;
      const color = statusColor(pct);
      const pendientes = d.total_poblacion - d.aprobados;
      return `
      <div class="tdoc">
        <div class="tdoc-head" data-idx="${i}">
          <div class="name">${esc(d.titulo)}<span class="sub">${esc(d.poblacion_label)} · ${esc(d.fecha)} · ${esc(d.fuente)}</span></div>
          <div class="barwrap">
            <div class="bartrack"><div class="barfill" style="width:${pct}%;background:${color}"></div></div>
            <div class="pct">${fmtPct(pct)}</div>
          </div>
          <div class="count">${d.aprobados} / ${d.total_poblacion}<br><span style="color:var(--critical)">${pendientes} faltan</span></div>
          <div class="toggle" id="toggle-t${i}">Ver faltantes ▾</div>
        </div>
        <div class="tdoc-body" id="tbody-t${i}">
          <div class="pending-grid">
            ${d.pendientes.map(p => `<div class="pending-item">${esc(titleCase(p.nombre))}<br><span class="rut mono">${esc(p.rut)} · ${esc(titleCase(p.cargo))}</span></div>`).join('') || '<div class="pending-item">Nadie pendiente.</div>'}
          </div>
        </div>
      </div>`;
    }).join('');

    container.querySelectorAll('.tdoc-head').forEach(head => {
      head.addEventListener('click', () => {
        const idx = head.dataset.idx;
        const body = document.getElementById(`tbody-t${idx}`);
        const toggle = document.getElementById(`toggle-t${idx}`);
        const open = body.classList.toggle('open');
        toggle.textContent = open ? 'Ocultar ▴' : 'Ver faltantes ▾';
      });
    });
  }

  // ---------- Filters setup ----------
  const cargos = Array.from(new Set(allPeople.map(p => p.especialidad).filter(Boolean))).sort();
  const cargoSelect = document.getElementById('cargoFilter');
  cargoSelect.innerHTML = `<option value="">Todos los cargos</option>` +
    cargos.map(c => `<option value="${esc(c)}">${esc(titleCase(c))}</option>`).join('');

  const docSelect = document.getElementById('docFilterSelect');
  docSelect.innerHTML = `<option value="">Ver avance general (todos los documentos)</option>` +
    docs.map((d, i) => `<option value="${i}">Solo pendientes: ${esc(d.titulo)}</option>`).join('');

  let peopleView = 'summary';
  let matrixPage = 1;
  const MATRIX_PAGE_SIZE = 40;

  function resetMatrixAndRender() {
    matrixPage = 1;
    renderPeople();
  }

  cargoSelect.addEventListener('change', resetMatrixAndRender);
  docSelect.addEventListener('change', () => {
    const v = docSelect.value;
    activeDocIndex = v === '' ? null : Number(v);
    renderDocs();
    renderPeople();
  });
  document.getElementById('searchBox').addEventListener('input', resetMatrixAndRender);

  function clearDocFilter() {
    activeDocIndex = null;
    docSelect.value = '';
    renderDocs();
    renderPeople();
  }

  function filteredPeople(source = people) {
    const query = document.getElementById('searchBox').value.trim().toLowerCase();
    const cargo = cargoSelect.value;
    return source.filter(person => {
      if (cargo && person.especialidad !== cargo) return false;
      if (!query) return true;
      return person.nombre.toLowerCase().includes(query) ||
        person.rut.toLowerCase().replace(/[.\-]/g, '').includes(query.replace(/[.\-]/g, ''));
    });
  }

  // ---------- Table ----------
  function renderTable() {
    const note = document.getElementById('activeFilterNote');
    const head = document.getElementById('tableHead');
    const body = document.getElementById('tableBody');
    const hint = document.getElementById('peopleHint');

    let rows = filteredPeople();

    if (activeDocIndex !== null) {
      const doc = docs[activeDocIndex];
      rows = rows.filter(p => p.aprob[activeDocIndex] === '0');
      note.style.display = 'flex';
      note.innerHTML = `Mostrando solo quienes tienen <strong>pendiente</strong>: ${esc(doc.titulo)} <button id="clearDocBtn">Quitar filtro</button>`;
      document.getElementById('clearDocBtn').addEventListener('click', clearDocFilter);
      hint.textContent = `${rows.length} personas pendientes de ${DATA.total_dotacion_activa} en la dotación activa`;

      head.innerHTML = `<th>Nombre</th><th>RUT</th><th>Cargo</th><th class="num">Estado</th>`;
      body.innerHTML = rows.length ? rows.map(p => `
        <tr>
          <td class="name">${esc(titleCase(p.nombre))}</td>
          <td class="rut mono">${esc(p.rut)}</td>
          <td class="cargo">${esc(titleCase(p.especialidad))}</td>
          <td class="num"><span class="pill pending">Pendiente</span></td>
        </tr>`).join('') : `<tr><td colspan="4"><div class="empty-state">Nadie coincide con este filtro — puede que ya no falte nadie en este documento.</div></td></tr>`;
    } else {
      note.style.display = 'none';
      hint.textContent = `${rows.length} de ${DATA.total_dotacion_activa} en la dotación activa`;

      rows = rows.slice().sort((a, b) => a.avance_pct - b.avance_pct);

      head.innerHTML = `<th>Nombre</th><th>RUT</th><th>Cargo</th><th class="num">Documentos al día</th><th class="num">Avance</th>`;
      body.innerHTML = rows.length ? rows.map(p => {
        const done = p.aprob.split('').filter(c => c === '1').length;
        const color = statusColor(p.avance_pct);
        return `
        <tr>
          <td class="name">${esc(titleCase(p.nombre))}</td>
          <td class="rut mono">${esc(p.rut)}</td>
          <td class="cargo">${esc(titleCase(p.especialidad))}</td>
          <td class="num mono">${done} / ${nDocs}</td>
          <td class="num">
            <span class="mini-bar">
              <span class="mini-track"><span class="mini-fill" style="width:${p.avance_pct}%;background:${color}"></span></span>
              <span class="mono">${fmtPct(p.avance_pct)}</span>
            </span>
          </td>
        </tr>`;
      }).join('') : `<tr><td colspan="5"><div class="empty-state">Sin resultados para este filtro.</div></td></tr>`;
    }
  }

  // Siglas de columnas (máx. 7 caracteres para caber en la cabecera).
  // El orden importa: las reglas más específicas van primero.
  const COURSE_CODES = [
    [/HERRAMIENTAS DE GESTION PREVENTIVAS/, 'ART-TV'],
    [/RIESGO CRITICO N\S*\s*20/, 'RC-20'],
    [/R-?035/, 'R-035'],
    [/R-?008/, 'R-008'],
    [/\bR-01\b/, 'R-01'],
    [/CONTROL DE INGRESO/, 'R-CI'],
    [/CARTILLAS DE EVACUACION/, 'EVAC'],
    [/PRO-022/, 'MA-P022'],
    [/PROC-GMA-001/, 'MA-GMA'],
    [/SEGREGACION.*RESIDUOS/, 'MA-RES'],
    [/ACTA IRL MEDIO AMBIENTE/, 'MA-IRL'],
    [/ASPECTOS E IMPACTOS AMBIENTALES/, 'MA-AIA'],
    [/INDUCCION AMBIENTAL/, 'MA-SGA'],
    [/SUSTANCIAS PELIGROSAS DS/, 'MA-DS43'],
    [/ANEXO IRL/, 'IRL-ANX'],
    [/CONSENTIMIENTO DIGITAL/, 'CCD'],
    [/MATRIZ IPER/, 'IPER'],
    [/RIESGOS LABORALES Y POLITICAS SSO/, 'IRL-SSO'],
    [/LISTAS DE VERIFICACION LEGAL/, 'MIRLO'],
    [/RIESGOS DE INCENDIO/, 'INC'],
    [/OBLIGACIONES DE EMPRESAS CONTRATISTAS/, 'RESSO'],
    [/HOMBRE NUEVO/, 'IHN'],
    [/POLITICA CORPORATIVA/, 'POL-CD'],
    [/POLITICA DE SEGURIDAD/, 'POL-SK'],
    [/TARJETA VERDE/, 'TV'],
    [/SEGURIDAD CONDUCTUAL/, 'PSC'],
    [/PLAN DE TRANSITO/, 'PTR'],
    [/PARTICIPACION DE TRABAJADORES/, 'PART'],
    [/\bBEL\b/, 'BEL'],
    [/ACTUALIZACION IRL/, 'IRL-ACT'],
    [/IRL POR ESPECIALIDAD/, 'IRL-ANT'],
    [/PLAN DE EMERGENCIAS SK/, 'PE-SK'],
    [/AUTORRESCATADOR/, 'AUTORR'],
    [/PLAN LOCAL DE EMERGENCIAS/, 'PLE'],
    [/OBLIGACIONES, PROHIBICIONES/, 'OPF'],
    [/ESTANDARES DE SALUD/, 'EST-SAL'],
    [/MAPAS DE PROCESO/, 'MAPAS'],
    [/METALES Y METALOIDES/, 'METAL'],
    [/HERRAMIENTAS MANUALES/, 'HMP'],
    [/PROTECCION AUDITIVA/, 'AUDIT'],
    [/PROTECCION RESPIRATORIA/, 'RESP'],
    [/SILICOSIS/, 'PLANESI'],
    [/MANUAL DE CARGA/, 'MMC'],
    [/PSICOSOCIALES/, 'PSICO'],
    [/RADIACION UV/, 'UV'],
    [/TMERT/, 'TMERT'],
    [/ALTAS TEMPERATURAS/, 'TEMP'],
    [/HIPOACUSIA/, 'PREXOR'],
    [/DIFUSION TEMAS IRL/, 'IRL-DIF'],
    [/D\.?\s?S\.?\s*N\S*\s*44/, 'DS-44'],
    [/ELEMENTOS DE PROTECCION PERSONAL/, 'EPP'],
  ];

  function plainUpper(text) {
    return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  }

  const courseCodes = (() => {
    const counters = {};
    return docs.map(doc => {
      const title = plainUpper(doc.titulo);
      const rf = title.match(/\bRF-?\s?(\d{1,2})\b/);
      if (rf) return `RF-${rf[1].padStart(2, '0')}`;
      const rule = COURSE_CODES.find(([pattern]) => pattern.test(title));
      if (rule) return rule[1];
      // Sin regla: prefijo de la familia + correlativo (nunca un "C" genérico).
      const family = categorize(doc.titulo);
      counters[family] = (counters[family] || 0) + 1;
      return `${family}-${String(counters[family]).padStart(2, '0')}`;
    });
  })();

  function courseCode(doc, index) {
    return courseCodes[index];
  }

  const LINK_LABELS = {
    doc: 'Abrir certificado NAMI de este curso',
    qr: 'Abrir certificado QR (Microsoft Forms) de este curso',
  };

  function matrixCell(person, docIndex) {
    const link = namiLinkFor(person, docIndex);
    if (person.aprob[docIndex] !== '1') {
      if (link.url) {
        // Certificado (NAMI o QR) más nuevo que la fuente de avance de este snapshot.
        const label = `Certificado ${link.level === 'qr' ? 'QR' : 'NAMI'} encontrado · aún no figura aprobado en la fuente de avance`;
        return `<td class="matrix-status nami-only linked level-${link.level}"><a href="${esc(link.url)}" target="_blank" rel="noopener noreferrer" title="${label}" aria-label="${label}: ${esc(docs[docIndex].titulo)}">✓<small>↗</small></a></td>`;
      }
      return '<td class="matrix-status pending" title="Pendiente"><span>·</span></td>';
    }
    const rut = normalizeRut(person.rut);
    const namiAdded = DATA.namiLinks && DATA.namiLinks.added && DATA.namiLinks.added[rut];
    const viaNami = Boolean(namiAdded) && namiAdded.split(',').includes(String(docIndex));
    const maestraCells = DATA.maestraAdded && DATA.maestraAdded[rut];
    const maestraDate = maestraCells && Object.prototype.hasOwnProperty.call(maestraCells, docIndex) ? maestraCells[docIndex] : null;
    const maestraSeen = DATA.maestraSeen && DATA.maestraSeen[rut] && DATA.maestraSeen[rut][docIndex] === '1';
    const evidence = [];
    if (viaNami) evidence.push('aprobado por certificado NAMI');
    if (maestraDate !== null) evidence.push(`aprobado por registro en Maestra de Capacitación${maestraDate ? ' (' + maestraDate.split('-').reverse().join('-') + ')' : ''}`);
    else if (maestraSeen) evidence.push('existe registro en Maestra de Capacitación');
    const origin = evidence.length ? ' · ' + evidence.join(' · ') : '';
    if (!link.url) {
      const sources = origin || ` · fuente del curso: ${(docs[docIndex].fuentes || []).filter(s => s !== 'Certificado NAMI').join(' / ')} · sin certificado NAMI ni QR`;
      return `<td class="matrix-status done" title="Aprobado${esc(sources)}"><span>✓</span></td>`;
    }
    const label = LINK_LABELS[link.level] + origin;
    return `<td class="matrix-status done linked level-${link.level}"><a href="${esc(link.url)}" target="_blank" rel="noopener noreferrer" title="${esc(label)}" aria-label="${esc(label)}: ${esc(docs[docIndex].titulo)}">✓<small>↗</small></a></td>`;
  }

  function renderCodeGlossary(docIndexes) {
    document.getElementById('matrixGlossary').innerHTML = docIndexes.map(index => {
      const key = categorize(docs[index].titulo).toLowerCase();
      const namiCode = namiDocOrderOk && DATA.namiLinks && DATA.namiLinks.codes && DATA.namiLinks.codes[index];
      const namiTag = namiCode ? ` <em class="nami-code">NAMI ${esc(namiCode)}</em>` : '';
      return `<div class="glossary-row cat-${key}"><code>${esc(courseCode(docs[index], index))}</code><span>${esc(docs[index].titulo)}${namiTag}</span></div>`;
    }).join('');
  }

  function inactiveBadge(person) {
    if (!person.estado) return '';
    if (person.estado === 'finiquitado') {
      const fecha = person.baja ? person.baja.split('-').reverse().join('-') : '';
      return `<em class="status-badge" title="Finiquitado${fecha ? ' el ' + fecha : ''}${person.motivo_baja ? ' · ' + esc(person.motivo_baja) : ''} · no cuenta en el avance">Finiquitado${fecha ? ' ' + fecha : ''}</em>`;
    }
    return '<em class="status-badge" title="No figura en la tarja vigente · no cuenta en el avance">Fuera de tarja</em>';
  }

  function renderMatrix() {
    const category = document.getElementById('matrixCategoryFilter').value;
    const docIndexes = docs.map((_, index) => index).filter(index => !category ||
      (category === 'NAMI' ? namiCourseSet.has(index) : category === 'NONAMI' ? !namiCourseSet.has(index) : categorize(docs[index].titulo) === category));
    const status = document.getElementById('matrixStatusFilter').value;
    const rows = filteredPeople(allPeople)
      .filter(person => status === 'all' || (status === 'inactive' ? person.estado : !person.estado))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    const inactiveCount = rows.filter(person => person.estado).length;
    const totalPages = Math.max(1, Math.ceil(rows.length / MATRIX_PAGE_SIZE));
    matrixPage = Math.min(matrixPage, totalPages);
    const pageRows = rows.slice((matrixPage - 1) * MATRIX_PAGE_SIZE, matrixPage * MATRIX_PAGE_SIZE);

    document.getElementById('peopleHint').textContent = `${rows.length} trabajadores` +
      (inactiveCount ? ` (${inactiveCount} no vigentes, no cuentan en el avance)` : '') + ` · ${docIndexes.length} cursos visibles`;
    document.getElementById('matrixHead').innerHTML = `<tr><th class="matrix-person">Trabajador</th>${docIndexes.map(index => {
      const categoryKey = categorize(docs[index].titulo);
      const sources = (docs[index].fuentes || []).join(' + ');
      return `<th class="matrix-course cat-${categoryKey.toLowerCase()}" title="${esc(docs[index].titulo)} · Fuentes: ${esc(sources)}"><span>${esc(courseCode(docs[index], index))}</span></th>`;
    }).join('')}</tr>`;
    document.getElementById('matrixBody').innerHTML = pageRows.length ? pageRows.map(person => `
      <tr class="${person.estado ? 'is-inactive' : ''}">
        <th class="matrix-person" scope="row"><strong>${esc(titleCase(person.nombre))}</strong>${inactiveBadge(person)}<span>${esc(person.rut)} · ${esc(titleCase(person.especialidad))}</span></th>
        ${docIndexes.map(index => matrixCell(person, index)).join('')}
      </tr>`).join('') : '<tr><td class="empty-state">Sin trabajadores para los filtros seleccionados.</td></tr>';

    renderCodeGlossary(docIndexes);
    const withFolder = rows.filter(person => namiPeople[normalizeRut(person.rut)]).length;
    const withQr = rows.filter(person => qrPeople[normalizeRut(person.rut)]).length;
    document.getElementById('matrixNamiNote').textContent = (DATA.namiLinks
      ? `${withFolder} de ${rows.length} trabajadores con carpeta NAMI · enlaces al ${DATA.namiLinks.updatedAt || 'sin fecha'}`
      : 'Sin enlaces NAMI cargados en este snapshot.') +
      (DATA.qrLinks ? ` · ${withQr} con certificados QR al ${DATA.qrLinks.updatedAt || 'sin fecha'}` : '');
    document.getElementById('matrixPageInfo').textContent = `Página ${matrixPage} de ${totalPages}`;
    document.getElementById('matrixPrev').disabled = matrixPage <= 1;
    document.getElementById('matrixNext').disabled = matrixPage >= totalPages;
  }

  function renderPeople() {
    const summary = peopleView === 'summary';
    document.getElementById('peopleSummaryView').hidden = !summary;
    document.getElementById('peopleMatrixView').hidden = summary;
    docSelect.hidden = !summary;
    document.getElementById('activeFilterNote').style.display = 'none';
    if (summary) renderTable(); else renderMatrix();
  }

  function setPeopleView(view) {
    peopleView = view;
    const summary = view === 'summary';
    document.getElementById('summaryViewBtn').classList.toggle('active', summary);
    document.getElementById('summaryViewBtn').setAttribute('aria-pressed', String(summary));
    document.getElementById('matrixViewBtn').classList.toggle('active', !summary);
    document.getElementById('matrixViewBtn').setAttribute('aria-pressed', String(!summary));
    renderPeople();
  }

  document.getElementById('summaryViewBtn').addEventListener('click', () => setPeopleView('summary'));
  document.getElementById('matrixViewBtn').addEventListener('click', () => setPeopleView('matrix'));
  document.getElementById('matrixCategoryFilter').addEventListener('change', resetMatrixAndRender);
  document.getElementById('matrixStatusFilter').addEventListener('change', resetMatrixAndRender);
  document.getElementById('matrixPrev').addEventListener('click', () => { matrixPage -= 1; renderMatrix(); });
  document.getElementById('matrixNext').addEventListener('click', () => { matrixPage += 1; renderMatrix(); });

  document.getElementById('generatedNote').textContent = `Datos generados el ${DATA.generado}`;

  renderPie();
  renderDocs();
  renderTargeted();
  renderPeople();
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || event.origin !== window.location.origin) return;
    if (event.data && event.data.type === "avance-resso-data") render(event.data.data);
  });
  if (window.parent !== window) {
    window.parent.postMessage({ type: "avance-resso-ready" }, window.location.origin);
  }
})();
