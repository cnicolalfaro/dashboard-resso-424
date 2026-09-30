import collections
import re
import zipfile
from xml.etree import ElementTree as ET

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
p = r'c:\Users\cnico\Downloads\automate.xlsx'
z = zipfile.ZipFile(p)

ss = []
for si in ET.fromstring(z.read('xl/sharedStrings.xml')):
    ss.append(''.join(t.text or '' for t in si.iter(NS + 't')))

sh = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
rows = []
for row in sh.iter(NS + 'row'):
    d = {}
    for c in row:
        col = re.match(r'[A-Z]+', c.get('r')).group()
        v = c.find(NS + 'v')
        tt = c.get('t')
        val = v.text if v is not None else None
        if tt == 's' and val is not None:
            val = ss[int(val)]
        d[col] = (val, tt, c.get('s'))
    rows.append((row.get('r'), d))

out = []
out.append('=== encabezados fila 2 ===')
for rn, d in rows[:3]:
    out.append(f'{rn}: ' + repr({k: v[0] for k, v in sorted(d.items())}))

cnt = collections.Counter()
for rn, d in rows[2:]:
    x = d.get('I')
    cnt[x[1] if x else 'AUSENTE'] += 1
out.append('=== tipos col I (FECHA CIERRE ACCION) ===')
out.append(repr(cnt))

cntb = collections.Counter()
for rn, d in rows[2:]:
    x = d.get('B')
    cntb[x[1] if x else 'AUSENTE'] += 1
out.append('=== tipos col B (FECHA) ===')
out.append(repr(cntb))

out.append('=== primeras 25 filas B / I / J ===')
for rn, d in rows[2:27]:
    out.append(f'{rn} B={d.get("B")} I={d.get("I")} J={d.get("J")}')

out.append('=== valores no numericos en I ===')
for rn, d in rows[2:]:
    x = d.get('I')
    if not x or x[0] is None or x[1] is not None:
        out.append(f'{rn} -> {x}')

open(r'c:\Users\cnico\dashboard-resso-424\_automate_scan_out.txt', 'w', encoding='utf8').write('\n'.join(out))
print('ok', len(rows))
