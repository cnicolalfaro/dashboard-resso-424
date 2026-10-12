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
