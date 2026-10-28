const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { prefix, fileURL } = require("../assets/resso-previews.js");

test("preview folders isolate version and question", () => {
  assert.equal(prefix("v10", 1), "v10/01");
  assert.equal(prefix("v11", 40), "v11/40");
  for (const pair of [["v12", 1], ["v10", 0], ["v11", 41], ["v10", "1"]]) {
    assert.throws(() => prefix(...pair));
  }
});

test("only fixed-origin PDF and raster images can enter the viewer", () => {
  for (const name of ["archivo.pdf", "captura.PNG", "foto.jpg", "foto.jpeg", "foto.webp", "foto.gif"]) {
    assert.equal(new URL(fileURL("v11/09", name)).hostname, "bvjhqfznfyogqxwdeogb.supabase.co");
  }
  assert.ok(fileURL("v10/01", "avance #1.pdf").endsWith("avance%20%231.pdf"));
  for (const name of ["../archivo.pdf", "otra\\foto.png", "archivo.svg", "archivo.html", "archivo.xlsx"]) {
    assert.throws(() => fileURL("v10/01", name));
  }
  assert.throws(() => fileURL("v10/00", "archivo.pdf"));
  assert.throws(() => fileURL("https://otro", "archivo.pdf"));
});

test("both auditor templates integrate previews without replacing SharePoint", () => {
  for (const folder of ["evidencias", "evidencias-v11"]) {
    const text = fs.readFileSync(path.join(__dirname, "..", "pages", folder, "auditor.html"), "utf8");
    for (const needle of ["RessoPreviews.open(id)", "RessoPreviews.close()", "../../assets/resso-previews.js",
      'id="eFolderLink"', 'id="savedEvidenceBox"', "RessoObservations.open(r.id)"]) {
      assert.ok(text.includes(needle), `${folder}: ${needle}`);
    }
  }
});
