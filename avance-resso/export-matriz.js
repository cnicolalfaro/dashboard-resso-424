// Exporta la matriz trabajador × curso a Excel (.xlsx con formato).
// Hojas: Matriz (para leer), Datos (tabla plana 1/0 para procesar), Cursos, Leyenda.
// Usa xlsx-js-style (misma librería que la página de incidentes), cargada solo al exportar.
(function () {
  "use strict";

  const LIB_URL = "https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js";

  const FAMILY_COLORS = {
    RF: { strong: "2A78D6", soft: "DCEAF9" },
    RIM: { strong: "EB6834", soft: "FCE3D8" },
    MA: { strong: "1BAF7A", soft: "D5F2E6" },
    IRL: { strong: "C98500", soft: "FDF0CC" },
  };

  // Estado de cada celda: símbolo, colores y texto de leyenda.
  const STATES = {
    nami: { symbol: "✓", fill: "C6EFCE", font: "006100", label: "Aprobado · con certificado NAMI (clic abre el PDF)" },
    qr: { symbol: "✓", fill: "C6EFCE", font: "1F5FA8", label: "Aprobado · con certificado QR de Forms (clic abre el PDF)" },
    fisico: { symbol: "✓", fill: "C6EFCE", font: "B4501E", label: "Aprobado · con certificado físico escaneado (clic abre el PDF)" },
    otra: { symbol: "✓", fill: "E2F0D9", font: "2E7D32", label: "Aprobado · por otra fuente (sin PDF enlazado)" },
    cert: { symbol: "✓*", fill: "FFEB9C", font: "7F6000", label: "Certificado encontrado, aún no figura aprobado en la fuente (no cuenta en el avance)" },
    pend: { symbol: "✗", fill: "FDE2E1", font: "C00000", label: "Pendiente" },
  };

  const BORDER = { style: "thin", color: { rgb: "D0D7E2" } };
  const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

  function loadLibrary() {
    if (window.XLSX && window.XLSX.CFB) return Promise.resolve(window.XLSX);
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = LIB_URL;
      script.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error("No se cargó la librería de Excel")));
      script.onerror = () => reject(new Error("No se pudo descargar la librería de Excel (¿sin internet?)"));
      document.head.appendChild(script);
    });
  }

  function style(opts) {
    return {
      font: { name: "Calibri", sz: opts.sz || 10, bold: !!opts.bold, italic: !!opts.italic, color: { rgb: opts.color || "1F2D3D" } },
      fill: opts.fill ? { patternType: "solid", fgColor: { rgb: opts.fill } } : undefined,
      alignment: {
        horizontal: opts.h || "left",
        vertical: opts.v || "center",
        wrapText: opts.wrap !== false,
        textRotation: opts.rotate || 0,
      },
      border: opts.noBorder ? undefined : BORDERS,
    };
  }

  function pctFill(p) {
    if (p < 0.3) return { fill: "F8D7D5", color: "9C1C1C" };
    if (p < 0.6) return { fill: "FCE4CC", color: "8A4B08" };
    if (p < 0.85) return { fill: "FFF2C2", color: "7F6000" };
    return { fill: "D4EDD4", color: "1E6B1E" };
  }

  // La librería no escribe paneles inmovilizados: se agregan al XML de cada hoja.
  function addFrozenPanes(XLSX, buffer, panes) {
    const zip = XLSX.CFB.read(new Uint8Array(buffer), { type: "array" });
    panes.forEach(({ sheet, xSplit, ySplit, topLeftCell }) => {
      const entry = XLSX.CFB.find(zip, `/xl/worksheets/sheet${sheet}.xml`);
      if (!entry) return;
      // El panel activo depende de qué se inmoviliza: solo filas = bottomLeft, solo columnas = topRight.
      const active = xSplit && ySplit ? "bottomRight" : ySplit ? "bottomLeft" : "topRight";
      const pane = `<pane${xSplit ? ` xSplit="${xSplit}"` : ""}${ySplit ? ` ySplit="${ySplit}"` : ""} topLeftCell="${topLeftCell}" activePane="${active}" state="frozen"/><selection pane="${active}"/>`;
      const xml = new TextDecoder().decode(entry.content)
        .replace(/<sheetView workbookViewId="0"\/>/, `<sheetView workbookViewId="0">${pane}</sheetView>`);
      entry.content = new TextEncoder().encode(xml);
      entry.size = entry.content.length;
    });
    return XLSX.CFB.write(zip, { fileType: "zip", type: "array", compression: true });
  }

  function buildMatrixSheet(XLSX, model) {
    const { courses, people } = model;
    const FIXED = ["N°", "RUT", "Trabajador", "Cargo", "Estado", "Aprobados", "Avance"];
    const first = FIXED.length; // primera columna de curso
    const lastCol = first + courses.length - 1;
    const ws = {};
    const merges = [];
    const put = (r, c, v, s, extra) => { ws[XLSX.utils.encode_cell({ r, c })] = Object.assign({ v, t: typeof v === "number" ? "n" : "s", s }, extra || {}); };

    // Encabezado compacto (4 filas inmovilizadas). Ninguna celda combinada cruza la columna
    // inmovilizada (C|D): si la cruza, Excel corta el texto al desplazarse a la derecha.
    const FROZEN_COLS = 3; // N°, RUT, Trabajador
    const band = (r, c0, c1, v, st) => {
      put(r, c0, v, st);
      for (let c = c0 + 1; c <= c1; c++) put(r, c, "", st);
      if (c1 > c0) merges.push({ s: { r, c: c0 }, e: { r, c: c1 } });
    };
    // Izquierda (siempre visible): título y leyenda corta.
    band(0, 0, FROZEN_COLS - 1, "Matriz RESSO · SKIC 424", style({ sz: 13, bold: true, color: "FFFFFF", fill: "1F3C74", noBorder: true, wrap: false }));
    band(1, 0, FROZEN_COLS - 1, "✓ aprobado  ·  ✓* certificado sin registro  ·  ✗ pendiente", style({ sz: 9.5, bold: true, color: "1F2D3D", fill: "EEF2F8", noBorder: true, wrap: false }));
    band(2, 0, FROZEN_COLS - 1, "FAMILIA DEL CURSO  →", style({ sz: 9, bold: true, color: "43536B", fill: "F3F6FB", h: "right", wrap: false }));
    // Derecha (se desplaza con los cursos): datos del archivo y detalle de la leyenda.
    band(0, FROZEN_COLS, lastCol, model.subtitle, style({ sz: 9.5, color: "FFFFFF", fill: "1F3C74", noBorder: true, wrap: false }));
    band(1, FROZEN_COLS, lastCol, "Verde: aprobado (los ✓ con certificado NAMI, QR o físico se abren con clic) · Amarillo ✓*: hay certificado pero aún no figura en la fuente (no cuenta) · Rojo ✗: pendiente · Detalle en la hoja «Leyenda» · Tabla 1/0 en la hoja «Datos»",
      style({ sz: 9, color: "43536B", fill: "EEF2F8", noBorder: true, wrap: false }));
    band(2, FROZEN_COLS, first - 1, "", style({ fill: "F3F6FB" }));

    let start = 0;
    courses.forEach((course, i) => {
      const col = first + i;
      const colors = FAMILY_COLORS[course.family] || FAMILY_COLORS.IRL;
      // Sigla + nombre completo en una sola celda vertical (sin repetir la sigla si el nombre ya la trae).
      const header = course.title.toUpperCase().startsWith(course.code.toUpperCase()) ? course.title : `${course.code} · ${course.title}`;
      put(2, col, course.familyLabel, style({ sz: 9, bold: true, color: "FFFFFF", fill: colors.strong, h: "center", wrap: false }));
      put(3, col, header, style({ sz: 8, bold: true, color: "1F2D3D", fill: colors.soft, h: "center", v: "bottom", rotate: 90 }));
      const next = courses[i + 1];
      if (!next || next.family !== course.family) {
        if (i > start) merges.push({ s: { r: 2, c: first + start }, e: { r: 2, c: col } });
        start = i + 1;
      }
    });
    FIXED.forEach((label, c) => put(3, c, label, style({ bold: true, color: "FFFFFF", fill: "254985", h: c >= 4 ? "center" : "left", v: "bottom" })));

    // Filas de trabajadores
    const r0 = 4;
    people.forEach((p, n) => {
      const r = r0 + n;
      const zebra = n % 2 ? "F7F9FC" : "FFFFFF";
      const textColor = p.vigente ? "1F2D3D" : "7A8699";
      put(r, 0, n + 1, style({ color: textColor, fill: zebra, h: "center" }));
      put(r, 1, p.rut, style({ color: textColor, fill: zebra, wrap: false }));
      // Nombre, cargo y estado en una sola línea: con ajuste de texto Excel no agranda la fila y se montan.
      put(r, 2, p.nombre, style({ bold: p.vigente, italic: !p.vigente, color: textColor, fill: zebra, wrap: false }));
      put(r, 3, p.cargo, style({ color: textColor, fill: zebra, wrap: false }));
      put(r, 4, p.estadoTexto, style({ sz: 9, bold: !p.vigente, color: p.vigente ? "1E6B1E" : "9C1C1C", fill: p.vigente ? "E8F5E8" : "F1F1F1", h: "center", wrap: false }));
      put(r, 5, `${p.aprobados} de ${courses.length}`, style({ color: textColor, fill: zebra, h: "center", wrap: false }));
      const pc = pctFill(p.avance);
      put(r, 6, p.avance, style({ bold: true, color: pc.color, fill: pc.fill, h: "center", wrap: false }), { z: "0%" });
      p.cells.forEach((cell, i) => {
        const st = STATES[cell.state];
        const extra = cell.url ? { l: { Target: cell.url, Tooltip: `${courses[i].code}: abrir certificado` } } : undefined;
        put(r, first + i, st.symbol, style({ sz: 11, bold: true, color: st.font, fill: st.fill, h: "center", wrap: false }), extra);
      });
    });

    const lastRow = r0 + Math.max(people.length, 1) - 1;
    ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: lastCol } });
    ws["!merges"] = merges;
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 3, c: 0 }, e: { r: lastRow, c: lastCol } }) };
    // Anchos según el texto más largo (con tope), para que nombres y cargos quepan en una línea.
    const widest = (key, min, max) => Math.min(max, Math.max(min, ...people.map(p => String(p[key] || "").length * 1.1 + 2)));
    ws["!cols"] = [{ wch: 6 }, { wch: 12 }, { wch: widest("nombre", 34, 48) }, { wch: widest("cargo", 22, 40) }, { wch: 22 }, { wch: 11 }, { wch: 9 }]
      .concat(courses.map(() => ({ wch: 6 })));
    ws["!rows"] = [{ hpt: 24 }, { hpt: 18 }, { hpt: 16 }, { hpt: 87 }].concat(people.map(() => ({ hpt: 17 })));
    return ws;
  }

  function buildDataSheet(XLSX, model) {
    const header = ["N", "RUT", "NOMBRE", "CARGO", "ESTADO", "VIGENTE", "APROBADOS", "TOTAL_CURSOS", "AVANCE_PCT"]
      .concat(model.courses.map(c => c.code));
    const rows = model.people.map((p, n) => [n + 1, p.rut, p.nombre, p.cargo, p.estadoTexto, p.vigente ? "SI" : "NO",
      p.aprobados, model.courses.length, Math.round(p.avance * 1000) / 10]
      .concat(p.cells.map(cell => (cell.aprobado ? 1 : 0))));
    const ws = XLSX.utils.aoa_to_sheet([header].concat(rows));
    const headStyle = style({ bold: true, color: "FFFFFF", fill: "254985", h: "center", wrap: false });
    header.forEach((_, c) => { ws[XLSX.utils.encode_cell({ r: 0, c })].s = headStyle; });
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: header.length - 1 } }) };
    ws["!cols"] = [{ wch: 6 }, { wch: 12 }, { wch: 34 }, { wch: 26 }, { wch: 18 }, { wch: 8 }, { wch: 10 }, { wch: 13 }, { wch: 11 }]
      .concat(model.courses.map(() => ({ wch: 9 })));
    return ws;
  }

  function buildCoursesSheet(XLSX, model) {
    const vigentes = model.people.filter(p => p.vigente);
    const header = ["CODIGO", "FAMILIA", "CURSO", "FUENTES", "CODIGO_NAMI", "APROBADOS_VIGENTES", "VIGENTES_EXPORTADOS", "AVANCE_PCT"];
    const rows = model.courses.map((c, i) => {
      const ok = vigentes.filter(p => p.cells[i].aprobado).length;
      return [c.code, c.familyLabel, c.title, c.fuentes, c.namiCode || "", ok, vigentes.length,
        vigentes.length ? Math.round(1000 * ok / vigentes.length) / 10 : 0];
    });
    const ws = XLSX.utils.aoa_to_sheet([header].concat(rows));
    const headStyle = style({ bold: true, color: "FFFFFF", fill: "254985", wrap: false });
    header.forEach((_, c) => { ws[XLSX.utils.encode_cell({ r: 0, c })].s = headStyle; });
    rows.forEach((row, i) => {
      const colors = FAMILY_COLORS[model.courses[i].family] || FAMILY_COLORS.IRL;
      row.forEach((_, c) => {
        ws[XLSX.utils.encode_cell({ r: i + 1, c })].s = style({ bold: c === 0, fill: c <= 1 ? colors.soft : undefined, h: c >= 5 ? "center" : "left" });
      });
    });
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: header.length - 1 } }) };
    ws["!cols"] = [{ wch: 10 }, { wch: 28 }, { wch: 80 }, { wch: 40 }, { wch: 13 }, { wch: 19 }, { wch: 20 }, { wch: 12 }];
    return ws;
  }

  function buildLegendSheet(XLSX, model) {
    const aoa = [["Símbolo", "Significado"]].concat(Object.values(STATES).map(st => [st.symbol, st.label]))
      .concat([[], ["Generado", model.subtitle], ["Cuenta en el avance", "Solo los ✓ verdes (aprobado). ✓* y ✗ no cuentan. Los no vigentes (finiquitados / fuera de tarja) se muestran en gris y no cuentan en el avance del contrato."]]);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws.A1.s = ws.B1.s = style({ bold: true, color: "FFFFFF", fill: "254985" });
    Object.values(STATES).forEach((st, i) => {
      ws[XLSX.utils.encode_cell({ r: i + 1, c: 0 })].s = style({ sz: 12, bold: true, color: st.font, fill: st.fill, h: "center" });
      ws[XLSX.utils.encode_cell({ r: i + 1, c: 1 })].s = style({});
    });
    ws["!cols"] = [{ wch: 20 }, { wch: 110 }];
    return ws;
  }

  async function exportMatrix(model) {
    const XLSX = await loadLibrary();
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, buildMatrixSheet(XLSX, model), "Matriz");
    XLSX.utils.book_append_sheet(wb, buildDataSheet(XLSX, model), "Datos");
    XLSX.utils.book_append_sheet(wb, buildCoursesSheet(XLSX, model), "Cursos");
    XLSX.utils.book_append_sheet(wb, buildLegendSheet(XLSX, model), "Leyenda");
    const raw = XLSX.write(wb, { type: "array", bookType: "xlsx", bookSST: true, compression: true });
    const out = addFrozenPanes(XLSX, raw, [
      { sheet: 1, xSplit: 3, ySplit: 4, topLeftCell: "D5" },
      { sheet: 2, xSplit: 3, ySplit: 1, topLeftCell: "D2" },
      { sheet: 3, ySplit: 1, topLeftCell: "A2" },
    ]);
    const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = model.fileName;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 1000);
  }

  window.AvanceExport = { exportMatrix, STATES };
})();
