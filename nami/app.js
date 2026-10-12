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
      if (!scan) $('scanSummary').textContent = 'No hay un escaneo procesado. Selecciona un PDF y vuelve a intentarlo.';
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
    message('Sesión privada activa. Prepara un registro o sube uno anterior.');
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
