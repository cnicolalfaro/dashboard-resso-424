// Uso: node scripts\importar_catalogo_evidencias.cjs <exportacion.json>
const fs = require("node:fs");
const path = require("node:path");
const { normalize, merge } = require("../assets/evidence-catalog-tools.js");

const filename = process.argv[2];
if (!filename) throw new Error("Indica el JSON exportado desde modo auditor.");
const exported = JSON.parse(fs.readFileSync(filename, "utf8").replace(/^\uFEFF/, ""));
if (exported.schemaVersion !== 1 || !["v10", "v11"].includes(exported.version)) {
  throw new Error("Formato o versión de exportación inválidos.");
}
const incoming = normalize(exported.evidence);
for (const files of Object.values(incoming)) {
  if (files.some(file => file.localPath)) throw new Error("No se publican rutas locales.");
}
const destination = path.resolve(__dirname, "..", "assets", "evidence-catalog.js");
require(destination);
const catalog = globalThis.RESSO_EVIDENCE_CATALOG;
catalog.versions[exported.version] = merge(catalog.versions[exported.version], incoming);
fs.writeFileSync(destination, "globalThis.RESSO_EVIDENCE_CATALOG = " +
  JSON.stringify(catalog, null, 2).replace(/</g, "\\u003c") + ";\n", "utf8");
console.log(`Catálogo ${exported.version}: ` +
  Object.values(catalog.versions[exported.version]).reduce((n, files) => n + files.length, 0) +
  " enlaces. Revisa los cambios y publica el catálogo para compartirlos.");
