(function (root) {
  "use strict";
  const BASE = "https://bvjhqfznfyogqxwdeogb.supabase.co/storage/v1";
  const KEY = "sb_publishable_TDmxypbRqd-Fs2g4S_s5LQ_o7Dm4S5Q";
  const BUCKET = "resso-previews";
  const SIZE = 50;
  function prefix(version, question) {
    if (!["v10", "v11"].includes(version) || !Number.isInteger(question) || question < 1 || question > 40) {
      throw new Error("Versión o pregunta inválida para el visor.");
    }
    return `${version}/${String(question).padStart(2, "0")}`;
  }
  function fileURL(folder, name) {
    if (!/^v(10|11)\/(0[1-9]|[12]\d|3\d|40)$/.test(folder) ||
        typeof name !== "string" || /[/\\]/.test(name) ||
        !/\.(pdf|png|jpe?g|webp|gif)$/i.test(name)) {
      throw new Error("Archivo de vista previa inválido. Solo PDF e imágenes.");
    }
    return `${BASE}/object/public/${BUCKET}/${folder}/${encodeURIComponent(name)}`;
  }
  if (typeof module !== "undefined" && module.exports) module.exports = { prefix, fileURL };
  if (!root.document) return;
  const host = document.querySelector("#evidenceBg .modal-body");
  if (!host) throw new Error("No se encontró el pop-up de evidencias.");
  const panel = document.createElement("section");
  panel.className = "resso-previews";
  panel.innerHTML = `
    <h3>Visor de copias públicas <span data-preview="folder"></span></h3>
    <p>PDF e imágenes publicados para este requisito. Son copias de consulta, no se sincronizan con SharePoint.
      Los enlaces al original se mantienen más abajo. No publicar información confidencial ni datos personales.</p>
    <button type="button" class="action-btn secondary" data-preview="refresh">Actualizar vistas previas</button>
    <p data-preview="status" role="status" aria-live="polite"></p>
    <div data-preview="files" class="preview-files"></div>
    <button type="button" class="action-btn secondary" data-preview="more" hidden>Ver más archivos</button>
    <section data-preview="viewer" hidden>
      <div class="preview-heading">
        <strong data-preview="title"></strong>
        <button type="button" class="action-btn secondary" data-preview="close">Cerrar vista previa</button>
      </div>
      <iframe data-preview="pdf" title="Vista previa PDF" hidden></iframe>
      <img data-preview="image" alt="" hidden>
      <p data-preview="media-status" role="status"></p>
      <a data-preview="download" target="_blank" rel="noopener">Abrir copia pública / descargar ↗</a>
      <p>Si tu navegador no admite PDF integrados, usa el enlace anterior.</p>
    </section>`;
  host.prepend(panel);
  const el = key => panel.querySelector(`[data-preview="${key}"]`);
  const version = location.pathname.includes("/evidencias-v11/") ? "v11" : "v10";
  let folder = null, revision = 0, offset = 0, busy = false;
  function status(text, error = false) {
    el("status").textContent = text;
    el("status").className = error ? "preview-error" : "";
  }
  function close() {
    el("viewer").hidden = true;
    el("pdf").removeAttribute("src");
    el("image").removeAttribute("src");
    el("pdf").hidden = el("image").hidden = true;
    el("media-status").textContent = "";
  }
  function show(name) {
    close();
    const url = fileURL(folder, name);
    el("title").textContent = name;
    el("download").href = url;
    el("viewer").hidden = false;
    if (/\.pdf$/i.test(name)) {
      el("pdf").src = url;
      el("pdf").hidden = false;
    } else {
      el("image").alt = name;
      el("image").src = url;
      el("image").hidden = false;
    }
    el("viewer").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  async function load(more = false) {
    if (!folder || busy) return;
    const token = revision, captured = folder;
    busy = true;
    el("refresh").disabled = el("more").disabled = true;
    status("Consultando vistas previas públicas…");
    try {
      const response = await fetch(`${BASE}/object/list/${BUCKET}`, {
        method: "POST",
        headers: { apikey: KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ prefix: captured, limit: SIZE, offset: more ? offset : 0,
          sortBy: { column: "name", order: "asc" } }),
        signal: AbortSignal.timeout(20000)
      });
      if (!response.ok) throw new Error(`No se pudo consultar el visor (HTTP ${response.status}). Revisa la conexión y la configuración del bucket en Supabase.`);
      const rows = await response.json();
      if (!Array.isArray(rows) || rows.some(row => typeof row.name !== "string")) {
        throw new Error("El servicio devolvió una lista de archivos inválida.");
      }
      if (token !== revision) return;
      if (!more) {
        el("files").replaceChildren();
        offset = 0;
      }
      for (const row of rows) {
        if (!row.id || !/\.(pdf|png|jpe?g|webp|gif)$/i.test(row.name)) continue;
        fileURL(captured, row.name);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "action-btn secondary";
        button.textContent = `Ver ${row.name}`;
        button.addEventListener("click", () => show(row.name));
        el("files").appendChild(button);
      }
      offset += rows.length;
      el("more").hidden = rows.length < SIZE;
      status(el("files").children.length
        ? `${el("files").children.length} archivos disponibles. Selecciona uno para verlo aquí.`
        : `No hay vistas previas visibles en ${BUCKET}/${captured}. El administrador debe cargar los archivos y habilitar la lectura del bucket.`);
    } catch (error) {
      if (token === revision) status(`${error.message} No se pudo confirmar el listado; pulsa Actualizar para reintentar.`, true);
    } finally {
      if (token === revision) {
        busy = false;
        el("refresh").disabled = el("more").disabled = false;
      }
    }
  }
  root.RessoPreviews = {
    open(question) {
      folder = prefix(version, question);
      revision++;
      busy = false;
      offset = 0;
      close();
      el("files").replaceChildren();
      el("more").hidden = true;
      el("folder").textContent = `${version.toUpperCase()} · Pregunta ${String(question).padStart(2, "0")}`;
      load();
    },
    close() {
      revision++;
      busy = false;
      close();
    }
  };
  el("refresh").addEventListener("click", () => load());
  el("more").addEventListener("click", () => load(true));
  el("close").addEventListener("click", close);
  el("image").addEventListener("error", () => {
    if (!el("image").hidden) el("media-status").textContent = "No se pudo cargar la imagen. Revisa que el archivo siga disponible.";
  });
})(globalThis);
