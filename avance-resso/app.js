(function () {
  "use strict";

  let rendered = false;

  function render(DATA) {
  if (rendered || !DATA || !Array.isArray(DATA.documentos) || !Array.isArray(DATA.personas)) return;
  rendered = true;
  document.body.classList.add("is-ready");
  const docs = DATA.documentos;
  const people = DATA.personas;
  const nDocs = docs.length;

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
    { label: 'Dotación activa (tarja)', value: DATA.total_dotacion_activa, foot: 'Personas cruzadas contra la tarja', accent: false },
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
        renderTable();
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
  const cargos = Array.from(new Set(people.map(p => p.especialidad).filter(Boolean))).sort();
  const cargoSelect = document.getElementById('cargoFilter');
  cargoSelect.innerHTML = `<option value="">Todos los cargos</option>` +
    cargos.map(c => `<option value="${esc(c)}">${esc(titleCase(c))}</option>`).join('');

  const docSelect = document.getElementById('docFilterSelect');
  docSelect.innerHTML = `<option value="">Ver avance general (todos los documentos)</option>` +
    docs.map((d, i) => `<option value="${i}">Solo pendientes: ${esc(d.titulo)}</option>`).join('');

  cargoSelect.addEventListener('change', renderTable);
  docSelect.addEventListener('change', () => {
    const v = docSelect.value;
    activeDocIndex = v === '' ? null : Number(v);
    renderDocs();
    renderTable();
  });
  document.getElementById('searchBox').addEventListener('input', renderTable);

  function clearDocFilter() {
    activeDocIndex = null;
    docSelect.value = '';
    renderDocs();
    renderTable();
  }

  // ---------- Table ----------
  function renderTable() {
    const query = document.getElementById('searchBox').value.trim().toLowerCase();
    const cargo = cargoSelect.value;
    const note = document.getElementById('activeFilterNote');
    const head = document.getElementById('tableHead');
    const body = document.getElementById('tableBody');
    const hint = document.getElementById('peopleHint');

    let rows = people;
    if (cargo) rows = rows.filter(p => p.especialidad === cargo);
    if (query) {
      rows = rows.filter(p =>
        p.nombre.toLowerCase().includes(query) ||
        p.rut.toLowerCase().replace(/[.\-]/g, '').includes(query.replace(/[.\-]/g, ''))
      );
    }

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

  document.getElementById('generatedNote').textContent = `Datos generados el ${DATA.generado}`;

  renderPie();
  renderDocs();
  renderTargeted();
  renderTable();
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || event.origin !== window.location.origin) return;
    if (event.data && event.data.type === "avance-resso-data") render(event.data.data);
  });
  if (window.parent !== window) {
    window.parent.postMessage({ type: "avance-resso-ready" }, window.location.origin);
  }
})();
