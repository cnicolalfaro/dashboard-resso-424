(function (root) {
  "use strict";
  const BASE_URL = "https://bvjhqfznfyogqxwdeogb.supabase.co/rest/v1";
  const PUBLIC_KEY = "sb_publishable_TDmxypbRqd-Fs2g4S_s5LQ_o7Dm4S5Q";
  const PAGE_SIZE = 25;

  function thread(version, question) {
    if (!["v10", "v11"].includes(version) || !Number.isInteger(question) || question < 1 || question > 40) {
      throw new Error("Versión o pregunta inválida.");
    }
    return { version, question };
  }

  function validate(author, body) {
    const result = { author: author.trim(), body: body.trim() };
    if (!result.author || [...result.author].length > 80) {
      throw new Error("Escribe tu nombre (entre 1 y 80 caracteres).");
    }
    if (!result.body || [...result.body].length > 3000) {
      throw new Error("Escribe una observación (entre 1 y 3000 caracteres).");
    }
    return result;
  }

  function listURL(version, question, cursor) {
    thread(version, question);
    const params = new URLSearchParams({
      select: "id,version,question,author,body,created_at",
      version: `eq.${version}`, question: `eq.${question}`,
      order: "created_at.desc,id.desc", limit: String(PAGE_SIZE)
    });
    if (cursor) {
      if (!/^[0-9a-f-]{36}$/i.test(cursor.id) ||
          !/^\d{4}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:\d\d)$/.test(cursor.created_at)) {
        throw new Error("Cursor de historial inválido.");
      }
      params.set("or", `(created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id}))`);
    }
    return `${BASE_URL}/resso_observations?${params}`;
  }

  async function request(url, options = {}) {
    let response;
    try {
      response = await fetch(url, {
        ...options,
        headers: { apikey: PUBLIC_KEY, "Content-Type": "application/json", ...options.headers },
        signal: AbortSignal.timeout(20000)
      });
    } catch (error) {
      throw new Error("No se pudo contactar al historial compartido. Revisa tu conexión y vuelve a intentar; no se guardó una copia local.");
    }
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error("El historial aún no está habilitado en Supabase. Falta ejecutar el SQL de configuración.");
      }
      let detail;
      try { detail = await response.json(); } catch (error) {
        throw new Error(`El servicio respondió con error HTTP ${response.status}.`);
      }
      if (detail.code === "P0001") throw new Error(detail.message);
      throw new Error(`No se pudo completar la operación (HTTP ${response.status}). Revisa la configuración y los permisos de Supabase.`);
    }
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error("El servicio devolvió un historial inválido.");
    return data;
  }

  const api = { thread, validate, listURL };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (!root.document) return;

  const version = location.pathname.includes("/evidencias-v11/") ? "v11" : "v10";
  const modal = document.getElementById("modalBg");
  if (!modal) throw new Error("No se encontró el detalle de requisitos para las observaciones.");
  const panel = document.createElement("section");
  panel.className = "resso-observations";
  panel.setAttribute("aria-label", "Observaciones compartidas");
  panel.innerHTML = `
    <h3>Observaciones compartidas <span data-obs="thread"></span></h3>
    <p class="obs-notice">Historial público, separado de las observaciones del Excel. Cualquier visitante puede leer y agregar.
      La clave del dashboard no protege estos comentarios. No incluyas datos personales ni información confidencial.
      El nombre del autor es declarado, no verificado. Los aportes no se editan ni borran desde la página.</p>
    <button type="button" data-obs="refresh">Actualizar historial</button>
    <p data-obs="read-status" role="status" aria-live="polite"></p>
    <ol data-obs="history" class="obs-history"></ol>
    <button type="button" data-obs="older" hidden>Ver observaciones anteriores</button>
    <form data-obs="form">
      <label>Tu nombre (visible para todos)
        <input data-obs="author" required maxlength="80" autocomplete="name" placeholder="Nombre o identificación de equipo">
      </label>
      <label>Nueva observación
        <textarea data-obs="body" required maxlength="3000" rows="4" placeholder="Agrega avances, acuerdos o información complementaria."></textarea>
      </label>
      <p>Al enviar se agregará un registro nuevo, con fecha del servidor; no reemplaza los anteriores.</p>
      <button type="submit" data-obs="submit">Agregar observación compartida</button>
      <p data-obs="write-status" role="status" aria-live="polite"></p>
    </form>`;
  modal.querySelector(".modal-body").appendChild(panel);
  const el = key => panel.querySelector(`[data-obs="${key}"]`);
  let current = null, revision = 0, cursor = null, loading = false;
  const drafts = new Map(), pending = new Map(), sending = new Set();
  const keyOf = value => `${value.version}:${value.question}`;

  function status(key, message, error = false) {
    el(key).textContent = message;
    el(key).className = error ? "obs-error" : "";
  }

  function rememberDraft() {
    if (current) drafts.set(keyOf(current), { author: el("author").value, body: el("body").value });
  }

  function renderRows(rows) {
    for (const row of rows) {
      if (row.version !== current.version || row.question !== current.question ||
          typeof row.id !== "string" || typeof row.author !== "string" ||
          typeof row.body !== "string" || !Number.isFinite(Date.parse(row.created_at))) {
        throw new Error("El servicio devolvió una observación inválida o de otra pregunta.");
      }
    }
    const known = new Set([...el("history").children].map(node => node.dataset.id));
    for (const row of rows) {
      if (known.has(row.id)) continue;
      const item = document.createElement("li");
      item.dataset.id = row.id;
      const title = document.createElement("strong");
      title.textContent = row.author;
      const date = document.createElement("time");
      date.dateTime = row.created_at;
      date.textContent = new Date(row.created_at).toLocaleString("es-CL");
      const text = document.createElement("p");
      text.textContent = row.body;
      item.append(title, date, text);
      el("history").appendChild(item);
      known.add(row.id);
    }
  }

  async function load(older = false) {
    if (!current || loading) return;
    const token = revision, captured = current;
    loading = true;
    el("refresh").disabled = el("older").disabled = true;
    status("read-status", "Consultando historial compartido…");
    try {
      const rows = await request(listURL(captured.version, captured.question, older ? cursor : null));
      if (revision !== token) return;
      if (!older) el("history").replaceChildren();
      renderRows(rows);
      cursor = rows.length ? rows[rows.length - 1] : cursor;
      el("older").hidden = rows.length < PAGE_SIZE;
      status("read-status", el("history").children.length
        ? `${el("history").children.length} observaciones visibles, más recientes primero.`
        : "Todavía no hay observaciones compartidas para esta pregunta.");
    } catch (error) {
      if (revision === token) status("read-status", error.message, true);
    } finally {
      if (revision === token) {
        loading = false;
        el("refresh").disabled = el("older").disabled = false;
      }
    }
  }

  root.RessoObservations = {
    open(question) {
      const next = thread(version, question);
      rememberDraft();
      current = next;
      revision++;
      loading = false;
      cursor = null;
      el("history").replaceChildren();
      el("older").hidden = true;
      el("refresh").disabled = false;
      el("thread").textContent = `${version.toUpperCase()} · Pregunta ${String(question).padStart(2, "0")}`;
      const draft = drafts.get(keyOf(next)) || { author: "", body: "" };
      el("author").value = draft.author;
      el("body").value = draft.body;
      el("submit").disabled = sending.has(keyOf(next));
      status("write-status", sending.has(keyOf(next)) ? "Envío en curso para esta pregunta…" : "");
      load();
    }
  };
  el("refresh").addEventListener("click", () => load());
  el("older").addEventListener("click", () => load(true));
  el("author").addEventListener("input", rememberDraft);
  el("body").addEventListener("input", rememberDraft);
  el("form").addEventListener("submit", async event => {
    event.preventDefault();
    if (!current) return;
    const captured = current, key = keyOf(captured);
    if (sending.has(key)) return;
    let value;
    try { value = validate(el("author").value, el("body").value); } catch (error) {
      status("write-status", error.message, true);
      return;
    }
    rememberDraft();
    const fingerprint = JSON.stringify(value);
    if (!pending.has(key) || pending.get(key).fingerprint !== fingerprint) {
      pending.set(key, { fingerprint, id: crypto.randomUUID() });
    }
    sending.add(key);
    el("submit").disabled = true;
    status("write-status", "Enviando al historial compartido…");
    try {
      const rows = await request(`${BASE_URL}/rpc/append_resso_observation`, {
        method: "POST",
        body: JSON.stringify({
          p_request_id: pending.get(key).id, p_version: captured.version,
          p_question: captured.question, p_author: value.author, p_body: value.body
        })
      });
      if (rows.length !== 1 || rows[0].version !== captured.version || rows[0].question !== captured.question ||
          rows[0].author !== value.author || rows[0].body !== value.body || !rows[0].id) {
        throw new Error("No se pudo confirmar el registro. Reintenta sin cambiar el texto para evitar duplicados.");
      }
      pending.delete(key);
      const draft = drafts.get(key);
      if (!draft || (draft.author.trim() === value.author && draft.body.trim() === value.body)) {
        drafts.set(key, { author: value.author, body: "" });
      }
      if (current && keyOf(current) === key) {
        if (el("author").value.trim() === value.author && el("body").value.trim() === value.body) el("body").value = "";
        status("write-status", "Observación registrada y compartida. Los aportes anteriores se mantienen.");
        revision++;
        loading = false;
        await load();
      }
    } catch (error) {
      if (current && keyOf(current) === key) {
        status("write-status", `${error.message} Si hubo un corte de conexión, reintenta aquí con el mismo texto, sin recargar la página, para evitar duplicados.`, true);
      }
    } finally {
      sending.delete(key);
      if (current && keyOf(current) === key) el("submit").disabled = false;
    }
  });
})(globalThis);
