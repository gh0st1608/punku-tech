# AI Engineering Factory

Base de un MVP local para coordinar agentes de ingeniería, observar ejecuciones y atribuir consumo de IA. El repositorio inicia con el contrato compartido, una API NestJS con persistencia PostgreSQL y perfiles de agentes OpenCode.

## Estado actual

- La API crea/lista ejecuciones, consulta detalle, genera y persiste planes con tareas, consulta eventos y resume uso.
- PostgreSQL se levanta con Docker Compose.
- OpenCode se integra por su API HTTP con la versión requerida `2.4.2`; el adapter valida health, lista agentes y crea sesiones.
- OpenCode genera planes que se validan y persisten antes de ejecutar tareas.
- La ejecución de sesiones por tarea, sus dependencias y cancelación siguen pendientes.
- No hay dashboard React, CRUD generado, tablas de tarifas ni Quality Gate ejecutable todavía.

## Requisitos

- Node.js 22 o posterior y npm
- Docker Compose
- OpenCode instalado y un proveedor/modelo configurado en el entorno local
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

Configura `OPENCODE_BASE_URL`, `OPENCODE_REQUIRED_VERSION`, `OPENCODE_WORKSPACE_ROOT` y `OPENCODE_PASSWORD` en `.env`. Ejecuta OpenCode `2.4.2` con `opencode serve --hostname 127.0.0.1 --port 4096`, usando el mismo password y un workspace visible desde ambos procesos. El adapter usa Basic Auth con el usuario fijo `opencode`; no registra la contraseña.

La API escucha solo en `127.0.0.1:3000/api`, y PostgreSQL publica su puerto solo en la interfaz local. El esquema de base de datos se encuentra en `apps/orchestration-api/prisma/schema.prisma`.

## Calidad de código

ESLint aplica las reglas recomendadas de JavaScript y TypeScript, junto con advertencias de complejidad y code smells de SonarJS. Prettier aplica formato consistente, y TypeScript usa modo estricto.

```powershell
npm run format
npm run lint
npm run typecheck
npm run quality
```

`quality` revisa formato, lint y tipos; no ejecuta pruebas. Las reglas de complejidad empiezan como advertencias para que el equipo pueda refactorizar de forma gradual sin ocultar los errores de lint.

## Rutas iniciales

- `POST /api/executions`
- `GET /api/executions`
- `GET /api/executions/:id`
- `POST /api/executions/:id/plan`
- `POST /api/executions/:id/cancel`
- `GET /api/executions/:id/events`
- `GET /api/executions/:id/stream` (SSE)
- `GET /api/executions/:id/usage`
- `GET /api/runtime/health`
- `GET /api/runtime/agents`
- `POST /api/runtime/sessions`

Los identificadores de ejecución deben ser UUID válidos. `POST /api/executions` recorta y valida el requerimiento; `budgetUsd` acepta de 0.01 a 1000 USD con hasta dos decimales. Si se omite, se usa `EXECUTION_BUDGET_USD` cuando está configurado; si no, queda sin límite configurado.

`CORS_ORIGINS` es una lista separada por comas de orígenes HTTP/HTTPS exactos. No admite comodines. La configuración inválida o la ausencia de `DATABASE_URL` impiden iniciar la API con un mensaje que no revela valores sensibles.

La ruta de eventos devuelve el campo `eventId` del contrato compartido; el detalle incluye hasta 500 eventos y el endpoint de historial devuelve hasta 1000 por consulta. El stream SSE emite eventos en orden temporal y retoma después del último `Last-Event-ID` recibido al reconectar. El resumen de uso conserva `null` cuando una métrica no está disponible y reporta cuántos turnos tienen uso o costo conocido.

`POST /api/executions/:id/plan` crea una sesión temporal con el agente `orchestrator`, solicita un plan JSON y valida IDs de agentes, criterios de aceptación y dependencias sin ciclos. Persiste las tareas como `PLANNED` y publica `EXECUTION_PLAN_CREATED`. Un error de OpenCode o de validación deja la ejecución como `FAILED` y registra un evento sin copiar el mensaje interno. La ejecución de esas tareas aún no está implementada.

El stream refleja eventos persistidos en PostgreSQL; todavía no retransmite la actividad de sesiones OpenCode en tiempo real.

## Próximos cortes

1. Ejecutar tareas planificadas en sesiones OpenCode independientes; aplicar dependencias, fallos y cancelación.
2. Crear workspaces aislados por ejecución y una revisión humana antes de integrar cambios.
3. Persistir eventos y artefactos de las sesiones con correlación e idempotencia; mostrarlos en el dashboard.
4. Ingerir usage por turno y tarifas versionadas; etiquetar cada cifra como `REPORTED`, `ESTIMATED` o `UNAVAILABLE`.
5. Generar el CRUD Project/Task, ejecutar QA automatizado y guardar evidencia del Quality Gate.

El documento de backlog es una referencia de alcance. El proveedor y los modelos siguen pendientes de selección; por eso el scaffold no inventa tarifas ni configura credenciales.
