// =============================================================================
//  RESSO SKIC 424 — Datos del Dashboard (PLACEHOLDER)
//  Reemplaza estos valores con los datos reales extraídos del Excel
//  "Lista de Verificación 2026" y del "FORMATO ABC-S".
// =============================================================================
window.DASHBOARD_DATA = {
  generatedAt: "18/06/2026 15:45",
  contrato: {
    empresa: "SKIC S.A.",
    servicio: "CC-101 Obras Civiles, Montaje y Puesta en Marcha — Infraestructura MB 504",
    numero: "4600029025",
    division: "Chuquicamata",
    gerencia: "Gerencia Mantenimiento Mina Chuquicamata Subterránea",
    adminEECC: "José Luis Maira M.",
    aprEECC: "—",
    adminCodelco: "Santiago Medina Semir",
    jefeSeguridad: "—",
    fechaRevision: "18/06/2026",
  },

  // KPIs principales (Evaluacion RESSO 424 — para llenar)
  // El cumplimiento documental se calcula en vivo (ponderado por peso) = 38%.
  kpis: {
    cumplimientoDocumental: 38,   // % (ponderado oficial: 38,3 de 100 aportes)
    cumplimientoTerreno: 0,       // % (terreno aún sin evaluar)
    cumplimientoTotal: 19,        // % (promedio documental + terreno)
    nivelExposicion: "Inaceptable",  // Aceptable | Moderado | Inaceptable
  },

  // Hallazgos documentales (hoja HALLAZGOS DOC RESSO — sin hallazgos registrados)
  hallazgosDoc: [
    { label: "No conformidad", value: 0, color: "#e1251b" },
    { label: "Observación", value: 0, color: "#f0a500" },
    { label: "Oportunidad de mejora", value: 0, color: "#2a4a8a" },
  ],

  // Hallazgos en terreno (terreno aún sin evaluar)
  hallazgosTerreno: [
    { label: "Nivel 1", value: 0, color: "#e1251b" },
    { label: "Nivel 2", value: 0, color: "#f0a500" },
    { label: "Oportunidad de mejora", value: 0, color: "#2a4a8a" },
    { label: "Observación positiva", value: 0, color: "#2e8b57" },
  ],

  // Estructura RESSO (Lista de Verificación 2026) — PLAN / DO / CHECK / ACT
  // pct = valor de elemento del Excel (respaldo). Si las preguntas se evalúan,
  // el % del elemento se recalcula como promedio de las preguntas evaluadas.
  // En cada pregunta, pct: null = "Sin evaluar".
  resso: [
    {
      id: "A",
      ciclo: "PLAN",
      titulo: "Planificación Preventiva Integral",
      color: "#2a4a8a",
      elementos: [
        {
          id: "A1", nombre: "Programa de Trabajo y Planificación", pct: 100,
          preguntas: [
            { n: 1, texto: "¿La empresa contratista ha designado formalmente a sus Dueños del Riesgo para los Riesgos de Fatalidad aplicables al contrato?", peso: 5, pct: null },
            { n: 2, texto: "¿El Plan/Programa de Trabajo está aprobado por la empresa y suscrito por el Organismo Administrador? ¿Además, es difundido y está alineado a los lineamientos establecidos en SIGO-M-001 SIGO?", peso: 2, pct: null },
            { n: 3, texto: "¿La planeación incluye objetivos, metas, indicadores leading (proactivos) y lagging (reactivos), recursos y plazos, definiendo responsabilidades, consistentes con la criticidad de las actividades?", peso: 3, pct: null },
            { n: 4, texto: "¿La empresa realiza el levantamiento, caracterización y análisis de peligros y evaluación de riesgos, en función de la metodología corporativa, considerando riesgos específicos del área/lugar del contrato, riesgos naturales e histórico de accidentes de la empresa?", peso: 5, pct: null },
            { n: 5, texto: "¿Existen criterios de trazabilidad en la aplicación de Riesgos de Fatalidad y se evidencia su funcionamiento en terreno?", peso: 3, pct: null },
            { n: 6, texto: "¿La empresa informa a través del LOD o Cartas Contractuales al Administrador de Contrato CODELCO respecto de los trabajos que implican riesgos inherentes altos, indicando los métodos seguros para realizar sus tareas críticas?", peso: 0.5, pct: null },
          ],
        },
        {
          id: "A2", nombre: "Evaluación de Riesgos", pct: 30,
          preguntas: [
            { n: 7, texto: "¿La Matriz de Riesgos de la empresa, esta alineada a su mapa de procesos y se encuentra validada y actualizada periódicamente por la empresa?", peso: 2, pct: null },
            { n: 8, texto: "¿La Matriz considera el levantamiento de Riesgos de Fatalidad y establece el tratamiento de riesgos en función de la jerarquía de controles?", peso: 2, pct: null },
          ],
        },
        {
          id: "A3", nombre: "Marco Regulatorio y Cumplimiento", pct: 20,
          preguntas: [
            { n: 9, texto: "¿La empresa considera la identificación y cumplimiento del marco legal en el desempeño de sus actividades, considerando al menos, una metodología formal para su aplicación, la actualización periódica y la gestión de brechas, según corresponda?", peso: 2, pct: null },
            { n: 10, texto: "¿Se dio cumplimiento en plazo a las instrucciones/observaciones de los organismos y autoridades fiscalizadoras competentes y la de sus subcontratos? Si aplica. ¿Informando los resultados al administrador CODELCO y a la GSSO vía LOD o carta contractual?", peso: 0.5, pct: null },
          ],
        },
      ],
    },
    {
      id: "B",
      ciclo: "DO",
      titulo: "Implementación del Control Operacional",
      color: "#1f7a8c",
      elementos: [
        {
          id: "B1", nombre: "Competencias y Formación", pct: 0,
          preguntas: [
            { n: 11, texto: "¿Se cumple y se dispone de evidencias de Inducciones, Información de Riesgos Laborales (IRL), capacitaciones y acreditaciones necesarias para el cumplimiento de los cargos?", peso: 2, pct: null },
            { n: 12, texto: "¿Los supervisores están formados en ejecución y verificación de controles críticos?", peso: 2, pct: null },
            { n: 13, texto: "¿La Política Corporativa y la Carta de Valores se dio a conocer a todos los trabajadores(as) de la empresa contratista y subcontratista? ¿Se cuenta con evidencia de ello?", peso: 1, pct: null },
          ],
        },
        {
          id: "B2", nombre: "Documentos Operativos y Procedimientos", pct: 0,
          preguntas: [
            { n: 14, texto: "¿Los procedimientos están vigentes, difundidos y disponibles, estos son accesibles en las áreas de interacción del contrato?", peso: 2, pct: null },
            { n: 15, texto: "¿Se evalúa el nivel de conocimiento sobre los métodos de trabajo seguro y sus controles claves, aplicables a sus procesos?", peso: 2, pct: null },
            { n: 16, texto: "¿Los cambios en condiciones operacionales, se evalúan mediante SIGO-P-030 (Gestión del Cambio)? ¿Cuentan con respaldos de su aplicabilidad?", peso: 1, pct: null },
          ],
        },
        {
          id: "B3", nombre: "Control Operacional", pct: 100,
          preguntas: [
            { n: 17, texto: "¿Los controles críticos declarados para los RF aplicables a la actividades en terreno, son consistentes con lo declarado en el ART de la tarea y la matriz IPER, estos se encuentran instalados, operativos y verificables en el área de ejecución, siendo consistente su condición real con lo descrito en el estándar de RF definido por la empresa?", peso: 5, pct: null },
            { n: 18, texto: "¿Los trabajadores en terreno muestran conocimiento en relación con controles operativos implementados?", peso: 3, pct: null },
            { n: 19, texto: "¿Se cumple y se dispone de evidencias de las actividades definidas en el Programa Mensual de Actividades (PAM), de acuerdo a lo programado?", peso: 3, pct: null },
            { n: 20, texto: "¿Se cumple y se dispone de evidencias de las actividades Diálogos de Desempeño (DdD), Confirmaciones de Proceso (CdP), Confirmaciones de Rol (CdR), de acuerdo a lo programado?", peso: 2, pct: null },
            { n: 21, texto: "¿Se aplican herramientas de control: ART, permisos, checklists y coordinación de trabajos simultáneos? ¿Se utiliza Tarjeta Verde ante desviaciones o ausencia de condiciones seguras?", peso: 3, pct: null },
            { n: 22, texto: "¿La empresa cuenta con la identificación de los GES y Programa Vigilancia Médica y es consistente con la evaluación higiénica levantada con el Organismo Administrador respectivo?", peso: 3, pct: null },
            { n: 23, texto: "¿Se da cumplimiento al ciclo de higiene, dejando respaldos de programa de Higiene Industrial, Implementación de Controles y Planes de Acción, Operación, capacitación y trazabilidad en terreno? ¿Cuenta la empresa contratista con Mapas de Riesgo de Higiene Industrial en el lugar donde realiza sus actividades?", peso: 3, pct: null },
            { n: 24, texto: "¿La empresa cuenta con procedimiento de capacitación, en el cual incluye un programa de operadores de baja experiencia laboral (BEL)?", peso: 1, pct: null },
          ],
        },
        {
          id: "B4", nombre: "Preparación del Entorno y Respuesta a Emergencias", pct: 0,
          preguntas: [
            { n: 25, texto: "¿La empresa cuenta con un plan de emergencia que considere la comunicación, coordinación y acciones y se difundió a sus trabajadores(as)? ¿El Plan de Emergencias está alineado a CODELCO?", peso: 2, pct: null },
            { n: 26, texto: "¿La empresa cuenta con un programa de simulacros de emergencias que afecten a su servicio?", peso: 2, pct: null },
            { n: 27, texto: "¿Se cumple y se dispone de evidencias de evaluación periódica de verificación de las condiciones del sitio de trabajo?", peso: 2, pct: null },
          ],
        },
        {
          id: "B5", nombre: "Gestión de Subcontratos", pct: 0,
          preguntas: [
            { n: 28, texto: "¿Los subcontratos están formalizados, son informados al Administrador de Contrato CODELCO, vía LOD o carta contractual? ¿Se encuentran categorizados y con documentación al día?", peso: 2, pct: null },
            { n: 29, texto: "¿La empresa verifica el cumplimiento del RESSO en sus subcontratos? ¿Cuenta con respaldos de su ejecución?", peso: 1, pct: null },
          ],
        },
      ],
    },
    {
      id: "C",
      ciclo: "CHECK",
      titulo: "Verificación del Desempeño Preventivo",
      color: "#b8860b",
      elementos: [
        {
          id: "C1", nombre: "Aseguramiento y Auditoría", pct: 0,
          preguntas: [
            { n: 30, texto: "¿Se difunden los reportes de incidentes Divisionales y Corporativos, en especial los que apliquen a su servicio? Si aplica, ¿la empresa realiza una evaluación de aplicabilidad e ingresa la actualización de su matriz IPER?", peso: 3, pct: null },
            { n: 31, texto: "¿Existe respaldo de verificaciones periódicas del cumplimiento del Programa de Trabajo, especialmente verificaciones enfocadas en sus Riesgos de Fatalidad? ¿Los hallazgos levantados son informados al Administrador de Contrato CODELCO?", peso: 5, pct: null },
            { n: 32, texto: "¿Existe respaldo de las acciones de auditorías internas/externas, tienen trazabilidad de cierre? Además, ¿Existe seguimiento a desviaciones recurrentes para evitar repetitividad?", peso: 2, pct: null },
            { n: 33, texto: "¿Se evalúa la eficacia de los controles principales y críticos en terreno? ¿Es consistente con la evaluación de indicadores definida en el punto N° 3 de esta lista de verificación?", peso: 2, pct: null },
          ],
        },
        {
          id: "C2", nombre: "Indicadores y Gestión de Información", pct: 0,
          preguntas: [
            { n: 34, texto: "¿La empresa cumple con la exigencia de entregar el informe requerido una vez por mes en fecha y los datos referente al cumplimiento de las actividades son concordantes con la información existente?", peso: 2, pct: null },
            { n: 35, texto: "¿La empresa entrega las estadísticas de información de riesgos profesionales en el formato requerido por CODELCO?", peso: 3, pct: null },
          ],
        },
      ],
    },
    {
      id: "D",
      ciclo: "ACT",
      titulo: "Revisión, Mejora Continua y Aprendizaje",
      color: "#7a3e9d",
      elementos: [
        {
          id: "D1", nombre: "Gestión de Incidentes", pct: 0,
          preguntas: [
            { n: 36, texto: "¿Cuenta la empresa con personal capacitado con el método ICAM?", peso: 2, pct: null },
            { n: 37, texto: "¿Los incidentes se investigan según metodología corporativa? ¿Las acciones correctivas son verificadas en terreno, se encuentran cerradas en plazo y se privilegian controles de alta jerarquía?", peso: 5, pct: null },
            { n: 38, texto: "¿La EECC evaluó los riesgos de un potencial accidente grave o fatal? ¿De lo anterior se realizó un simulacro documental, implementando las medidas dentro de los plazos?", peso: 5, pct: null },
          ],
        },
        {
          id: "D2", nombre: "Actualización del Sistema Preventivo", pct: 0,
          preguntas: [
            { n: 39, texto: "¿Se actualizan los planes, programas, procedimientos, métodos de trabajo y controles a partir de aprendizajes, auditorías o incidentes?", peso: 4, pct: null },
          ],
        },
      ],
    },
  ],

  // Reglamentos internos de minería aplicables (del documento REGIN)
  reglamentos: [
    { codigo: "R-001", nombre: "Operaciones Corte y Soldadura con Gas", difundido: true },
    { codigo: "R-002", nombre: "Manejo Gas Industrial para corte y soldadura", difundido: true },
    { codigo: "R-003", nombre: "Almacenamiento Manejo y Transporte Líq. Inflamables", difundido: true },
    { codigo: "R-006", nombre: "Personal Electricista", difundido: true },
    { codigo: "R-008", nombre: "Uso de Sistemas de Bloqueo en Equipos", difundido: true },
    { codigo: "R-015", nombre: "Manejo de Cargas con Equipos de Levante", difundido: false },
    { codigo: "R-020", nombre: "Operaciones con Grúas Horquilla", difundido: true },
    { codigo: "R-021", nombre: "Seguridad en Superficies de Trabajo", difundido: true },
    { codigo: "R-022", nombre: "Operaciones de Soldadura al Arco Manual", difundido: false },
    { codigo: "R-024", nombre: "Recipientes a Presión Compresores de Aire Industrial", difundido: true },
    { codigo: "R-025", nombre: "Manejo Sustancias Peligrosas", difundido: true },
    { codigo: "R-034", nombre: "Tránsito en Minas DCN", difundido: true },
    { codigo: "R-035", nombre: "Reglamento de Emergencias DCH", difundido: true },
  ],

  // === Auditoría ABC-S (FORMATO ABC 2026) ====================================
  // "Auditoría Aspectos Gestión de Riesgo Seguridad 2026"
  // Escala de evaluación por elemento: 100% / 60% (o 50%) / 30% / 0% / N/A
  abc: {
    titulo: "Auditoría Aspectos Gestión de Riesgo Seguridad 2026",
    totalGerencia: 94.3, // TOTAL GERENCIA (O7)
    escala: [
      { nivel: "100%", desc: "Cumplimiento total / con evidencia y difusión" },
      { nivel: "60%", desc: "Cumplimiento parcial alto" },
      { nivel: "30%", desc: "Cumplimiento parcial bajo" },
      { nivel: "0%", desc: "Sin evidencia del requerimiento" },
      { nivel: "N/A", desc: "No aplica" },
    ],
    criterios: [
      { n: 1, nombre: "Reglamentos Internos Aplicables", pct: 100 },
      { n: 2, nombre: "Mapa de proceso", pct: 80 },
      { n: 3, nombre: "Matriz (IPER)", pct: 80 },
      { n: 4, nombre: "Procedimientos y Plan de emergencia", pct: 92 },
      { n: 5, nombre: "IRL (DS 44)", pct: 62.5 },
      { n: 6, nombre: "LV RF (Riesgos de Fatalidad)", pct: 100 },
      { n: 7, nombre: "LV EST (Estándares)", pct: 50 },
      { n: 8, nombre: "LV Normativa Legal", pct: 65 },
      { n: 9, nombre: "Matriz Legal", pct: 82.5 },
    ],
  },

  // Accesos documentales (SharePoint u otros)
  accesos: [
    { titulo: "0.- RESSO Ver. 10", url: "https://empresassk.sharepoint.com/:f:/r/sites/ICSK-HSEC/Documentos%20compartidos/05%20-%20Respaldo%20HSEC%20faenas/424%20-%20CC%20101/0.-%20RESSO%20Ver.%2010?csf=1&web=1&e=9LnQNT" },
  ],
};
