# Avance RESSO

Módulo estático integrado al dashboard RESSO 424. La interfaz vive en esta carpeta, pero la nómina y los RUT no se publican en texto plano.

## Seguridad

- `index.html`, `style.css` y `app.js` se publican sin datos personales.
- El snapshot local está en `data/avance_resso_data.js` y está excluido por `.gitignore`.
- `cifrar.html` incorpora el snapshot en `DASHBOARD_DATA.avanceResso` antes de generar `data/datos.enc.js`.
- Después del login, el dashboard envía los datos descifrados al iframe mediante `postMessage` restringido al mismo origen.
- Si el módulo se abre directamente, solo muestra un aviso y no carga información.

## Actualización

1. Sacar el snapshot actual del paquete cifrado (pide la contraseña sin mostrarla):

	`node scripts/avance_bundle.mjs extract`

	Si hay un snapshot nuevo (nómina/avance), reemplazar `data/avance_resso_data.js` manteniendo `window.AVANCE_RESSO_DATA = {...}`.
2. Sincronizar la dotación con la tarja del mes (agrega activos nuevos; quien ya no está queda como finiquitado/fuera de tarja: visible en la matriz con sus evidencias, pero no cuenta en dotación ni porcentajes):

	`python avance-resso/sync_tarja.py "TARJA OCTUBRE OBRA 424..xlsb"`
3. Marcar lo registrado en la Maestra de Capacitación (curso con fecha en su columna de capacitación; solo suma, deja la fecha como respaldo en la matriz):

	`python avance-resso/apply_maestra.py "Maestra de Capacitación 01-10-26.xlsx"`
4. Actualizar los enlaces NAMI desde la carpeta sincronizada con OneDrive
	(`D:\OneDrive - Empresas SK\SKCIC - ICSK HSEC - 424 - CC 101\0.- RESSO Ver. 10\02 RESSO V10\B - DO\B1 - Competencias y Formacion\Pregunta 11\Difusiones y capacitaciones`):

	`python avance-resso/scan_nami_pdfs.py "<carpeta>"` — lee el curso dentro de cada certificado (los nombres `RUT_RF_3.pdf` no lo indican). Solo relee lo que cambió.

	`python avance-resso/import_nami_links.py "<carpeta>" --sharepoint-path "sites/ICSK-HSEC/Documentos compartidos/05 - Respaldo HSEC faenas/424 - CC 101/0.- RESSO Ver. 10/02 RESSO V10/B - DO/B1 - Competencias y Formacion/Pregunta 11/Difusiones y capacitaciones"`

	El detalle archivo → curso queda en `fuentes/nami_match_report.csv` (privado).

	`python avance-resso/apply_nami_approvals.py` — marca como aprobados los cursos con certificado NAMI que aún figuran pendientes (solo suma; no quita aprobaciones de otras fuentes) y recalcula los porcentajes.
5. Volver a cifrar solo la parte de Avance RESSO dentro de `data/datos.enc.js`:

	`node scripts/avance_bundle.mjs pack`
6. Incrementar la versión de `data/datos.enc.js` en `index.html`, validar y publicar.

## Matriz trabajador × curso

- Cada columna usa una sigla corta (RF-xx, R-xxx, MA-xxx, IRL-xxx…); el glosario bajo la matriz lista la sigla y el título completo.
- Un ✓↗ abre el certificado NAMI (PDF) de ese curso para ese trabajador. Solo hay link si existe el PDF: los cursos que NAMI no tiene (37 de 68, ej. Protección Auditiva, Anexo IRL) se ven como ✓ sin link y el tooltip indica su fuente (Forms, plataforma o Maestra). El filtro "Cursos con certificado NAMI" muestra los 31 que sí tienen evidencia.
- Los enlaces se reconstruyen desde la ruta de SharePoint, sin el GUID de vista que traen los hipervínculos exportados. Quien abra un enlace necesita permiso de lectura en el sitio ICSK-HSEC.
