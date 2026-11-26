# AI Engineering Factory

Base de un MVP local para coordinar agentes de ingeniería, observar ejecuciones y atribuir consumo de IA. El repositorio inicia con el contrato compartido, una API NestJS con persistencia PostgreSQL y perfiles de agentes OpenCode.

## Estado actual

- La API crea/lista ejecuciones, consulta detalle, solicita inicio/cancelación y conserva eventos y resúmenes de uso.
- PostgreSQL se levanta con Docker Compose.
- OpenCode tiene perfiles de orquestador y seis especialistas.
- El inicio actualmente registra `EXECUTION_PLANNING_REQUESTED`; el adaptador que crea sesiones OpenCode y ejecuta tareas todavía debe conectarse.
- No hay dashboard React, CRUD generado, tablas de tarifas ni Quality Gate ejecutable todavía.

## Requisitos

- Node.js 22 o posterior y npm
- Docker Compose
- OpenCode instalado y un proveedor/modelo configurado en el entorno local

## Inicio local

```powershell
Copy-Item .env.example .env
docker compose -f infrastructure/docker-compose.yml up -d postgres
npm install
npm run db:generate
npm run db:migrate
npm run dev:api
```

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
- `POST /api/executions/:id/start`
- `POST /api/executions/:id/cancel`
- `GET /api/executions/:id/events`
- `GET /api/executions/:id/stream` (SSE)
- `GET /api/executions/:id/usage`

Los identificadores de ejecución deben ser UUID válidos. `POST /api/executions` recorta y valida el requerimiento; `budgetUsd` acepta de 0.01 a 1000 USD con hasta dos decimales. Si se omite, se usa `EXECUTION_BUDGET_USD` cuando está configurado; si no, queda sin límite configurado.

`CORS_ORIGINS` es una lista separada por comas de orígenes HTTP/HTTPS exactos. No admite comodines. La configuración inválida o la ausencia de `DATABASE_URL` impiden iniciar la API con un mensaje que no revela valores sensibles.

La ruta de eventos devuelve el campo `eventId` del contrato compartido; el detalle incluye hasta 500 eventos y el endpoint de historial devuelve hasta 1000 por consulta. El stream SSE emite eventos en orden temporal y retoma después del último `Last-Event-ID` recibido al reconectar. El resumen de uso conserva `null` cuando una métrica no está disponible y reporta cuántos turnos tienen uso o costo conocido.

La API implementa las rutas de ejecución actuales, pero `start` solo registra `EXECUTION_PLANNING_REQUESTED`; todavía no crea sesiones ni ejecuta agentes. El stream refleja los eventos persistidos, no actividad en vivo del runtime.

## Próximos cortes

1. Fijar y verificar una versión de OpenCode, integrar el SDK mediante un adapter y validar su esquema de eventos.
2. Persistir planes y dependencias; ejecutar una sesión por tarea con aislamiento de workspace.
3. Añadir el dashboard y actualizar timeline/agent board desde eventos persistidos.
4. Ingerir usage por turno y tarifas versionadas; etiquetar cada cifra como `REPORTED`, `ESTIMATED` o `UNAVAILABLE`.
5. Generar el CRUD Project/Task, y guardar evidencia de build, pruebas y revisión de seguridad.

El documento de backlog es una referencia de alcance. El proveedor y los modelos siguen pendientes de selección; por eso el scaffold no inventa tarifas ni configura credenciales.
