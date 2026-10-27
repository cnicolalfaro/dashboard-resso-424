const { test } = require("node:test");
const assert = require("node:assert/strict");
const { normalize, merge, exportCatalog } = require("../assets/evidence-catalog-tools.js");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const url = "https://empresassk.sharepoint.com/a.pdf";
const second = "https://empresassk.sharepoint.com/b.pdf";

test("legacy entries, multiple files and shared/local deduplication", () => {
  const local = { 1: { name: "Original", url } };
  assert.equal(normalize(local)["1"].length, 1);
  const shared = { 1: [{ name: "Común", url }] };
  const result = merge(shared, { 1: [{ url }, { url: second }] });
  assert.equal(result["1"].length, 2);
  assert.equal(result["1"][0].name, "Común");
  assert.equal(shared["1"].length, 1);
  assert.equal(local["1"].name, "Original");
});

test("exports keep versions isolated and exclude local-only files", () => {
  const exported = exportCatalog("v11", { 1: [{ url }] },
    { 2: [{ url: second, localPath: "02/archivo.pdf" }] });
  assert.equal(exported.version, "v11");
  assert.deepEqual(Object.keys(exported.evidence), ["1"]);
  assert.equal(exported.skippedLocalFiles, 1);
  assert.equal(exported.evidence["1"][0].localPath, undefined);
  assert.throws(() => exportCatalog("v12", {}, {}));
});

test("rejects malformed, executable and non-company links", () => {
  for (const bad of [[], null, { 0: [] }, { 41: [] }, { 1: [{ url: "javascript:alert(1)" }] },
    { 1: [{ url: "https://empresassk.sharepoint.com.example.org/test" }] },
    { 1: [{ url, name: {} }] }]) {
    assert.throws(() => normalize(bad));
  }
});

test("importer merges idempotently and does not change the other version", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "resso-catalog-test-"));
  try {
    fs.mkdirSync(path.join(folder, "assets"));
    fs.mkdirSync(path.join(folder, "scripts"));
    for (const name of ["evidence-catalog-tools.js"]) {
      fs.copyFileSync(path.resolve(__dirname, "..", "assets", name), path.join(folder, "assets", name));
    }
    fs.writeFileSync(path.join(folder, "assets", "evidence-catalog.js"),
      'globalThis.RESSO_EVIDENCE_CATALOG = {"schemaVersion":1,"versions":{"v10":{},"v11":{}}};\n');
    const script = path.join(folder, "scripts", "importar_catalogo_evidencias.cjs");
    fs.copyFileSync(path.join(__dirname, "importar_catalogo_evidencias.cjs"), script);
    const input = path.join(folder, "export.json");
    fs.writeFileSync(input, JSON.stringify(exportCatalog("v11", {}, { 1: [{ url }] })));
    execFileSync(process.execPath, [script, input]);
    const catalogPath = path.join(folder, "assets", "evidence-catalog.js");
    const first = fs.readFileSync(catalogPath, "utf8");
    execFileSync(process.execPath, [script, input]);
    assert.equal(first, fs.readFileSync(catalogPath, "utf8"));
    const catalog = JSON.parse(first.replace(/^globalThis\.RESSO_EVIDENCE_CATALOG = /, "").replace(/;\s*$/, ""));
    assert.equal(catalog.versions.v11["1"][0].url, url);
    assert.deepEqual(catalog.versions.v10, {});
    fs.writeFileSync(input, JSON.stringify({ schemaVersion: 1, version: "v10",
      evidence: { 1: [{ url, localPath: "local.pdf" }] } }));
    assert.throws(() => execFileSync(process.execPath, [script, input], { stdio: "pipe" }));
    assert.equal(first, fs.readFileSync(catalogPath, "utf8"));
  } finally {
    fs.rmSync(folder, { recursive: true });
  }
});
