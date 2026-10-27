(function (root) {
  "use strict";

  function normalize(map) {
    if (!map || typeof map !== "object" || Array.isArray(map)) {
      throw new Error("El catálogo debe ser un mapa de requisitos.");
    }
    const result = {};
    for (const [id, value] of Object.entries(map)) {
      if (!/^[1-9]\d*$/.test(id) || Number(id) > 40) {
        throw new Error(`Requisito inválido: ${id}`);
      }
      const files = Array.isArray(value) ? value : [value];
      result[id] = [];
      for (const file of files) {
        if (!file || typeof file.url !== "string" ||
            (file.name !== undefined && typeof file.name !== "string") ||
            (file.localPath !== undefined && typeof file.localPath !== "string")) {
          throw new Error(`Archivo inválido en requisito ${id}.`);
        }
        const url = new URL(file.url);
        if (url.protocol !== "https:" || url.hostname !== "empresassk.sharepoint.com" ||
            url.username || url.password) {
          throw new Error(`El requisito ${id} contiene un enlace ajeno a SharePoint de Empresas SK.`);
        }
        if (!result[id].some(saved => saved.url === file.url)) {
          result[id].push({
            name: file.name || `Evidencia requisito ${id}`,
            url: file.url,
            ...(file.localPath ? { localPath: file.localPath } : {})
          });
        }
      }
    }
    return result;
  }

  function merge(shared, local) {
    const result = normalize(shared);
    for (const [id, files] of Object.entries(normalize(local))) {
      result[id] = result[id] || [];
      for (const file of files) {
        if (!result[id].some(saved => saved.url === file.url)) result[id].push(file);
      }
    }
    return result;
  }

  function exportCatalog(version, shared, local) {
    if (!["v10", "v11"].includes(version)) throw new Error("Versión de RESSO inválida.");
    const evidence = {};
    let skipped = 0;
    for (const [id, files] of Object.entries(merge(shared, local))) {
      const portable = files.filter(file => {
        if (file.localPath) { skipped++; return false; }
        return true;
      }).map(({ name, url }) => ({ name, url }));
      if (portable.length) evidence[id] = portable;
    }
    return { schemaVersion: 1, version, evidence, skippedLocalFiles: skipped };
  }

  const api = { normalize, merge, exportCatalog };
  root.RessoEvidenceCatalog = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
