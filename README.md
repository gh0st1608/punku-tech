# AI Engineering Factory

Base de un MVP local para coordinar agentes de ingeniería, observar ejecuciones y atribuir consumo de IA. El repositorio inicia con el contrato compartido, una API NestJS con persistencia PostgreSQL y perfiles de agentes OpenCode.

## Estado actual

- La API administra proyectos con CRUD, crea/lista ejecuciones, consulta detalle, genera y persiste planes con tareas, consulta eventos y resume uso.
- PostgreSQL se levanta con Docker Compose.
- OpenCode se integra por su API HTTP con la versión requerida `2.4.2`; el adapter valida health, lista agentes, crea sesiones y ejecuta tareas.
- OpenCode genera planes que se validan y persisten antes de ejecutar tareas.
- Las tareas se ejecutan secuencialmente en sesiones aisladas y respetan sus dependencias; las ejecuciones se pueden cancelar.
- Cada ejecución usa un worktree Git separado de `OPENCODE_WORKSPACE_ROOT`; sus cambios quedan allí para revisión humana y no se integran automáticamente.
- El dashboard React incluye el tablero de agentes, uso/costos y la gestión de proyectos.
- Las pruebas automatizadas usan Jest/Supertest para la API y Playwright para un flujo del dashboard; el Quality Gate genera evidencia PASS/FAIL/NOT_RUN.

## Requisitos

- Node.js 22 o posterior y npm
- Docker Compose
- OpenCode CLI `@opencode/cli` 2.4.2 con proveedor autenticado localmente
- OpenCode `2.4.2` ejecutándose en el mismo host o con acceso al mismo workspace

## Inicio local

```powershell
Copy-Item .env.example .env
docker compose -f infrastructure/docker-compose.yml up -d postgres
npm install
npm run db:generate
npm run db:migrate
npm run dev:api
```

En otra terminal, inicia el dashboard local con `npm run dev:web` y abre `http://127.0.0.1:5173`. Configura `CORS_ORIGINS=http://127.0.0.1:5173` en la API si usas ese origen; el `.env.example` del dashboard permite cambiar la URL de la API mediante `VITE_API_BASE_URL`.

Configura `OPENCODE_BASE_URL`, `OPENCODE_REQUIRED_VERSION`, `OPENCODE_WORKSPACE_ROOT`, `OPENCODE_WORKTREE_ROOT` y `OPENCODE_PASSWORD` en `.env`. El modelo predeterminado es `openai/gpt-6.2-sol`. Conecta OpenAI con `opencode auth login openai` y elige el inicio de sesion de ChatGPT; la autorizacion queda en la configuracion local de OpenCode. Ejecuta OpenCode `2.4.2` con `opencode serve --hostname 127.0.0.1 --port 4096`, pasando `OPENCODE_PASSWORD` al proceso y usando el mismo password en la API. No guardes claves de proveedor en el repositorio.

`npm run db:generate` y `npm run db:migrate` cargan la configuración desde el `.env` de la raíz del repositorio. Para una demo mínima de gestión de proyectos basta con PostgreSQL, API y dashboard; planificar o ejecutar trabajo con agentes requiere OpenCode `2.4.2` y un proveedor/modelo configurado. Sin OpenCode, la API puede iniciar y mostrar `unavailable` en `/api/runtime/health`.

La API escucha solo en `127.0.0.1:3000/api`, y PostgreSQL publica su puerto solo en la interfaz local. El esquema de base de datos se encuentra en `apps/orchestration-api/prisma/schema.prisma`.

## Calidad de código

ESLint aplica las reglas recomendadas de JavaScript y TypeScript, junto con advertencias de complejidad y code smells de SonarJS. Prettier aplica formato consistente, y TypeScript usa modo estricto.

```powershell
npm run format
npm run lint
npm run typecheck
npm run quality
npm run test:api
npx playwright install chromium
npm run test:e2e
npm run quality-gate
```

`quality` revisa formato, lint y tipos. `test:api` ejecuta Jest/Supertest; `test:e2e` ejecuta el flujo del dashboard con Playwright. `quality-gate` ejecuta las verificaciones y genera `artifacts/qa/quality-gate-summary.json` y `.md`, logs, resultados Jest y reportes Playwright. También revisa dependencias de producción y que no haya archivos `.env` reales o credenciales de alta confianza entre los archivos rastreados. El workflow de GitHub sube estas evidencias como artefactos en cada PR a `develop` o `main`.

La auditoría de producción usa `npm audit --omit=dev --omit=optional`; excluye dependencias de desarrollo y opcionales.

Para añadir costo y entregables de una ejecución al resumen, configura `AIEF_EXECUTION_ID` y `AIEF_API_BASE_URL` antes de ejecutar `quality-gate`. Sin un ID, ambos campos quedan identificados como `NOT_RUN`. Las reglas de complejidad empiezan como advertencias para que el equipo pueda refactorizar de forma gradual sin ocultar los errores de lint.

## Rutas iniciales

- `POST /api/executions`
- `GET /api/executions`
- `GET /api/executions/:id`
- `POST /api/executions/:id/plan`
- `POST /api/executions/:id/start`
- `POST /api/executions/:id/approve-budget` with `{ "newBudgetUsd": 25 }`
- `POST /api/executions/:id/cancel`
- `GET /api/executions/:id/events`
- `GET /api/executions/:id/stream` (SSE)
- `GET /api/executions/:id/usage`
- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:id`
- `PATCH /api/projects/:id`
- `DELETE /api/projects/:id`
- `GET /api/runtime/health`
- `GET /api/runtime/agents`
- `POST /api/runtime/sessions`

El dashboard local presenta el estado de los seis agentes especializados, el timeline de eventos y el detalle de cada tarea con resumen y rutas relativas de artefactos. El stream SSE recupera eventos persistidos al reconectar mediante `Last-Event-ID`; la interfaz también vuelve a cargar el snapshot de la ejecución al restablecer la conexión.

Los identificadores de ejecución deben ser UUID válidos. `POST /api/executions` recorta y valida el requerimiento; `budgetUsd` acepta de 0.01 a 1000 USD con hasta dos decimales. Si se omite, se usa `EXECUTION_BUDGET_USD` cuando está configurado; si no, queda sin límite configurado.

Los proyectos admiten nombre de 2 a 120 caracteres, descripción opcional de hasta 2000 caracteres, estado `PLANNING`, `ACTIVE`, `ON_HOLD` o `COMPLETED`, y prioridad `LOW`, `MEDIUM`, `HIGH` o `URGENT`. Las rutas `PATCH` y `DELETE` validan el UUID y rechazan campos adicionales.

`CORS_ORIGINS` es una lista separada por comas de orígenes HTTP/HTTPS exactos. No admite comodines. La configuración inválida o la ausencia de `DATABASE_URL` impiden iniciar la API con un mensaje que no revela valores sensibles.

La ruta de eventos devuelve el campo `eventId` del contrato compartido; eventos de OpenCode también incluyen `sourceEventId`. El detalle incluye hasta 500 eventos y el endpoint de historial devuelve hasta 1000 por consulta. El stream SSE emite eventos persistidos en orden temporal y retoma después del último `Last-Event-ID` recibido al reconectar. El consumidor guarda eventos de sesión con correlación a ejecución, tarea y agente, sin guardar texto, entradas de herramientas ni payloads de OpenCode; los IDs de origen evitan filas duplicadas. La API de eventos de OpenCode es volátil: los eventos emitidos mientras el consumidor está desconectado pueden perderse.

`POST /api/executions/:id/plan` crea una sesión temporal con el agente `orchestrator`, solicita un plan JSON y valida IDs de agentes, criterios de aceptación y dependencias sin ciclos. Persiste las tareas como `PLANNED` y publica `EXECUTION_PLAN_CREATED`. Un error de OpenCode o de validación deja la ejecución como `FAILED` y registra un evento sin copiar el mensaje interno.

`POST /api/executions/:id/start` solo inicia ejecuciones con plan guardado. Crea un worktree Git aislado en la rama `aief/execution-<id>` y ejecuta una sesión OpenCode por tarea, una a la vez. El dashboard muestra el nombre de la rama para que una persona pueda inspeccionarla. Una tarea comienza cuando todas sus dependencias están `COMPLETED`; si una falla, las pendientes quedan `BLOCKED` y la ejecución queda `FAILED`. Cancelar marca tareas no terminales como `CANCELLED` e intenta interrumpir sus sesiones. El runner no hace push, merge ni deploy. Para integrar cambios, una persona debe revisar la rama y aprobar el Pull Request según las reglas de revisión configuradas en GitHub. Al iniciar, la API reanuda ejecuciones `RUNNING`, verifica el worktree y comprueba el historial de OpenCode antes de volver a enviar la tarea. Varias instancias comparten un lease de ejecución persistido en PostgreSQL: el propietario lo renueva cada 10 segundos y deja de mutar la ejecución si pierde el lease; tras 30 segundos sin renovación, otra instancia puede reclamar la ejecución.

El stream refleja eventos persistidos en PostgreSQL; todavía no retransmite la actividad de sesiones OpenCode en tiempo real.

Los eventos `session.step.ended` y `session.step.failed` registran como máximo un uso por `sessionId` y `messageId`, con tokens de entrada, salida, razonamiento y caché. Se conserva el costo que reporta OpenCode como `REPORTED`. Para estimar costos, configura `MODEL_TARIFFS_JSON` con tarifas oficiales por proveedor, modelo y versión, expresadas en USD por millón de tokens para cada categoría. No hay tarifas incluidas por defecto; si falta el modelo, la tarifa o algún dato de tokens, el costo estimado queda `UNAVAILABLE`. El endpoint `GET /api/executions/:id/usage` devuelve overview y desgloses por agente, tarea y modelo, sin duplicar mensajes.

`GET /api/executions/:id/tasks/:taskId` devuelve el detalle de una tarea con sus eventos, el resumen final del agente y las rutas de archivos modificados. El resumen se limita a 4000 caracteres y aplica redacción de patrones habituales de credenciales; no se guardan mensajes de herramientas ni parches. Las rutas se guardan únicamente como paths relativos y se descartan rutas absolutas y nombres de archivos sensibles conocidos. Esta redacción es una defensa adicional y no reemplaza las reglas para que los agentes nunca escriban secretos en sus respuestas.

## Próximos cortes

1. Resolver las vulnerabilidades altas reportadas por la auditoría de dependencias de Prisma y volver a ejecutar el Quality Gate.

Cuando el costo reportado o estimado alcanza el 80% del presupuesto, se registra una sola alerta. Al 100%, la API pausa la ejecución antes de asignar la siguiente tarea. El dashboard permite cancelar o aprobar un límite mayor (hasta 1000 USD) y reanudar las tareas pendientes. Las aprobaciones quedan registradas como eventos.

El documento de backlog es una referencia de alcance. Las tarifas del proveedor siguen sin definirse; el proyecto no inventa precios y marca como no disponibles los costos sin datos verificables.
