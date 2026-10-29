const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const cp = require("node:child_process");
const { thread, validate, listURL } = require("../assets/resso-observations.js");

test("validates boundaries and preserves exact trimmed text", () => {
  for (const version of ["v10", "v11"]) {
    assert.deepEqual(thread(version, 1), { version, question: 1 });
    thread(version, 40);
  }
  for (const args of [["v12", 1], ["v10", 0], ["v10", 41], ["v11", 1.5], ["v10", "1"]]) {
    assert.throws(() => thread(...args));
  }
  assert.deepEqual(validate(" Ana ", " <b>Revisar</b>\nAvance "), {
    author: "Ana", body: "<b>Revisar</b>\nAvance"
  });
  validate("A".repeat(80), "x".repeat(3000));
  for (const args of [[" ", "texto"], ["Ana", "\n"], ["A".repeat(81), "x"], ["Ana", "x".repeat(3001)]]) {
    assert.throws(() => validate(...args));
  }
});

test("queries separate versions/questions and use stable keyset pagination", () => {
  const first = new URL(listURL("v11", 8));
  assert.equal(first.searchParams.get("version"), "eq.v11");
  assert.equal(first.searchParams.get("question"), "eq.8");
  assert.equal(first.searchParams.get("limit"), "25");
  assert.equal(first.searchParams.get("order"), "created_at.desc,id.desc");
  const cursor = { id: "11111111-1111-4111-8111-111111111111", created_at: "2026-10-28T10:12:34.123456+00:00" };
  const next = new URL(listURL("v10", 5, cursor));
  assert.equal(next.searchParams.get("or"),
    `(created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id}))`);
  assert.throws(() => listURL("v10", 5, { id: "bad", created_at: "bad" }));
});

test("all ten pages wire shared history without changing spreadsheet data", () => {
  const root = path.resolve(__dirname, "..");
  for (const folder of ["evidencias", "evidencias-v11"]) {
    for (const name of ["plan", "do", "check", "act", "auditor"]) {
      const relative = `pages/${folder}/${name}.html`;
      const text = fs.readFileSync(path.join(root, "pages", folder, `${name}.html`), "utf8");
      assert.equal((text.match(/RessoObservations\.open\(r\.id\)/g) || []).length, 1, relative);
      assert.equal((text.match(/src="\.\.\/\.\.\/assets\/resso-observations\.js"/g) || []).length, 1, relative);
      for (const script of text.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
      const old = cp.execFileSync("git", ["show", `HEAD:${relative}`], { encoding: "utf8", cwd: root });
      const data = /const DATA\s*=\s*(\[.*?\]);/s;
      const withoutFinalObservations = records => records.map(({ final_observation, ...record }) => record);
      assert.deepEqual(withoutFinalObservations(JSON.parse(text.match(data)[1])),
        withoutFinalObservations(JSON.parse(old.match(data)[1])), relative);
    }
  }
});
