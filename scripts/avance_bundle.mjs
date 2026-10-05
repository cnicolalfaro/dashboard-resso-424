// Extrae o reinserta el snapshot de Avance RESSO dentro de data/datos.enc.js
// sin depender de los demás data/*.js en texto plano (que no viven en este repo).
//
//   node scripts/avance_bundle.mjs extract   -> escribe data/avance_resso_data.js (privado, en .gitignore)
//   node scripts/avance_bundle.mjs pack      -> reemplaza avanceResso en data/datos.enc.js y lo vuelve a cifrar
//
// La contraseña se pide por consola sin mostrarse. Mismo esquema que auth.js / cifrar.html:
// PBKDF2-SHA256 250000 iteraciones + AES-GCM 256, blob = salt(16) | iv(12) | ciphertext.
import { webcrypto as crypto } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENC_PATH = join(ROOT, "data", "datos.enc.js");
const SNAPSHOT_PATH = join(ROOT, "data", "avance_resso_data.js");
const PBKDF2_ITERATIONS = 250000;

function askPassword(prompt) {
  if (process.env.RESSO_PASS) return Promise.resolve(process.env.RESSO_PASS);
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(prompt);
    let value = "";
    stdin.setRawMode && stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    stdin.on("data", function onData(ch) {
      if (ch === "\r" || ch === "\n" || ch === "\u0004") {
        stdin.setRawMode && stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(value);
      } else if (ch === "\u0003") {
        process.exit(1);
      } else if (ch === "\u0008" || ch === "\u007f") {
        value = value.slice(0, -1);
      } else {
        value += ch;
      }
    });
  });
}

async function deriveKey(password, salt, usage) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material, { name: "AES-GCM", length: 256 }, false, [usage]
  );
}

function readEncrypted() {
  const text = readFileSync(ENC_PATH, "utf8");
  const match = text.match(/window\.ENCRYPTED_DATA\s*=\s*"([^"]+)"/);
  if (!match) throw new Error("No se encontró window.ENCRYPTED_DATA en data/datos.enc.js");
  const header = text.slice(0, match.index);
  return { header, raw: Buffer.from(match[1], "base64") };
}

async function decrypt(password) {
  const { header, raw } = readEncrypted();
  const salt = raw.subarray(0, 16);
  const iv = raw.subarray(16, 28);
  const key = await deriveKey(password, salt, "decrypt");
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, raw.subarray(28));
    return { header, data: JSON.parse(new TextDecoder().decode(plain)) };
  } catch {
    throw new Error("Contraseña incorrecta.");
  }
}

async function encrypt(password, data) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, "encrypt");
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(data))));
  return Buffer.concat([salt, iv, ct]).toString("base64");
}

function loadSnapshot() {
  const text = readFileSync(SNAPSHOT_PATH, "utf8");
  const payload = text.slice(text.indexOf("=") + 1).trim().replace(/;$/, "");
  return JSON.parse(payload);
}

async function main() {
  const command = process.argv[2];
  if (!["extract", "pack"].includes(command)) {
    console.log("Uso: node scripts/avance_bundle.mjs extract|pack");
    process.exit(1);
  }
  const password = await askPassword("Contraseña del dashboard: ");
  const { header, data } = await decrypt(password);

  if (command === "extract") {
    if (!data.avanceResso) throw new Error("El paquete cifrado no contiene avanceResso.");
    writeFileSync(SNAPSHOT_PATH, "window.AVANCE_RESSO_DATA = " + JSON.stringify(data.avanceResso) + ";\n", "utf8");
    const nami = data.avanceResso.namiLinks;
    console.log(`Snapshot extraído: ${data.avanceResso.personas.length} personas, ${data.avanceResso.documentos.length} cursos, generado ${data.avanceResso.generado}`);
    console.log(`Enlaces NAMI: ${nami ? Object.keys(nami.people || {}).length + " trabajadores (al " + (nami.updatedAt || "sin fecha") + ")" : "ninguno"}`);
    return;
  }

  data.avanceResso = loadSnapshot();
  const encoded = await encrypt(password, data);
  writeFileSync(ENC_PATH, (header || "") + `window.ENCRYPTED_DATA = "${encoded}";\n`, "utf8");
  // Verificación: debe poder descifrarse con la misma contraseña.
  const check = await decrypt(password);
  console.log(`datos.enc.js regenerado y verificado: ${check.data.avanceResso.personas.length} personas en Avance RESSO.`);
  console.log("Recuerda subir la versión de data/datos.enc.js en index.html antes de publicar.");
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
