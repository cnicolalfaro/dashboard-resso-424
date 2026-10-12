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

HTML, CSS y JavaScript (sin dependencias ni framework).

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
3. Escanear a color, incluyendo toda la página y su QR. Subir el PDF y revisar
   los recortes de las filas. Un escaneo gris, recortado o ambiguo no es una
   confirmación automática de firma; una página sin identificación inequívoca
   no puede confirmarse.
4. Elegir explícitamente FIRMÓ o NO FIRMÓ para cada fila y confirmar. Cada curso
   conserva un resultado independiente y referencia al mismo respaldo. Quienes
   no aparecen en el registro no reciben un resultado negativo.

La repetición del mismo PDF y de su confirmación no duplica resultados.
Evaluaciones, certificados y la incorporación de difusión a la matriz existente
quedan separados: no se equipara una firma a una aprobación.
