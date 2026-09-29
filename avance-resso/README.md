# Avance RESSO

Módulo estático integrado al dashboard RESSO 424. La interfaz vive en esta carpeta, pero la nómina y los RUT no se publican en texto plano.

## Seguridad

- `index.html`, `style.css` y `app.js` se publican sin datos personales.
- El snapshot local está en `data/avance_resso_data.js` y está excluido por `.gitignore`.
- `cifrar.html` incorpora el snapshot en `DASHBOARD_DATA.avanceResso` antes de generar `data/datos.enc.js`.
- Después del login, el dashboard envía los datos descifrados al iframe mediante `postMessage` restringido al mismo origen.
- Si el módulo se abre directamente, solo muestra un aviso y no carga información.

## Actualización

1. Reemplazar `data/avance_resso_data.js` por el nuevo snapshot manteniendo `window.AVANCE_RESSO_DATA = {...}`.
2. Importar la query de carpetas NAMI:

	`python avance-resso/import_nami_links.py "C:\ruta\LINKS NAMI.xlsx"`

3. Abrir `cifrar.html` y regenerar `data/datos.enc.js` con la contraseña habitual.
4. Incrementar la versión de `data/datos.enc.js` en `index.html`.
5. Validar y publicar los archivos cifrados y visuales.

La matriz muestra los 68 cursos consolidados del snapshot. Un aprobado con flecha verde abre la carpeta NAMI de su categoría; una flecha naranja usa como respaldo la carpeta raíz del trabajador.
