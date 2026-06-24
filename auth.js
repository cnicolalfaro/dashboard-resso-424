// =============================================================================
//  RESSO SKIC 424 — Control de acceso por contraseña (cifrado AES-GCM)
//  Los datos viajan cifrados (data/datos.enc.js). Sin la contraseña correcta
//  no se pueden leer. El descifrado ocurre en el navegador (Web Crypto API).
// =============================================================================
(function () {
  "use strict";

  // Parámetros de derivación (deben coincidir con cifrar.html)
  var PBKDF2_ITERATIONS = 250000;
  var SALT_LEN = 16;
  var IV_LEN = 12;

  function $(s) { return document.querySelector(s); }

  function base64ToBytes(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  async function deriveKey(password, salt) {
    var enc = new TextEncoder();
    var keyMaterial = await crypto.subtle.importKey(
      "raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
  }

  async function decryptData(password) {
    if (typeof window.ENCRYPTED_DATA !== "string") {
      throw new Error("No se encontraron datos cifrados.");
    }
    var raw = base64ToBytes(window.ENCRYPTED_DATA);
    var salt = raw.slice(0, SALT_LEN);
    var iv = raw.slice(SALT_LEN, SALT_LEN + IV_LEN);
    var ct = raw.slice(SALT_LEN + IV_LEN);
    var key = await deriveKey(password, salt);
    var ptBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, ct);
    var json = new TextDecoder().decode(ptBuf);
    return JSON.parse(json);
  }

  function startApp() {
    var gate = $("#authGate");
    var shell = $("#appShell");
    if (gate) gate.remove();
    if (shell) shell.style.display = "";
    var s = document.createElement("script");
    s.src = "app.js?v=5";
    document.body.appendChild(s);
  }

  function setupGate() {
    var form = $("#authForm");
    var input = $("#authPass");
    var error = $("#authError");
    var btn = $("#authBtn");

    form.addEventListener("submit", async function (ev) {
      ev.preventDefault();
      error.textContent = "";
      var pass = input.value;
      if (!pass) { error.textContent = "Ingresa la contraseña."; return; }
      btn.disabled = true;
      btn.textContent = "Verificando…";
      try {
        var data = await decryptData(pass);
        window.DASHBOARD_DATA = data;
        startApp();
      } catch (e) {
        error.textContent = "Contraseña incorrecta.";
        input.value = "";
        input.focus();
        btn.disabled = false;
        btn.textContent = "Ingresar";
      }
    });
  }

  document.addEventListener("DOMContentLoaded", setupGate);
})();
