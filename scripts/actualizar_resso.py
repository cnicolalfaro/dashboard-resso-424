#!/usr/bin/env python3
"""
Pipeline de actualizacion diaria - Dashboard "Avance RESSO" (SKIC 424).

Reconstruye SOLO el bloque de dotacion activa / 68 documentos (Matriz + Resumen).
NO toca "Lineas de Mando" (capacitaciones_dirigidas) - esa seccion se copia tal
cual desde el snapshot anterior (last_data.json).

Uso:
    python3 actualizar_resso.py <FUENTES_DIR> <PREV_DATA_JSON> <OUT_DATA_JSON>

Donde:
    FUENTES_DIR    carpeta con los excels fuente (ya copiados/staged localmente):
                   TARJA*, Maestra de Capacitaci*n*, matriz_capacitacion*
    PREV_DATA_JSON snapshot anterior completo (para carry-forward de docs sin
                   fuente identificable, y para copiar capacitaciones_dirigidas)
    OUT_DATA_JSON  donde escribir el nuevo snapshot completo

Microsoft Forms (4ta fuente, opcional):
    Si existe una carpeta "FORMS" hermana de FUENTES_DIR (../FORMS) con exports
    de Microsoft Forms (.xlsx), se usan como fuente adicional (OR con Maestra /
    Plataforma) para los documentos reconocidos por titulo (ver FORMS_TITLE_TO_IDX).
    Si la carpeta no existe o esta vacia, el pipeline sigue funcionando igual que
    antes (Forms es puramente aditivo, nunca bloqueante).

El script imprime al final una linea "RESULT_OK <json de metricas>" o
"RESULT_ERROR <mensaje>" para que el proceso que lo invoca pueda verificar
el resultado facilmente.
"""
import sys, os, re, json, glob, datetime, subprocess, shutil

def clean_rut(v):
    if v is None:
        return ""
    s = str(v).strip().upper()
    return re.sub(r'[^0-9K]', '', s)

def latest_matching(folder, patterns):
    """Devuelve la ruta del archivo mas reciente (mtime) que matchee
    cualquiera de los patrones glob dados (case-insensitive)."""
    candidates = []
    for pat in patterns:
        candidates += glob.glob(os.path.join(folder, pat))
    if not candidates:
        return None
    candidates = [c for c in candidates if not os.path.basename(c).startswith('~$')]
    candidates.sort(key=lambda p: os.path.getmtime(p), reverse=True)
    return candidates[0]

def ensure_xlsx(path, workdir):
    """Si el archivo es .xlsb, lo convierte a .xlsx con LibreOffice y devuelve
    la ruta del .xlsx resultante. Si ya es .xlsx, lo devuelve tal cual."""
    if path.lower().endswith('.xlsx'):
        return path
    if path.lower().endswith('.xlsb'):
        out_dir = workdir
        subprocess.run(
            ['soffice', '--headless', '--convert-to', 'xlsx', '--outdir', out_dir, path],
            check=True, capture_output=True, timeout=180,
        )
        base = os.path.splitext(os.path.basename(path))[0]
        out_path = os.path.join(out_dir, base + '.xlsx')
        if not os.path.exists(out_path):
            raise RuntimeError(f"soffice no genero {out_path}")
        return out_path
    raise RuntimeError(f"Formato no soportado: {path}")

# ---------------------------------------------------------------------------
# Mapa de los 68 documentos: idx -> (columna en 'MAESTRA DE CAPACITACIÓN', codigo
# de modulo en 'matriz_capacitacion' / Plataforma nueva). None si esa fuente no
# aplica a ese documento. Los idx con (None, None) no tienen fuente identificable
# en Maestra ni Plataforma: se calculan via Microsoft Forms si hay export
# disponible para ese documento en esta corrida, y si no, se mantiene el bit de
# la persona igual al snapshot anterior (carry-forward dinamico, ver mas abajo).
# ---------------------------------------------------------------------------
DOC_MAP = {
 0: (123, None), 1: (124, None), 2: (None, 'RIM-002'), 3: (None, 'IRL-032'), 4: (None, 'IRL-037'),
 5: (None, 'IRL-024'), 6: (95, 'RF-029'), 7: (101, 'RF-032'), 8: (91, 'RF-027'), 9: (87, 'RF-036'),
 10: (93, 'RF-028'), 11: (None, 'RIM-003'), 12: (None, 'RIM-001'), 13: (None, None),
 14: (122, None), 15: (99, 'RF-038'), 16: (73, 'RF-033'), 17: (79, 'RF-037'), 18: (97, 'RF-030'),
 19: (77, 'RF-022'), 20: (69, 'RF-034'), 21: (89, 'RF-025'), 22: (81, 'RF-026'), 23: (85, 'RF-024'),
 24: (75, 'RF-021'), 25: (117, None), 26: (119, None), 27: (120, None), 28: (121, None),
 29: (118, None), 30: (115, None), 31: (116, None), 32: (83, 'RF-018'), 33: (71, 'RF-020'),
 34: (25, None), 35: (21, None), 36: (15, None), 37: (43, None), 38: (37, 'IRL-036'),
 39: (41, 'IRL-034'), 40: (39, 'IRL-031'), 41: (29, 'IRL-026'), 42: (114, None), 43: (18, None),
 44: (108, None), 45: (102, None), 46: (110, None), 47: (112, None), 48: (104, 'MA-004'),
 49: (65, None), 50: (106, None), 51: (None, None),
 52: (63, None), 53: (27, None), 54: (45, None), 55: (47, None), 56: (49, None), 57: (51, None),
 58: (53, None), 59: (55, None), 60: (57, None), 61: (59, None), 62: (61, None), 63: (19, None),
 64: (16, None), 65: (31, 'IRL-033'), 66: (35, 'RIM-005'), 67: (33, 'IRL-028'),
}

MAESTRA_COLS = [123, 124, 95, 101, 91, 87, 93, 122, 99, 73, 79, 97, 77, 69, 89, 81, 85, 75, 117, 119,
                120, 121, 118, 115, 116, 83, 71, 25, 21, 15, 43, 37, 41, 39, 29, 114, 18, 108, 102,
                110, 112, 104, 65, 106, 63, 27, 45, 47, 49, 51, 53, 55, 57, 59, 61, 19, 16, 31, 35, 33]

# ---------------------------------------------------------------------------
# Microsoft Forms: titulo "limpio" del export (nombre de archivo sin el sufijo
# de conteo de filas que Forms agrega siempre, tipo "(1-315)" o "(1-102) (1)")
# -> idx del documento en el dashboard. Se agregan aqui a medida que la usuaria
# entrega nuevos exports; un archivo cuyo titulo no matchee ninguna entrada se
# ignora (no aborta la corrida).
# ---------------------------------------------------------------------------
FORMS_TITLE_TO_IDX = {
    'Difusión de Cartillas de Evacuación Mina DCH Subterráneo REV. 5': 13,
    'Evaluación Capacitación Herramientas Manuales Portatiles y Energizadas': 53,
    'Evaluación Capacitación de Herramientas de Gestión Preventivas ART - TARJETA VERDE - GCQSV': 67,
    'R-01 Reglamento Interno de Ventilación': 2,
    'R-035 Reglamento de Emergencia Mina Chuquicamata': 11,
    'RF-01 Evaluación RF Energía Eléctrica vs 03': 20,
    'RF-02 Evaluación RF Trabajo en altura vs 03': 33,
    'RF-03 Evaluación RF Maniobras de Izajes vs 02': 16,
    'RF-04 Evaluación RF Liberación Descontrolada de Energías vs 02': 24,
    'RF-06 Evaluación RF Incendio vs 02': 19,
    'RF-07 Evaluación RF Sustancias Peligrosas vs 03': 17,
    'RF-10 Evaluación RF Vehículos vs 01': 22,
    'RF-13 Caída de Objetos vs01': 32,
    'RF-16 Evaluación RF Vaciados de Chimeneas y Piques vs01': 23,
    'RF-18 Evaluación RF Planchoneo vs01': 9,
    'RF-20 Evaluación RF Sílice vs1': 21,
    'RF-22 Evaluación RF Falla de estructuras para tránsito y uso de personas vs1': 8,
    'RF-23 Evaluación RF Colapso Estructural del Macizo Rocoso vs1': 10,
    'RF-25 Evaluación RF Equipos Mineros e Industriales vs1': 6,
    'RF-27 Evaluación RF Atropello': 18,
    'RF-30 Evaluación RF Tiro y arrastre vs 0': 15,
    'RF-31 Evaluación RF Incendio de equipos mineros e industriales': 7,
    'Reglamento Control de Ingreso de Personas a la Faena': 12,
}

FORMS_SUFFIX_RE = re.compile(r'^(.*?)\s*\(\d+-\d+\)(?:\s*\(\d+\))?\.xlsx$', re.IGNORECASE)


def clean_forms_title(fname):
    m = FORMS_SUFFIX_RE.match(fname)
    return m.group(1).strip() if m else None


def parse_forms_file(path):
    """Devuelve (dict rut_limpio -> score_maximo, filas_leidas) para un export
    de Microsoft Forms, quedandose con el mejor intento (score mas alto) por
    persona cuando hay envios repetidos."""
    import openpyxl
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb[wb.sheetnames[0]]
    headers = [c.value for c in ws[1]]
    rut_idx = tp_idx = None
    for i, h in enumerate(headers):
        if h == 'RUT del trabajador':
            rut_idx = i
        if h == 'Total de puntos':
            tp_idx = i
    if rut_idx is None or tp_idx is None:
        return None, 0
    out = {}
    n_rows = 0
    for row in ws.iter_rows(min_row=2, values_only=True):
        n_rows += 1
        rut = clean_rut(row[rut_idx]) if rut_idx < len(row) else ""
        score = row[tp_idx] if tp_idx < len(row) else None
        if not rut or score is None:
            continue
        try:
            score = float(score)
        except (TypeError, ValueError):
            continue
        if rut not in out or score > out[rut]:
            out[rut] = score
    return out, n_rows


def load_forms_sources(fuentes_dir):
    """Busca una carpeta FORMS hermana de fuentes_dir y, si existe, parsea todos
    los .xlsx reconocidos. Devuelve (forms_by_idx, resumen) donde resumen trae
    que archivos se usaron y cuales se ignoraron (para transparencia en el log),
    sin abortar nunca el pipeline por esto."""
    parent = os.path.dirname(os.path.normpath(fuentes_dir))
    forms_dir = os.path.join(parent, 'FORMS')
    forms_by_idx = {}
    usados, ignorados = [], []
    if not os.path.isdir(forms_dir):
        return forms_by_idx, dict(carpeta_forms=None, usados=usados, ignorados=ignorados)
    for path in sorted(glob.glob(os.path.join(forms_dir, '*.xlsx'))):
        base = os.path.basename(path)
        if base.startswith('~$'):
            continue
        titulo = clean_forms_title(base)
        idx = FORMS_TITLE_TO_IDX.get(titulo) if titulo else None
        if idx is None:
            ignorados.append(base)
            continue
        try:
            scores, n_rows = parse_forms_file(path)
        except Exception as e:
            ignorados.append(f"{base} (error: {e})")
            continue
        if scores is None:
            ignorados.append(f"{base} (columnas RUT/Total de puntos no encontradas)")
            continue
        bucket = forms_by_idx.setdefault(idx, {})
        for rut, score in scores.items():
            if rut not in bucket or score > bucket[rut]:
                bucket[rut] = score
        usados.append(f"{base} -> idx{idx} ({len(scores)} ruts, {n_rows} filas)")
    return forms_by_idx, dict(carpeta_forms=forms_dir, usados=usados, ignorados=ignorados)


def main():
    if len(sys.argv) != 4:
        print("RESULT_ERROR uso: actualizar_resso.py <FUENTES_DIR> <PREV_DATA_JSON> <OUT_DATA_JSON>")
        sys.exit(1)
    fuentes_dir, prev_data_path, out_data_path = sys.argv[1:4]
    workdir = os.path.dirname(os.path.abspath(out_data_path)) or '.'

    import openpyxl

    try:
        prev_data = json.load(open(prev_data_path, encoding='utf-8'))
    except Exception as e:
        print(f"RESULT_ERROR no se pudo leer snapshot anterior {prev_data_path}: {e}")
        sys.exit(1)
    orig_docs = prev_data['documentos']
    if len(orig_docs) != 68:
        print(f"RESULT_ERROR snapshot anterior tiene {len(orig_docs)} documentos, se esperaban 68")
        sys.exit(1)
    orig_personas_by_rut = {clean_rut(p['rut']): p for p in prev_data['personas']}

    # ---- localizar archivos fuente mas recientes ----
    tarja_path = latest_matching(fuentes_dir, ['TARJA*.xlsb', 'TARJA*.xlsx', 'Tarja*.xlsb', 'Tarja*.xlsx'])
    maestra_path = latest_matching(fuentes_dir, ['Maestra de Capacitaci*.xlsx', 'MAESTRA DE CAPACITACI*.xlsx'])
    plataforma_path = latest_matching(fuentes_dir, ['matriz_capacitacion*.xlsx', 'Matriz_capacitacion*.xlsx'])

    missing = [n for n, p in [('TARJA', tarja_path), ('Maestra de Capacitación', maestra_path),
                               ('matriz_capacitacion (Plataforma nueva)', plataforma_path)] if not p]
    if missing:
        print(f"RESULT_ERROR no se encontraron archivos fuente para: {', '.join(missing)} en {fuentes_dir}")
        sys.exit(1)

    tarja_xlsx = ensure_xlsx(tarja_path, workdir)

    # ---------- 0. Microsoft Forms (opcional, aditivo) ----------
    forms_by_idx, forms_resumen = load_forms_sources(fuentes_dir)

    # ---------- 1. TARJA (activos) menos Finiquitados -> dotacion activa ----------
    wb_t = openpyxl.load_workbook(tarja_xlsx, data_only=True)
    if 'TARJA' not in wb_t.sheetnames or 'Finiquitados' not in wb_t.sheetnames:
        print(f"RESULT_ERROR el archivo TARJA ({os.path.basename(tarja_path)}) no tiene las hojas "
              f"'TARJA' y 'Finiquitados' esperadas (hojas encontradas: {wb_t.sheetnames})")
        sys.exit(1)
    ws_tarja = wb_t['TARJA']
    roster = {}
    for r in range(4, ws_tarja.max_row + 1):
        rut = clean_rut(ws_tarja.cell(r, 2).value)
        if not rut or rut in roster:
            continue
        nom = str(ws_tarja.cell(r, 3).value or '').strip()
        pat = str(ws_tarja.cell(r, 4).value or '').strip()
        mat = str(ws_tarja.cell(r, 5).value or '').strip()
        especialidad = str(ws_tarja.cell(r, 7).value or '').strip()
        categoria = str(ws_tarja.cell(r, 8).value or '').strip()
        turno = str(ws_tarja.cell(r, 13).value or '').strip()
        nombre_full = re.sub(r'\s+', ' ', f"{nom} {pat} {mat}").strip()
        roster[rut] = dict(rut=rut, nombre=nombre_full, especialidad=especialidad,
                            categoria=categoria, turno=turno)

    wsf = wb_t['Finiquitados']
    fin_ruts = set()
    for r in range(2, wsf.max_row + 1):
        rut = clean_rut(wsf.cell(r, 1).value)
        if rut:
            fin_ruts.add(rut)
    for r in list(roster.keys()):
        if r in fin_ruts:
            del roster[r]

    if len(roster) < 500:
        print(f"RESULT_ERROR dotacion activa calculada demasiado baja ({len(roster)}); "
              f"posible problema leyendo {os.path.basename(tarja_path)} - abortando sin publicar")
        sys.exit(1)

    # Filtrar los datos de Forms a solo RUTs de la dotacion activa actual (saca
    # filas de prueba/basura y ex-trabajadores, sin heuristicas de nombre).
    active_rut_set = set(roster.keys())
    for idx in list(forms_by_idx.keys()):
        forms_by_idx[idx] = {rut: sc for rut, sc in forms_by_idx[idx].items() if rut in active_rut_set}

    # ---------- 2. Maestra de Capacitación ----------
    wb_m = openpyxl.load_workbook(maestra_path, data_only=True)
    ws_mc = wb_m['MAESTRA DE CAPACITACIÓN']
    maestra_data = {}
    for r in range(5, ws_mc.max_row + 1):
        rut = clean_rut(ws_mc.cell(r, 3).value)
        if not rut:
            continue
        d = {}
        for c in MAESTRA_COLS:
            v = ws_mc.cell(r, c).value
            d[c] = v not in (None, '')
        maestra_data[rut] = d

    # ---------- 3. Plataforma nueva (matriz_capacitacion) ----------
    wb_p = openpyxl.load_workbook(plataforma_path, data_only=True)
    ws_mx = wb_p['Matriz']
    headers = [ws_mx.cell(4, c).value for c in range(1, ws_mx.max_column + 1)]
    code_to_col = {h: i + 1 for i, h in enumerate(headers) if h and str(h).strip() and i + 1 > 3}
    plat_data = {}
    plat_aprobado_totals = {code: 0 for code in code_to_col}
    for r in range(5, ws_mx.max_row + 1):
        rut = clean_rut(ws_mx.cell(r, 2).value)
        if not rut:
            continue
        d = {}
        for code, c in code_to_col.items():
            val = ws_mx.cell(r, c).value
            d[code] = val
            if val == 'Aprobado':
                plat_aprobado_totals[code] += 1
        plat_data[rut] = d

    # ---------- 4. Fusion de fuentes por documento ----------
    active_ruts = list(roster.keys())
    new_docs = []
    approved_sets = []
    for idx, doc in enumerate(orig_docs):
        m_col, p_code = DOC_MAP[idx]
        f_scores = forms_by_idx.get(idx) or {}
        has_forms = bool(f_scores)

        if m_col is None and p_code is None and not has_forms:
            # Sin ninguna fuente identificable esta corrida -> carry-forward
            # dinamico: se mantiene el bit de la persona igual al snapshot anterior.
            new_docs.append(dict(doc))
            approved = set()
            for rut in active_ruts:
                prev = orig_personas_by_rut.get(rut)
                if prev and idx < len(prev['aprob']) and prev['aprob'][idx] == '1':
                    approved.add(rut)
            approved_sets.append(approved)
            continue

        max_score_doc = doc.get('max_score')
        if max_score_doc is None and has_forms:
            max_score_doc = max(f_scores.values())

        approved = set()
        for rut in active_ruts:
            ok = False
            if m_col is not None:
                md = maestra_data.get(rut)
                if md and md.get(m_col):
                    ok = True
            if not ok and p_code is not None:
                pd_ = plat_data.get(rut)
                if pd_ and pd_.get(p_code) == 'Aprobado':
                    ok = True
            if not ok and has_forms and max_score_doc is not None:
                sc = f_scores.get(rut)
                if sc is not None and sc >= max_score_doc:
                    ok = True
            if ok:
                approved.add(rut)
        approved_sets.append(approved)

        aprobados = len(approved)
        avance_pct = round(100 * aprobados / len(roster), 1)
        respuestas_totales = plat_aprobado_totals.get(p_code, aprobados) if p_code is not None else aprobados

        nd = dict(doc)
        nd['aprobados'] = aprobados
        nd['avance_pct'] = avance_pct
        nd['respuestas_totales'] = respuestas_totales
        if has_forms:
            nd['max_score'] = max_score_doc
            fu = list(doc.get('fuentes') or [])
            if 'Microsoft Forms' not in fu:
                fu.append('Microsoft Forms')
            nd['fuentes'] = fu
            if max_score_doc is not None and doc.get('modo') != 'puntaje_100pct':
                nd['modo'] = 'puntaje_100pct'
        new_docs.append(nd)

    # ---------- 5. Personas ----------
    n_docs = len(new_docs)
    personas = []
    for rut in active_ruts:
        r = roster[rut]
        bits = ['1' if rut in approved_sets[i] else '0' for i in range(n_docs)]
        aprob = ''.join(bits)
        ones = aprob.count('1')
        avance_pct = round(100 * ones / n_docs, 1)
        personas.append(dict(
            rut=f"{rut[:-1]}-{rut[-1]}" if len(rut) > 1 else rut,
            nombre=r['nombre'], especialidad=r['especialidad'] or '.',
            categoria=r['categoria'] or '.', turno=r['turno'] or '',
            aprob=aprob, avance_pct=avance_pct,
        ))
    personas.sort(key=lambda p: (p['avance_pct'], p['nombre']))
    avance_promedio_pct = round(sum(d['avance_pct'] for d in new_docs) / n_docs, 1)

    now = datetime.datetime.utcnow() - datetime.timedelta(hours=3)
    generado = now.strftime('%Y-%m-%d %H:%M')

    new_data = dict(
        generado=generado,
        total_dotacion_activa=len(roster),
        total_documentos=n_docs,
        avance_promedio_pct=avance_promedio_pct,
        documentos=new_docs,
        personas=personas,
        # Lineas de Mando: se copia TAL CUAL del snapshot anterior - no se toca aqui.
        capacitaciones_dirigidas=prev_data.get('capacitaciones_dirigidas', []),
    )

    with open(out_data_path, 'w', encoding='utf-8') as f:
        json.dump(new_data, f, ensure_ascii=False)

    result = dict(
        generado=generado,
        total_dotacion_activa=len(roster),
        total_documentos=n_docs,
        avance_promedio_pct=avance_promedio_pct,
        tarja_usada=os.path.basename(tarja_path),
        maestra_usada=os.path.basename(maestra_path),
        plataforma_usada=os.path.basename(plataforma_path),
        dotacion_previa=prev_data.get('total_dotacion_activa'),
        avance_previo=prev_data.get('avance_promedio_pct'),
        forms=forms_resumen,
    )
    print("RESULT_OK " + json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
