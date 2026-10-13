'use strict';

(() => {
  const base = '/api/nami';
  const $ = (id) => document.getElementById(id);
  let authenticated = false;
  let csrf = '';
  let busy = false;
  let generation = 0;
  let catalog = { crews: [], courses: [] };
  let scan = null;
  let confirmed = false;
  const decisions = new Map();

  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = String(text ?? '');
    if (className) element.className = className;
    return element;
  }

  function message(text, error = false) {
    $('status').textContent = text;
    $('status').classList.toggle('error', error);
  }

  function safeURL(value) {
    if (typeof value !== 'string' || !value) return null;
    try {
      const url = new URL(value, location.origin);
      if (url.origin !== location.origin || url.username || url.password ||
          !url.pathname.startsWith(`${base}/`)) return null;
      return url.href;
    } catch {
      return null;
    }
  }

  function link(value, label, className) {
    const url = safeURL(value);
    if (!url) return node('span', 'Enlace de evidencia no disponible.');
    const element = node('a', label, className);
    element.href = url;
    element.target = '_blank';
    element.rel = 'noopener noreferrer';
    return element;
  }

  function clearSensitive() {
    generation += 1;
    authenticated = false;
    csrf = '';
    catalog = { crews: [], courses: [] };
    scan = null;
    confirmed = false;
    decisions.clear();
    resetPlanning();
    ['crewPreview', 'courses', 'recordOutput', 'reviewRows', 'history', 'confirmation'].forEach((id) => $(id).replaceChildren());
    $('recordOutput').hidden = true;
    $('confirmation').hidden = true;
    $('crew').replaceChildren(node('option', 'Seleccionar cuadrilla'));
    $('crew').firstChild.value = '';
    $('recordForm').reset();
    $('scanForm').reset();
    $('loginForm').reset();
    $('scanSummary').textContent = 'Sube un escaneo para revisar sus filas.';
    $('workspace').hidden = true;
    $('logout').hidden = true;
    $('loginPanel').hidden = false;
    updateControls();
  }

  async function api(path, options = {}) {
    const epoch = generation;
    const headers = { Accept: 'application/json', ...options.headers };
    if (options.method && options.method !== 'GET' && path !== '/login') {
      if (!authenticated || !csrf) throw new Error('Inicia sesión nuevamente para continuar.');
      headers['X-CSRF-Token'] = csrf;
    }
    let response;
    try {
      response = await fetch(`${base}${path}`, {
        ...options, headers, credentials: 'same-origin', mode: 'same-origin',
        cache: 'no-store', redirect: 'error'
      });
    } catch {
      if (epoch !== generation) throw new Error('La sesión cambió. Vuelve a ingresar.');
      $('unavailable').hidden = false;
      throw new Error('No fue posible conectar con el servicio privado NAMI.');
    }
    if (epoch !== generation) throw new Error('La sesión cambió. Vuelve a ingresar.');
    if (response.status === 401 && path !== '/login') {
      clearSensitive();
      throw new Error('La sesión expiró. Los datos de esta vista se borraron; vuelve a ingresar.');
    }
    if (response.status === 403 && authenticated) {
      clearSensitive();
      throw new Error('Acceso rechazado. Vuelve a ingresar para renovar la sesión.');
    }
    if (path === '/logout' && response.status === 204) {
      $('unavailable').hidden = true;
      return {};
    }
    const isJSON = (response.headers.get('content-type') || '').includes('application/json');
    if (!isJSON || response.status === 404 || response.status >= 500) {
      $('unavailable').hidden = false;
      throw new Error('El servicio privado NAMI no está disponible o no responde como API.');
    }
    let data;
    try { data = await response.json(); } catch {
      $('unavailable').hidden = false;
      throw new Error('La respuesta del servicio NAMI no es válida.');
    }
    if (epoch !== generation) throw new Error('La sesión cambió. Vuelve a ingresar.');
    if (!response.ok) {
      throw new Error(typeof data.error === 'string' ? data.error :
        (typeof data.message === 'string' ? data.message : `Solicitud rechazada (${response.status}). Intenta nuevamente.`));
    }
    $('unavailable').hidden = true;
    return data;
  }

  function post(path, data) {
    return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  }

  function selectedCourses() {
    return [...$('courses').querySelectorAll('input:checked')].map((input) => input.value);
  }

  function rows() {
    return scan ? scan.pages.flatMap((page) => page.rows) : [];
  }

  function canConfirm() {
    return scan && !confirmed && scan.pages.length > 0 &&
      scan.pages.every((page) => page.record_id !== null && page.record_id !== undefined && page.record_id !== '') &&
      rows().length > 0 && rows().every((row) => decisions.has(String(row.id)));
  }

  function updateControls() {
    document.querySelectorAll('button, input, select').forEach((element) => { element.disabled = busy; });
    const selected = selectedCourses();
    $('courses').querySelectorAll('input').forEach((input) => {
      input.disabled = busy || (selected.length >= 4 && !input.checked);
    });
    $('courseCount').textContent = `${selected.length} de 4 seleccionados`;
    $('generate').disabled = busy || !authenticated || !$('crew').value || !$('date').value ||
      selected.length < 1 || selected.length > 4 || !$('formatAccepted').checked;
    $('scanSubmit').disabled = busy || !authenticated || !$('scanFile').files.length;
    $('confirmSubmit').disabled = busy || !authenticated || !canConfirm();
    updatePlanningControls();
    $('reviewRows').querySelectorAll('input').forEach((input) => { input.disabled = busy || confirmed; });
    $('decisionCount').textContent = scan ?
      `${decisions.size} de ${rows().length} filas con decisión explícita.${canConfirm() ? ' Listo para confirmar.' : ''}` :
      'No hay filas para confirmar.';
  }

  async function run(action) {
    if (busy) return;
    busy = true;
    $('workspace').setAttribute('aria-busy', 'true');
    updateControls();
    try { await action(); } catch (error) {
      if ($('workspace').hidden) $('loginPanel').hidden = false;
      if (!scan && /Procesando/.test($('scanSummary').textContent)) $('scanSummary').textContent = 'No hay un escaneo procesado. Selecciona un PDF y vuelve a intentarlo.';
      message(error.message || 'No fue posible completar la operación.', true);
    }
    finally {
      busy = false;
      $('workspace').setAttribute('aria-busy', 'false');
      updateControls();
    }
  }

  function renderCatalog() {
    $('crew').replaceChildren(node('option', 'Seleccionar cuadrilla'));
    $('crew').firstChild.value = '';
    catalog.crews.forEach((crew) => {
      const option = node('option', crew.name);
      option.value = String(crew.id);
      $('crew').append(option);
    });
    $('courses').replaceChildren();
    catalog.courses.forEach((course, index) => {
      const label = node('label', undefined, 'check course');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = String(course.id);
      input.id = `course-${index}`;
      const text = node('span', `${course.code} · ${course.title}`);
      if (course.content) text.append(node('small', Array.isArray(course.content) ? course.content.join('\n') : course.content));
      label.append(input, text);
      $('courses').append(label);
    });
    const today = new Date();
    $('date').value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  }

  function previewCrew() {
    const crew = catalog.crews.find((item) => String(item.id) === $('crew').value);
    $('crewPreview').replaceChildren();
    if (!crew) return;
    $('crewPreview').append(node('p', `${crew.participants.length} participantes · una firma por persona`));
    const list = node('ul', undefined, 'people');
    crew.participants.forEach((person) => {
      list.append(node('li', [person.nombre, person.rut, person.cargo, person.especialidad, person.rol].filter(Boolean).join(' · ')));
    });
    $('crewPreview').append(list);
  }

  function renderReview() {
    $('reviewRows').replaceChildren();
    $('scanSummary').textContent = `Escaneo ${scan.id} · ${scan.pages.length} páginas.${scan.duplicate ? ' Escaneo duplicado detectado; revisa sus decisiones y el historial.' : ''}`;
    scan.pages.forEach((page, pageIndex) => {
      const section = node('section', undefined, 'page');
      section.append(node('h3', `Página ${page.page}`));
      if (page.record_id === null || page.record_id === undefined || page.record_id === '') {
        section.append(node('p', `Página no identificada: ${page.reason || 'registro no reconocido'}. La confirmación está bloqueada; corrige y vuelve a subir el PDF completo.`, 'notice danger'));
      } else if (page.kind === 'evaluation' && page.evaluation) {
        const how = page.evaluation.method === 'qr' ? 'por su código QR' : 'por el título RF y el nombre del pie (lectura de texto)';
        section.append(node('p', `Evaluación ${page.evaluation.code} de ${page.evaluation.nombre}, identificada ${how}. Es evidencia de la evaluación: no cambia aprobaciones.`, 'hint'));
        const preview = safeURL(page.preview_url);
        if (preview) {
          const image = document.createElement('img');
          image.src = preview;
          image.alt = `Encabezado y pie de la evaluación, página ${page.page}`;
          image.loading = 'lazy';
          section.append(image, link(page.preview_url, 'Abrir recorte'));
        }
      } else {
        section.append(node('p', `Registro identificado: ${page.record_id}`, 'hint'));
      }
      page.rows.forEach((row, rowIndex) => {
        const article = node('article', undefined, 'row');
        const info = node('div');
        info.append(node('strong', row.nombre || 'Nombre no identificado'), node('p', `RUT: ${row.rut || 'no identificado'}`));
        const suggestions = { FIRMO: 'Firmó', NO_FIRMO: 'No firmó', REVISAR: 'Requiere revisión' };
        info.append(node('p', `Sugerencia: ${suggestions[row.suggested] || 'Requiere revisión'}. ${row.reason || ''}`, 'hint'));
        const crop = node('div');
        const url = safeURL(row.image_url);
        if (url) {
          const image = document.createElement('img');
          image.src = url;
          image.alt = `Recorte de firma, página ${page.page}, fila ${rowIndex + 1}`;
          image.loading = 'lazy';
          image.addEventListener('error', () => { image.replaceWith(node('p', 'No se pudo cargar el recorte. No confirmes sin verificar la evidencia.', 'notice danger')); });
          crop.append(image, link(row.image_url, 'Abrir evidencia completa'));
        } else {
          crop.append(node('p', 'Recorte no disponible: verifica la evidencia antes de decidir.', 'notice danger'));
        }
        const fieldset = document.createElement('fieldset');
        fieldset.append(node('legend', `Decisión humana · fila ${rowIndex + 1}`));
        [['FIRMO', 'Firmó'], ['NO_FIRMO', 'No firmó']].forEach(([value, title]) => {
          const label = node('label', undefined, 'check');
          const input = document.createElement('input');
          input.type = 'radio';
          input.name = `decision-${pageIndex}-${rowIndex}`;
          input.value = value;
          input.addEventListener('change', () => {
            decisions.set(String(row.id), value);
            updateControls();
          });
          label.append(input, node('span', title));
          fieldset.append(label);
        });
        info.append(fieldset);
        article.append(info, crop);
        section.append(article);
      });
      $('reviewRows').append(section);
    });
  }

  function renderHistory(results) {
    $('history').replaceChildren();
    if (!results.length) {
      $('history').append(node('p', 'Aún no hay resultados de difusión registrados.'));
      return;
    }
    const table = document.createElement('table');
    table.append(node('caption', `${results.length} resultados de difusión`));
    const head = document.createElement('thead');
    const header = document.createElement('tr');
    ['Persona / RUT', 'Curso', 'Estado de firma', 'Evidencia'].forEach((title) => {
      const cell = node('th', title); cell.scope = 'col'; header.append(cell);
    });
    head.append(header);
    const body = document.createElement('tbody');
    results.forEach((result) => {
      const row = document.createElement('tr');
      const course = catalog.courses.find((item) => String(item.id) === String(result.course_id));
      row.append(node('td', [result.nombre, result.rut].filter(Boolean).join(' · ')),
        node('td', course ? `${course.code} · ${course.title}` : result.course_id),
        node('td', result.status === 'FIRMO' ? 'Firmó' : result.status === 'NO_FIRMO' ? 'No firmó' : 'Requiere revisión'));
      const evidence = node('td');
      evidence.append(link(result.evidence_url, 'Ver evidencia'));
      row.append(evidence);
      body.append(row);
    });
    table.append(head, body);
    $('history').append(table);
  }

  async function loadHistory() {
    const data = await api('/results');
    if (!Array.isArray(data.results)) throw new Error('El historial recibido no es válido.');
    renderHistory(data.results);
  }

  // ---- Planillas, cuadrillas y descargas -------------------------------------------------
  const planState = { data: null, ready: false, templates: true, picked: new Set(), cargos: new Set(), timer: 0, refresh: 0, batchRunning: false };
  const kindNames = { tarja: 'TARJA', crews: 'Cuadrillas', matrix: 'Matriz de capacitación' };

  function planMode() {
    const checked = document.querySelector('input[name=plMode]:checked');
    return checked && checked.value === 'cargos' ? 'cargos' : 'crews';
  }

  function applyMode() {
    const mode = planMode();
    $('plCrewsMode').hidden = mode !== 'crews';
    $('plCargosMode').hidden = mode !== 'cargos';
    updateControls();
  }

  function todayISO() {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  }

  function planCourses() {
    return [...$('plCourses').querySelectorAll('input[type=checkbox]:checked')].map((input) => input.value);
  }

  function resetPlanning() {
    window.clearInterval(planState.timer);
    window.clearTimeout(planState.refresh);
    Object.assign(planState, { data: null, ready: false, templates: true, timer: 0, refresh: 0, batchRunning: false });
    planState.picked.clear();
    planState.cargos.clear();
    $('plCourses').dataset.signature = '';
    $('plCourses').replaceChildren(node('p', 'Sube las planillas para ver los cursos de la matriz.', 'hint'));
    $('plCrews').replaceChildren(node('p', 'Sube las planillas para ver las cuadrillas.', 'hint'));
    $('plCargos').replaceChildren(node('p', 'Sube las planillas y elige un curso para ver los cargos.', 'hint'));
    ['plGroups', 'plResult', 'planNotices'].forEach((id) => $(id).replaceChildren());
    $('plResult').hidden = true;
    $('plProgress').textContent = '';
    $('templatesWarning').hidden = true;
    document.querySelectorAll('.source').forEach((form) => {
      form.reset();
      form.querySelector('[data-status]').textContent = 'Sin archivo activo.';
    });
    $('planForm').reset();
    $('plCrewsMode').hidden = false;
    $('plCargosMode').hidden = true;
    $('plCargoDropdown').open = false;
    $('exportExcel').hidden = true;
  }

  function renderSources(data) {
    document.querySelectorAll('.source').forEach((form) => {
      const active = data.active[form.dataset.kind];
      form.querySelector('[data-status]').textContent = active ?
        `Activa: ${active.filename} · subida ${active.uploaded_at} UTC · huella ${active.sha256}` : 'Sin archivo activo.';
    });
    planState.templates = Boolean(data.templates && data.templates.registro);
    $('templatesWarning').hidden = planState.templates;
  }

  async function loadSources() {
    const data = await api('/sources');
    if (!data || typeof data.active !== 'object' || data.active === null) throw new Error('La lista de planillas recibida no es válida.');
    renderSources(data);
  }

  function planQuery() {
    const params = new URLSearchParams();
    const codes = planCourses();
    if (codes.length) params.set('courses', codes.join(','));
    if (codes.length && planMode() === 'crews' && $('plGroup').checked && planState.picked.size) {
      params.set('group', '1');
      params.set('crews', [...planState.picked].join(','));
    }
    const query = params.toString();
    return `/plan${query ? `?${query}` : ''}`;
  }

  function renderPlanCourses(courses) {
    const box = $('plCourses');
    const signature = courses.map((course) => `${course.code}:${course.evaluation ? 1 : 0}`).join('|');
    if (box.dataset.signature === signature) return;
    const previous = new Set(planCourses());
    box.dataset.signature = signature;
    box.replaceChildren();
    courses.forEach((course, index) => {
      const wrapper = node('div', undefined, 'course-box');
      const label = node('label', undefined, 'check course');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = String(course.code);
      input.id = `plcourse-${index}`;
      input.checked = previous.has(input.value);
      label.append(input, node('span', `${course.code} · ${course.title}`));
      const evaluation = node('div', undefined, 'evaluation');
      evaluation.hidden = !input.checked;
      evaluation.append(node('p', course.evaluation ?
        'Evaluación Word cargada. Puedes reemplazarla (se guarda la versión anterior).' :
        'Falta la evaluación Word de este curso: sin ella se genera solo el registro.',
      course.evaluation ? 'hint ok' : 'hint warn'));
      const picker = node('label', course.evaluation ? 'Reemplazar evaluación (.docx)' : 'Cargar evaluación (.docx)', 'file-picker');
      const file = document.createElement('input');
      file.type = 'file';
      file.accept = '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      file.dataset.course = String(course.code);
      file.addEventListener('change', () => uploadEvaluation(course.code, file));
      picker.append(file);
      evaluation.append(picker);
      input.addEventListener('change', () => { evaluation.hidden = !input.checked; });
      wrapper.append(label, evaluation);
      box.append(wrapper);
    });
  }

  function uploadEvaluation(code, file) {
    const chosen = file.files[0];
    if (!chosen || !authenticated) return;
    if (!/\.docx$/i.test(chosen.name)) {
      file.value = '';
      message('Selecciona un archivo Word (.docx).', true);
      return;
    }
    run(async () => {
      message(`Subiendo y validando la evaluación de ${code}…`);
      const body = new FormData();
      body.append('kind', 'evaluation');
      body.append('course', code);
      body.append('file', chosen);
      const data = await api('/templates', { method: 'POST', body });
      message(`Evaluación de ${data.course} ${data.replaced ? 'reemplazada; la versión anterior quedó guardada' : 'cargada'}.`);
      await loadPlan();
    });
  }

  function renderGroupPreview(data) {
    const box = $('plGroups');
    box.replaceChildren();
    if (!$('plGroup').checked || !Array.isArray(data.groups) || !planState.picked.size) return;
    const merged = data.groups.filter((group) => Array.isArray(group) && group.length > 1);
    box.append(node('p', merged.length ? `Se agruparán ${merged.length} hoja(s):` :
      'Ninguna cuadrilla elegida se puede agrupar: se necesitan 2 o más del mismo turno con hasta 4 pendientes cada una.'));
    if (merged.length) {
      const list = node('ul');
      merged.forEach((group) => list.append(node('li', `Cuadrillas ${group.join(' + ')}`)));
      box.append(list);
    }
  }

  function syncPickedBoxes() {
    $('plCrews').querySelectorAll('input[type=checkbox]').forEach((input) => { input.checked = planState.picked.has(input.value); });
  }

  function schedulePlanRefresh() {
    updateControls();
    window.clearTimeout(planState.refresh);
    if (!$('plGroup').checked || !planState.data) return;
    planState.refresh = window.setTimeout(async () => {
      try {
        const data = await api(planQuery());
        if (planState.data && Array.isArray(data.groups)) {
          planState.data.groups = data.groups;
          renderGroupPreview(planState.data);
        }
      } catch (error) { message(error.message || 'No se pudo actualizar la vista previa de agrupación.', true); }
    }, 350);
  }

  function renderCargos(data) {
    const box = $('plCargos');
    box.replaceChildren();
    const cargos = Array.isArray(data.cargos) ? data.cargos : [];
    const valid = new Set(cargos.map((cargo) => String(cargo.key)));
    [...planState.cargos].forEach((key) => { if (!valid.has(key)) planState.cargos.delete(key); });
    if (!cargos.length) {
      box.append(node('p', 'La TARJA vigente no trae cargos.', 'hint'));
      return;
    }
    const head = node('div', undefined, 'heading');
    head.append(node('h4', `${cargos.length} cargos en la TARJA vigente`));
    const toggle = node('button', 'Marcar o desmarcar los que tienen pendientes');
    toggle.type = 'button';
    toggle.addEventListener('click', () => {
      const visible = new Set([...list.querySelectorAll('label:not([hidden]) input')].map((input) => input.value));
      const usable = cargos.filter((cargo) => cargo.pending !== 0 && visible.has(String(cargo.key))).map((cargo) => String(cargo.key));
      const all = usable.every((key) => planState.cargos.has(key));
      usable.forEach((key) => (all ? planState.cargos.delete(key) : planState.cargos.add(key)));
      box.querySelectorAll('input[type=checkbox]').forEach((input) => { input.checked = planState.cargos.has(input.value); });
      updateControls();
    });
    head.append(toggle);
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Buscar cargo…';
    search.setAttribute('aria-label', 'Buscar cargo');
    const fold = (text) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    search.addEventListener('input', () => {
      const wanted = fold(search.value.trim());
      list.querySelectorAll('label').forEach((item) => { item.hidden = !fold(item.dataset.label).includes(wanted); });
    });
    const list = node('div', undefined, 'crew-list');
    cargos.forEach((cargo) => {
      const key = String(cargo.key);
      const label = node('label', undefined, 'check crew');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = key;
      input.checked = planState.cargos.has(key);
      input.dataset.empty = cargo.pending === 0 ? '1' : '0';
      input.addEventListener('change', () => {
        if (input.checked) planState.cargos.add(key); else planState.cargos.delete(key);
        updateControls();
      });
      const text = node('span', cargo.label);
      text.append(node('small', cargo.pending === null || cargo.pending === undefined ?
        `${cargo.total} persona(s) · elige un curso para ver los pendientes` :
        `${cargo.pending} pendiente(s) de ${cargo.total}`));
      label.dataset.label = cargo.label;
      label.append(input, text);
      list.append(label);
    });
    box.append(head, search, list);
  }

  function renderPlan() {
    const data = planState.data;
    $('plCrews').replaceChildren();
    $('plGroups').replaceChildren();
    $('planNotices').replaceChildren();
    if (!data) {
      planState.ready = false;
      $('plCourses').dataset.signature = '';
      $('plCourses').replaceChildren(node('p', 'Sube las tres planillas para ver los cursos de la matriz.', 'hint'));
      $('plCrews').append(node('p', 'Sube las tres planillas para ver las cuadrillas.', 'hint'));
      $('plCargos').replaceChildren(node('p', 'Sube las tres planillas para ver los cargos.', 'hint'));
      updateControls();
      return;
    }
    planState.ready = true;
    renderPlanCourses(data.courses);
    renderCargos(data);
    const warnings = data.warnings || {};
    if (warnings.hoja) {
      const when = warnings.fecha_planificacion ? ` con fecha ${warnings.fecha_planificacion}` : '';
      $('planNotices').append(node('p', `Cuadrillas leídas de la hoja «${warnings.hoja}»${when}: cada fila CAPATAZ abre una cuadrilla y las filas siguientes son su equipo.`, 'notice'));
    }
    [['sin_capataz', 'cuadrilla(s) sin capataz (personal que aparece antes del primer capataz del archivo)'],
      ['capataz_no_hallado', 'cuadrilla(s) con capataz que no se encontró en la TARJA vigente: no se agrega solo'],
      ['turno_mixto', 'cuadrilla(s) con integrantes de otro turno que su capataz (manda el turno del capataz)'],
      ['no_trabajando', 'persona(s) que no figuran como «Trabajando» ese día (por ejemplo en inducción): se omiten'],
      ['excluidos', 'persona(s) de las cuadrillas sin vigencia en la TARJA: se omiten']].forEach(([key, text]) => {
      if (warnings[key]) $('planNotices').append(node('p', `${warnings[key]} ${text}.`, 'notice'));
    });
    const valid = new Set(data.crews.map((crew) => String(crew.id)));
    [...planState.picked].forEach((id) => { if (!valid.has(id)) planState.picked.delete(id); });
    ['Turno Día', 'Turno Noche', 'Sin turno'].forEach((shift) => {
      const crews = data.crews.filter((crew) => crew.shift === shift);
      if (!crews.length) return;
      const section = node('div', undefined, 'shift');
      const head = node('div', undefined, 'heading');
      head.append(node('h4', `${shift} · ${crews.length} cuadrillas`));
      const toggle = node('button', 'Marcar o desmarcar las que tienen pendientes');
      toggle.type = 'button';
      toggle.addEventListener('click', () => {
        const usable = crews.filter((crew) => crew.pending !== 0).map((crew) => String(crew.id));
        const all = usable.every((id) => planState.picked.has(id));
        usable.forEach((id) => (all ? planState.picked.delete(id) : planState.picked.add(id)));
        syncPickedBoxes();
        schedulePlanRefresh();
      });
      head.append(toggle);
      section.append(head);
      const list = node('div', undefined, 'crew-list');
      crews.forEach((crew) => {
        const id = String(crew.id);
        const label = node('label', undefined, 'check crew');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = id;
        input.checked = planState.picked.has(id);
        input.dataset.empty = crew.pending === 0 ? '1' : '0';
        input.addEventListener('change', () => {
          if (input.checked) planState.picked.add(id); else planState.picked.delete(id);
          schedulePlanRefresh();
        });
        const detail = [crew.pending === null ? `${crew.members} integrantes` : `${crew.pending} pendientes de ${crew.members}`];
        if (!crew.foreman_found) detail.push('capataz no hallado en TARJA');
        if (crew.shift_mixed) detail.push('turno mixto');
        const text = node('span', crew.name);
        text.append(node('small', detail.join(' · ')));
        label.append(input, text);
        list.append(label);
      });
      section.append(list);
      $('plCrews').append(section);
    });
    renderGroupPreview(data);
    updateControls();
  }

  async function loadPlan() {
    let data;
    try {
      data = await api(planQuery());
    } catch (error) {
      if (!/Faltan planillas/.test(error.message || '')) throw error;
      planState.data = null;
      renderPlan();
      return;
    }
    if (!Array.isArray(data.crews) || !Array.isArray(data.courses)) throw new Error('El plan recibido no es válido.');
    planState.data = data;
    renderPlan();
  }

  async function refreshPlanning() {
    if (!$('plDate').value) $('plDate').value = todayISO();
    await loadSources();
    await loadPlan();
  }

  function updatePlanningControls() {
    const codes = planCourses();
    const locked = busy || planState.batchRunning;
    $('plCourses').querySelectorAll('input[type=checkbox]').forEach((input) => { input.disabled = locked || (codes.length >= 4 && !input.checked); });
    $('plCourses').querySelectorAll('input[type=file]').forEach((input) => { input.disabled = locked; });
    $('plCrews').querySelectorAll('input, button').forEach((element) => { element.disabled = locked || element.dataset.empty === '1'; });
    $('plCargos').querySelectorAll('input, button').forEach((element) => { element.disabled = locked || element.dataset.empty === '1'; });
    document.querySelectorAll('input[name=plMode]').forEach((element) => { element.disabled = locked; });
    $('plRelator').disabled = locked;
    $('plGroup').disabled = locked;
    $('plCourseCount').textContent = `${codes.length} de 4 seleccionados`;
    $('plCrewCount').textContent = `${planState.picked.size} cuadrilla(s) seleccionada(s)`;
    $('plCargoCount').textContent = `${planState.cargos.size} cargo(s) seleccionado(s)`;
    const names = ((planState.data && planState.data.cargos) || [])
      .filter((cargo) => planState.cargos.has(String(cargo.key))).map((cargo) => cargo.label);
    $('plCargoSummary').textContent = names.length ? `${names.length} elegido(s): ${names.join(', ')}` : 'Elegir cargos…';
    document.querySelectorAll('.source').forEach((form) => {
      form.querySelector('button').disabled = locked || !form.querySelector('input').files.length;
    });
    const chosen = planMode() === 'cargos' ? planState.cargos.size : planState.picked.size;
    $('plGenerate').disabled = locked || !authenticated || !planState.ready || !planState.templates ||
      !$('plDate').value || codes.length < 1 || codes.length > 4 || chosen < 1;
  }

  async function finishBatch(status) {
    let records = [];
    if (status.records.length) {
      const data = await api('/records');
      const wanted = new Set(status.records);
      records = (Array.isArray(data.records) ? data.records : []).filter((item) => wanted.has(item.id));
    }
    const box = $('plResult');
    box.replaceChildren();
    const problems = status.errors.length ? ` · ${status.errors.length} con problemas` : '';
    box.append(node('p', `${status.records.length} documento(s) generado(s)${problems}${status.status === 'failed' ? ' · el lote se interrumpió' : ''}.`));
    if (status.records.length) {
      box.append(link(status.zip_url, 'Descargar ZIP (una carpeta por turno, o «Por cargo»)', 'download'));
      const list = node('ul', undefined, 'people');
      records.forEach((item) => {
        const missing = item.summary && Array.isArray(item.summary.courses_without_evaluation) ? item.summary.courses_without_evaluation : [];
        const li = node('li', `${item.crew} · ${item.shift || 'Sin turno'} · ${item.participants} persona(s) · ${item.pages} hoja(s)${missing.length ? ` · sin evaluación para ${missing.join(', ')}` : ''} · `);
        li.append(link(item.bundle_url, 'PDF registro + evaluaciones'));
        list.append(li);
      });
      box.append(list);
    }
    if (status.errors.length) {
      const list = node('ul', undefined, 'people');
      status.errors.forEach((item) => list.append(node('li', `Cuadrilla ${item.crew_id}: ${item.error}`)));
      box.append(node('p', 'No se pudieron generar estos documentos:', 'notice danger'), list);
    }
    box.hidden = false;
    $('plProgress').textContent = 'Listo. Imprime, recoge las firmas y sube el escaneo en el paso 2.';
    message('Generación terminada.');
    updateControls();
  }

  function startPolling(batch) {
    window.clearInterval(planState.timer);
    planState.batchRunning = true;
    const epoch = generation;
    $('plProgress').textContent = `Generando 0 de ${batch.total} documentos…`;
    planState.timer = window.setInterval(async () => {
      try {
        const status = await api(`/batches/${encodeURIComponent(String(batch.id))}`);
        if (epoch !== generation) return;
        $('plProgress').textContent = `Generando ${status.done} de ${status.total} documentos…`;
        if (status.status !== 'running') {
          window.clearInterval(planState.timer);
          planState.batchRunning = false;
          await finishBatch(status);
        }
      } catch (error) {
        window.clearInterval(planState.timer);
        planState.batchRunning = false;
        message(error.message || 'No se pudo consultar el avance de la generación.', true);
        updateControls();
      }
    }, 2000);
    updateControls();
  }

  async function openWorkspace(session) {
    if (!session.authenticated) {
      clearSensitive();
      message('Ingresa con tu cuenta privada NAMI.');
      return;
    }
    if (typeof session.csrf !== 'string' || !session.csrf) {
      clearSensitive();
      throw new Error('El servicio no entregó la protección de sesión. Vuelve a ingresar.');
    }
    authenticated = true;
    csrf = session.csrf;
    $('logout').hidden = false;
    $('loginForm').reset();
    const data = await api('/catalog');
    if (!Array.isArray(data.crews) || !Array.isArray(data.courses) ||
        data.crews.some((crew) => !Array.isArray(crew.participants))) throw new Error('El catálogo recibido no es válido. Comprueba el servicio nuevamente.');
    catalog = data;
    renderCatalog();
    $('loginPanel').hidden = true;
    $('workspace').hidden = false;
    $('logout').hidden = false;
    message('Sesión privada activa. Sube las planillas y prepara los registros, o sube un escaneo.');
    $('exportExcel').hidden = false;
    await refreshPlanning();
    await loadHistory();
  }

  $('loginForm').addEventListener('submit', (event) => {
    event.preventDefault();
    run(async () => {
      message('Validando acceso…');
      try {
        const data = await post('/login', { username: $('username').value, password: $('password').value });
        await openWorkspace(data);
      } finally { $('password').value = ''; }
    });
  });
  $('retrySession').addEventListener('click', () => run(async () => { await openWorkspace(await api('/session')); }));
  $('logout').addEventListener('click', () => run(async () => {
    let loggedOut = false;
    try { await post('/logout', {}); loggedOut = true; }
    finally {
      clearSensitive();
      message(loggedOut ? 'Sesión cerrada. Archivos, recortes e historial borrados de la vista.' :
        'Vista borrada. No se pudo verificar el cierre de sesión en el servidor; vuelve a intentarlo tras ingresar.', !loggedOut);
    }
  }));
  $('crew').addEventListener('change', () => { previewCrew(); updateControls(); });
  document.querySelectorAll('.source').forEach((form) => {
    form.querySelector('input').addEventListener('change', updateControls);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const file = form.querySelector('input').files[0];
      if (!file || !authenticated) return;
      const kind = form.dataset.kind;
      run(async () => {
        message(`Subiendo y validando ${kindNames[kind]}…`);
        const body = new FormData();
        body.append('kind', kind);
        body.append('file', file);
        const data = await api('/sources', { method: 'POST', body });
        form.reset();
        message(`${kindNames[kind]} ${data.duplicate ? 'ya estaba subida: se volvió a activar' : 'subida y validada'}.`);
        await refreshPlanning();
      });
    });
  });
  $('plCourses').addEventListener('change', (event) => { if (event.target.type !== 'file') run(loadPlan); });
  $('plGroup').addEventListener('change', () => run(loadPlan));
  document.querySelectorAll('input[name=plMode]').forEach((radio) => radio.addEventListener('change', applyMode));
  document.addEventListener('click', (event) => {
    const menu = $('plCargoDropdown');
    if (menu.open && !menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener('keydown', (event) => {
    const menu = $('plCargoDropdown');
    if (event.key === 'Escape' && menu.open) {
      menu.open = false;
      $('plCargoSummary').focus();
    }
  });
  $('planForm').addEventListener('input', updateControls);
  $('planForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const codes = planCourses();
    const byCargo = planMode() === 'cargos';
    const chosen = byCargo ? planState.cargos.size : planState.picked.size;
    if (!authenticated || !planState.ready || !chosen || codes.length < 1 || !$('planForm').reportValidity()) return;
    run(async () => {
      $('plResult').replaceChildren();
      $('plResult').hidden = true;
      const body = { date: $('plDate').value, courses: codes };
      if (byCargo) {
        body.cargos = planState.data.cargos.map((cargo) => String(cargo.key)).filter((key) => planState.cargos.has(key));
      } else {
        body.crew_ids = planState.data.crews.map((crew) => String(crew.id)).filter((id) => planState.picked.has(id));
        body.group_small = $('plGroup').checked;
      }
      const objectives = $('plObjectives').value.trim();
      if (objectives) body.objectives = objectives;
      const relator = $('plRelator').value.trim();
      if (relator) body.relator = relator;
      message('Iniciando la generación…');
      const batch = await post('/batches', body);
      if (!batch || typeof batch.id !== 'string') throw new Error('El servicio devolvió un lote no válido.');
      startPolling(batch);
      message('Generando. Puedes seguir el avance en «Descargas».');
    });
  });
  $('recordForm').addEventListener('change', updateControls);
  $('scanFile').addEventListener('change', updateControls);
  $('recordForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const courses = selectedCourses();
    if (!authenticated || courses.length < 1 || courses.length > 4 || !$('formatAccepted').checked || !$('recordForm').reportValidity()) return;
    run(async () => {
      $('recordOutput').replaceChildren();
      $('recordOutput').hidden = true;
      message('Generando registro…');
      const data = await post('/records', {
        crew_id: catalog.crews.find((crew) => String(crew.id) === $('crew').value).id,
        date: $('date').value,
        courses: courses.map((id) => catalog.courses.find((course) => String(course.id) === id).id),
        format_accepted: true
      });
      if (!safeURL(data.pdf_url)) throw new Error('El servicio devolvió una URL de PDF no autorizada.');
      const pageCount = Array.isArray(data.pages) ? data.pages.length : data.pages;
      $('recordOutput').append(node('p', `Registro ${data.id} generado · ${pageCount ?? '—'} páginas.`), link(data.pdf_url, 'Descargar PDF autenticado', 'download'));
      $('recordOutput').hidden = false;
      message('PDF listo. Valida el formato, imprime y recoge las firmas.');
    });
  });
  $('scanForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const file = $('scanFile').files[0];
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== 'application/pdf')) {
      message('Selecciona un archivo PDF escaneado.', true);
      return;
    }
    run(async () => {
      scan = null;
      confirmed = false;
      decisions.clear();
      $('reviewRows').replaceChildren();
      $('confirmation').hidden = true;
      $('scanSummary').textContent = 'Procesando escaneo…';
      message('Subiendo y procesando PDF…');
      const form = new FormData();
      form.append('file', file);
      const data = await api('/scans', { method: 'POST', body: form });
      if (data.id === undefined || data.id === null || !Array.isArray(data.pages) ||
          data.pages.some((page) => !Array.isArray(page.rows))) throw new Error('El servicio devolvió un escaneo no válido.');
      const allRows = data.pages.flatMap((page) => page.rows);
      if (allRows.some((row) => row.id === undefined || row.id === null) ||
          new Set(allRows.map((row) => String(row.id))).size !== allRows.length) throw new Error('Las filas del escaneo no tienen identificadores únicos. No se puede confirmar.');
      scan = data;
      renderReview();
      message('Escaneo recibido. Revisa los recortes y decide cada fila.');
      $('reviewTitle').tabIndex = -1;
      $('reviewTitle').focus();
    });
  });
  $('confirmSubmit').addEventListener('click', () => {
    if (!canConfirm()) return;
    run(async () => {
      message('Guardando decisiones de difusión…');
      const data = await post(`/scans/${encodeURIComponent(String(scan.id))}/confirm`, {
        decisions: rows().map((row) => ({ row_id: row.id, status: decisions.get(String(row.id)) }))
      });
      if (data.confirmed !== true || !Array.isArray(data.results)) throw new Error('El servicio no confirmó el guardado. Actualiza el historial antes de reintentar.');
      confirmed = true;
      $('scanFile').value = '';
      $('confirmation').textContent = `${data.duplicate ? 'Confirmación duplicada reconocida por el servicio.' : 'Difusión confirmada.'} ${data.results.length} resultados por persona y curso. No acredita aprobación de evaluaciones.`;
      $('confirmation').hidden = false;
      renderHistory(data.results);
      message('Decisiones guardadas. Actualizando historial…');
      await loadHistory();
      message('Difusión confirmada e historial actualizado.');
    });
  });
  $('refreshHistory').addEventListener('click', () => run(async () => {
    message('Consultando historial…');
    await loadHistory();
    message('Historial actualizado.');
  }));
  run(async () => { await openWorkspace(await api('/session')); });
})();
