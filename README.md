# RESSO SKIC 424 — Dashboard SSO

Dashboard de cumplimiento del Sistema de Gestión de Seguridad y Salud Ocupacional
para el contrato **SKIC 424** (CC-101, División Chuquicamata — Codelco).

## Contenido

- **Cumplimiento RESSO** por ciclo PHVA (Plan · Do · Check · Act) con las 40 preguntas del Instrumento de Auditoría RESSO V10.
- **KPIs**: cumplimiento documental, terreno y total.
- **Hallazgos** documentales y en terreno.
- **Reglamentos internos** de minería aplicables (con buscador).
- **Auditoría ABC-S** 2026.

## Ver el dashboard

Publicado con GitHub Pages. Los porcentajes se alimentan desde
[`data/dashboard_data.js`](data/dashboard_data.js).

## Actualizar revisión documental RESSO v10

```powershell
python scripts\actualizar_evidencias.py "C:\ruta\Revision_Documental_RESSO_26-10-2026.xlsx"
```

La fecha de corte se obtiene del nombre del Excel. Con `--dry-run` se consultan
los indicadores sin modificar páginas. Actualiza únicamente
[las páginas de v10](pages/evidencias/index.html), conserva las fechas dentro
de las observaciones y no modifica los enlaces del visor guardados en el navegador.

## Centro de Auditorías RESSO v11

El menú tiene accesos independientes para [RESSO v10](pages/evidencias/index.html)
y [RESSO v11](pages/evidencias-v11/index.html). Para actualizar únicamente v11:

```powershell
python scripts\actualizar_evidencias_v11.py "C:\ruta\Revision_Documental_RESSO_v11.xlsx" --date 22-10-2026
```

`--date` indica la fecha de actualización. Agrega `--dry-run` para consultar
los indicadores sin escribir páginas. Requiere `openpyxl`, igual que el
actualizador de v10.

- Calcula resultados, estados y prioridades desde los niveles de la planilla,
  incluso cuando Excel no ha guardado los resultados de sus fórmulas.
- Los niveles vacíos quedan como **Pendiente**; se excluyen del porcentaje,
  al igual que los **N/A**. Los hipervínculos de evidencia de Excel se conservan.
- Las evidencias se buscan directamente en `05 RESSO V11/01 versión 11`,
  `02 versión 11`, etc., con número de dos dígitos y sin carpetas intermedias
  por fase o subsección.
- Los archivos seleccionados en modo auditor se guardan en el navegador con
  la clave `resso424_v11_auditor_evidence_links_v1`, sin leer ni modificar la
  clave de v10. No son un respaldo compartido entre navegadores o equipos.
- La hoja `Cambios v10 → v11` alimenta las marcas de adaptación en fases y modo
  auditor: rosado pálido para preguntas nuevas; amarillo para modificadas
  (incluidas reubicadas) o equivalentes incompletas; verde para equivalentes
  con nivel 100 % (incluye cambios solo de redacción o ponderación).
  Los N/A mantienen una marca neutral. La etiqueta y el detalle explican el
  motivo; estos colores no alteran los estados ni certifican evidencia nueva.
- El visor de SharePoint conserva el enlace alternativo para abrir el archivo
  si SharePoint impide incrustarlo. El visor local y la subida de v11 quedan
  pendientes de configurar su carpeta sincronizada; no usan el servicio de v10.

## Tecnología

Dashboard estático en HTML, CSS y JavaScript. NAMI incorpora un servicio Python
privado con dependencias declaradas en `nami_service/requirements.txt`.

## NAMI · Procesar documentos

El nuevo acceso del menú mantiene los módulos existentes. Permite preparar un
registro de cuadrilla con uno a cuatro cursos RF y una firma por participante,
cargar el PDF escaneado a color, revisar cada fila y confirmar la **difusión**.
No acredita evaluaciones de entendimiento ni modifica las aprobaciones del
snapshot de Avance RESSO. El historial de difusión queda en el servicio privado,
por persona y curso, con su evidencia.

### Requisitos de operación

- El servicio Python de `nami_service/` debe desplegarse en infraestructura
  privada, detrás de HTTPS y de un proxy **del mismo origen** que publique
  `/api/nami/`. GitHub Pages y la publicación estática de Netlify, por sí solos,
  no ejecutan este servicio. Sin él, la interfaz informa que no está disponible.
- El acceso NAMI exige una sesión propia de operador; la contraseña que
  descifra el dashboard no concede permisos de escritura en el servicio.
- TARJA, catálogos, manifiestos, base de datos y escaneos deben permanecer fuera
  del repositorio y de cualquier directorio servido por la web. No incorporarlos
  a commits ni a paquetes del sitio.
- Validar el diseño de difusión contra **SGR-R-006.DCH** antes de utilizarlo
  oficialmente. No se dispone de la plantilla oficial en este repositorio:
  el PDF generado no pretende sustituirla sin esa validación.

### Flujo y alcance

1. Seleccionar cuadrilla, fecha y hasta cuatro cursos RF. Verificar participantes
   y aceptar el uso del formato validado. El PDF contiene páginas identificadas
   por QR y un manifiesto inmutable con el orden de las filas.
2. Imprimir y obtener una firma por persona para la difusión conjunta de los
   cursos indicados. A quien no firme, marcar su fila con plumón rojo, con un
   trazo horizontal centrado desde **RUT hasta FIRMA**, sin invadir filas vecinas.
   Para las sugerencias automáticas, imprimir también el control azul a color;
   si se imprime en blanco y negro, las filas requerirán revisión manual.
3. Escanear a color, incluyendo toda la página y su QR. Subir el PDF y revisar
   los recortes de las filas. Conservar también los marcadores de las esquinas
   y el control de color impresos: permiten comprobar alineación y color incluso
   cuando nadie tiene una marca roja. Un escaneo gris, recortado o ambiguo no es una
   confirmación automática de firma; una página sin identificación inequívoca
   no puede confirmarse.
4. Elegir explícitamente FIRMÓ o NO FIRMÓ para cada fila y confirmar. Cada curso
   conserva un resultado independiente y referencia al mismo respaldo. Quienes
   no aparecen en el registro no reciben un resultado negativo.

La repetición del mismo PDF y de su confirmación no duplica resultados.
Cada carga admite hasta 20 MiB y 25 páginas; el análisis tiene límites de
resolución y de tiempo para proteger el servicio.
Evaluaciones, certificados y la incorporación de difusión a la matriz existente
quedan separados: no se equipara una firma a una aprobación.

### Configuración privada

Instalar las dependencias de `nami_service/requirements.txt` en un entorno
virtual del servidor. Configurar estas variables mediante el administrador de
secretos del despliegue, nunca mediante archivos publicados:

| Variable | Uso |
| --- | --- |
| `NAMI_DATA_DIR` | Directorio privado persistente, fuera del sitio y del repositorio. |
| `NAMI_PUBLIC_ROOT` | Directorio publicado por el proxy, si difiere de este repositorio; el servicio impide guardar datos dentro de él. |
| `NAMI_TARJA_PATH` | Ruta al Excel TARJA de referencia, que se abre solo para lectura. |
| `NAMI_TARJA_SHEET` | Hoja de personal si tiene un nombre distinto de `TARJA`; las hojas de resumen no aportan participantes. |
| `NAMI_SECRET_KEY` | Secreto aleatorio de firma de sesiones. |
| `NAMI_USERNAME` | Cuenta del operador autorizado. |
| `NAMI_PASSWORD_HASH` | Hash de contraseña generado con Werkzeug, no la contraseña en texto plano. |
| `NAMI_ORIGIN` | Origen HTTPS exacto de la web, sin ruta, para validar las solicitudes. |
| `NAMI_ROLE` | Permisos de la cuenta: `operator` (predeterminado), `registrar` o `reviewer`. |
| `NAMI_PORT` | Puerto local del servicio (predeterminado: `8001`). |

En el directorio privado, `catalog.json` contiene `courses` (cada curso con
`id`, `code`, `title`, `content`) y `crews` (cada cuadrilla con `id`, `name`,
`ruts`). El catálogo aporta la pertenencia a la cuadrilla; los datos personales
se resuelven contra la TARJA. Preparar este archivo en el servidor, sin datos
de ejemplo reales en el código.

El proxy debe preservar el origen y la ruta `/api/nami`, terminar TLS,
limitar cargas y no almacenar en caché respuestas privadas. No habilitar CORS
abierto ni exponer el servicio directamente a Internet. Respaldar el directorio
privado completo (base de datos y evidencias) y restringir su acceso al usuario
del servicio. El despliegue y la carga de fuentes reales requieren acceso a esa
infraestructura; no se activan al publicar solamente la web estática.

Desde la raíz del proyecto, iniciar el servicio con `python -m nami_service`.
Waitress escucha únicamente en `127.0.0.1`; publicar la ruta mediante el proxy
HTTPS configurado. Reiniciar el servicio cuando cambien la TARJA o el catálogo.
El directorio privado debe pertenecer a la cuenta del servicio y tener permisos
`0700` en el servidor.

Las pruebas del servicio usan datos sintéticos y se ejecutan con
`python -m unittest nami_service.test_service`; no necesitan la TARJA real ni
credenciales de producción.

## Continuar NAMI en VS Code (WSL / Linux)

1. En GitHub, identifica la rama que contiene estos cambios. En VS Code,
   descarga los cambios y selecciona esa rama; no es necesario que ya estén
   integrados en `main`. En Windows, instala WSL con Ubuntu y abre la carpeta
   mediante **WSL: Open Folder in WSL**. Guarda el repositorio en el sistema de
   archivos de Linux, no en una carpeta pública o sincronizada con OneDrive.
2. Instala las extensiones recomendadas por VS Code. Necesitas Python 3.12 con
   soporte `venv`, Caddy instalado en WSL/Linux siguiendo su distribución
   oficial y LibreOffice para convertir los Word a PDF:

   ```bash
   sudo apt install -y python3.12-venv
   sudo apt install -y --no-install-recommends libreoffice-writer fonts-liberation fonts-crosextra-carlito fonts-crosextra-caladea fonts-dejavu
   ```

   Caddy se usa únicamente como proxy local; no sustituye el despliegue
   privado de producción.
3. Ejecuta **Terminal → Run Task → NAMI: instalar dependencias**. Esta tarea
   crea `.venv` y utiliza las versiones de `nami_service/requirements.txt`.
   Selecciona `.venv/bin/python` mediante **Python: Select Interpreter** si VS
   Code conserva un intérprete anterior.
4. Prepara un directorio privado externo, por ejemplo `$HOME/.local/share/nami`,
   con permisos `0700`. El servicio exige allí un `catalog.json` y una TARJA al
   arrancar. Para comenzar crea datos **sintéticos** con este comando, desde la
   raíz del proyecto, y nunca copies datos reales a archivos del repositorio:

   ```bash
   .venv/bin/python -c "import json, pathlib; from nami_service.test_workflow import build_tarja, workbook_bytes, RUTS; d = pathlib.Path.home()/'.local/share/nami'; d.mkdir(mode=0o700, parents=True, exist_ok=True); (d/'TARJA.xlsx').write_bytes(workbook_bytes(build_tarja)); (d/'catalog.json').write_text(json.dumps({'crews': [{'id': '1', 'name': 'Cuadrilla sintética', 'ruts': [RUTS['a1']]}], 'courses': [{'id': 'rf1', 'code': 'RF-01', 'title': 'Curso sintético', 'content': 'Contenido sintético.'}]}))"
   chmod 600 ~/.local/share/nami/TARJA.xlsx ~/.local/share/nami/catalog.json
   ```

   Las planillas reales se suben después desde la página (ver más abajo).
5. Crea `$HOME/.config/nami/dev.env` con permisos `0600` y su carpeta con `0700`.
   Es el archivo externo que carga el depurador; **no se crea automáticamente**.
   Añade estas variables con tus propios valores:

   ```dotenv
   NAMI_DATA_DIR=/home/TU_USUARIO/.local/share/nami
   NAMI_TARJA_PATH=/home/TU_USUARIO/.local/share/nami/TARJA.xlsx
   NAMI_USERNAME=operador-local
   NAMI_SECRET_KEY=REEMPLAZAR_CON_UN_SECRETO_ALEATORIO
   NAMI_PASSWORD_HASH=REEMPLAZAR_CON_HASH_WERKZEUG
   ```

   Usa rutas absolutas reales: el archivo no expande `$HOME`. Genera el secreto
   con el intérprete del entorno mediante
   `python -c "import secrets; print(secrets.token_urlsafe(48))"`.
   Para generar el hash sin escribir la contraseña en el historial, utiliza
   `python -c "from getpass import getpass; from werkzeug.security import generate_password_hash; print(generate_password_hash(getpass('Contraseña local: ')))"`.
   Guarda ambos resultados solo en el archivo externo; no los compartas en
   chats, capturas ni commits. La configuración de depuración fija el origen en
   `https://localhost:8443` y el puerto del servicio en `8001`.
6. Ejecuta **NAMI: pruebas** para comprobar el servicio con sus fixtures
   sintéticos. No requiere el archivo `dev.env` ni los documentos reales. Para
   incluir también las pruebas del flujo con planillas (algunas necesitan
   LibreOffice): `python -m unittest nami_service.test_service nami_service.test_workflow`.
7. Ejecuta **NAMI: proxy HTTPS local**, y luego **Run and Debug → NAMI: servicio
   privado (WSL/Linux)** con F5. Abre **https://localhost:8443/nami/**. El acceso
   directo a NAMI permite probarlo sin descifrar el dashboard de producción;
   exige su propia cuenta configurada en `dev.env`.

### Registros desde planillas y plantillas Word

Con el servicio en marcha, el paso **1 · Preparar** de la página trabaja así:

- **Planillas.** Sube la TARJA, las cuadrillas y la matriz de capacitación. Se
  validan, se guardan en `sources/` del directorio privado con su huella y se
  usa siempre la última de cada tipo; el historial se conserva. La matriz se lee
  tal como se sube y **no se modifica**: solo cuenta la celda «Aprobado».
- **Cuadrillas.** El capataz es el nombre que sigue a «N - » en la columna
  `CUADRILLA`. El turno lo decide el `TURNO` del capataz en la TARJA: si termina
  en `N` (por ejemplo `10X10 A-N`) es noche; si no, día.
- **Plantilla del registro.** Copia tu Word a
  `$NAMI_DATA_DIR/templates/registro.docx` con permisos `0600`. También puede
  reemplazarse con `POST /api/nami/templates` (`kind=register`).
- **Evaluaciones.** Bajo cada curso marcado aparece un selector para cargar su
  Word. Debe tener `[NOMBRETRABAJADOR]` en el pie de página; la versión anterior
  queda en `templates/anteriores/`. También pueden copiarse a mano como
  `templates/eval-rf01.docx`, `eval-rf02.docx`, etc.
- **Quién entra.** En cada registro quedan las personas a las que les falta algún
  curso elegido, incluidos los capataces. Solo quedan fuera quienes ya lo tienen
  aprobado. Quien no figura en la matriz se incluye como pendiente.
- **Descargas.** Un PDF por cuadrilla (registro y evaluaciones) y un ZIP con las
  carpetas *Turno Día* y *Turno Noche*. La casilla «Agrupar cuadrillas chicas»
  junta las de hasta 4 pendientes del mismo turno en una sola hoja.
- **Por cargo y relator.** En lugar de cuadrillas puede elegirse «Por cargo»: lista
  desplegable de los cargos de la TARJA vigente (columna ESPECIALIDAD; vacía o «.»
  se agrupa como «SIN ESPECIALIDAD»); se genera un registro por cargo, sin capataz, en la carpeta
  *Por cargo* del ZIP. «Relator» es un texto libre que se escribe en el registro;
  vacío, se conserva el de la plantilla.
- **Certificados.** Con los escaneos confirmados, «Descargar certificados (ZIP)»
  (todo, por fecha, o solo el escaneo recién confirmado) entrega
  `<dd-mm-aaaa>/<NOMBRE_RUT>/Riesgos_de_Fatalidad/<RUT>_RF-NN.pdf`. Cada PDF lleva la
  evaluación escaneada y la hoja escaneada del registro donde figura la persona.
  Solo se incluyen personas con firma en un registro confirmado; las demás quedan
  listadas en `NO_INCLUIDOS.txt`.
  «Guardar certificados en CERTIFICADOS NAMI» los deja directamente en esa carpeta
  (ruta en `NAMI_CERTIFICATES_DIR`, en la configuración privada): solo agrega lo que
  falta, reutiliza la carpeta del trabajador si ya existe (la busca por el RUT) y
  nunca reemplaza ni borra archivos. Después se corre el paso 4 de `avance-resso/README.md`.
- **Escaneo de evaluaciones.** Cada hoja de evaluación nueva lleva un QR firmado
  pequeño. Las ya impresas (sin QR) se identifican leyendo con OCR el título «RF-NN»
  y el nombre del pie, y se cruzan con los registros generados (el nombre debe
  coincidir y la persona debía tener pendiente ese RF). Necesita Tesseract:
  `sudo apt install -y tesseract-ocr tesseract-ocr-spa`. Es solo evidencia: no
  aprueba nada. Las evaluaciones pueden imprimirse en blanco y negro; el registro,
  en cambio, lleva un control azul y debe imprimirse a color para que el escáner
  sugiera firmas y ausencias (si no, todas las filas piden revisión humana).

Firmar acredita la difusión, no aprueba evaluaciones, y nada de esto modifica la
matriz ni Avance RESSO. El paquete fija `OPENBLAS_NUM_THREADS=1` para que el
proceso de escaneo respete su límite de memoria.

**Qué no va a GitHub.** Las planillas reales, las plantillas Word de la
empresa, `dev.env` y cualquier PDF generado contienen datos del contrato o de
personas: se comparten por un canal privado, nunca con un commit. Este
repositorio es público.

### Varias instalaciones (otros computadores)

Un escaneo se reconoce en cualquier instalación si todas comparten dos cosas (en `dev.env`):

| Variable | Uso |
| --- | --- |
| `NAMI_QR_KEY` | Clave con que se firman los QR de registros y evaluaciones. **La misma en todas las instalaciones** (mínimo 32 caracteres); se comparte por un canal privado. Sin ella se usa `NAMI_SECRET_KEY`, como antes. |
| `NAMI_QR_TRUSTED_KEYS` | Claves antiguas aceptadas solo para validar (separadas por coma): la `NAMI_SECRET_KEY` de una instalación que ya imprimió documentos antes de usar `NAMI_QR_KEY`. |
| `NAMI_SHARED_DIR` | Carpeta común (p. ej. sincronizada con OneDrive de la empresa). Cada instalación publica ahí los registros que genera (`<id>.json` y sus PDF) e incorpora los de las demás al arrancar, al generar y antes de procesar un escaneo. Nunca reemplaza ni borra un registro existente. Debe estar fuera del repositorio, del sitio publicado y de `NAMI_DATA_DIR`. |

Contiene nombres y RUT de las cuadrillas: usar solo una carpeta con acceso restringido al equipo HSEC.

### HTTPS local y archivos publicados

Caddy genera una autoridad de certificación **local** e intenta instalar su
certificado raíz. Si no tiene permisos, importa manualmente su `root.crt` al
almacén de confianza de tu equipo; normalmente está en
`$HOME/.local/share/caddy/pki/authorities/local/root.crt` (puede variar si
configuraste `XDG_DATA_HOME`). En Windows debes importar también esa raíz local
al almacén que use tu navegador. Importa solo el certificado, nunca
`root.key`, y confía únicamente en la autoridad de tu equipo de desarrollo.
La API administrativa de Caddy está deshabilitada en esta configuración.
No desactives las cookies seguras ni la verificación TLS para solucionar avisos.

`dev/Caddyfile` escucha solo en loopback. Publica exclusivamente los archivos
actuales de la interfaz `/nami/` y
dirige `/api/nami` al servicio; el resto de rutas devuelve 404. No publica la
TARJA, la configuración, el código Python ni el paquete de datos del dashboard.
Live Server por sí solo no proporciona este proxy.

Detén la depuración y termina la tarea de Caddy al finalizar. Los registros y
evidencias permanecen en el directorio privado. Esta configuración no modifica
aprobaciones de evaluaciones ni despliega nada en producción.
