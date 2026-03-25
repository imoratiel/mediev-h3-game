# Log Error Analyst - Memory

## Patrones de Error Conocidos

### `restartEngine()` vs `startTimeEngine()` en TurnService.StartEngine
- **Archivo**: `server/src/services/TurnService.js`
- **Bug**: `StartEngine` llama a `restartEngine()`, que lanza excepción si `_enginePool/_engineConfig` son null
- **Cuándo ocurre**: Cuando el servidor arranca con `engine_auto_start = false` y el admin intenta iniciar el motor manualmente
- **Fix**: Sustituir `restartEngine()` por `startTimeEngine(pool, CONFIG)` en `StartEngine`
- **Archivos relacionados**: `server/src/logic/turn_engine.js` (líneas 1063, 1121-1126), `server/index.js` (línea 67)

## Arquitectura del Motor de Turnos

- `_enginePool` y `_engineConfig` solo se asignan cuando `startTimeEngine(pool, config)` es llamado
- Si `engine_auto_start = false`, el motor NO se arranca en `index.js` y esas variables quedan `null`
- `restartEngine()` solo funciona si el motor ya fue inicializado (al menos una vez) en el proceso actual
- `startTimeEngine()` es siempre seguro: tiene guard interno `if (isEngineRunning) return`

## Errores Recurrentes del Bot AI (No críticos)
- `GameActionError: Límite de ejércitos alcanzado` en `AIManagerService._expansionistRecruitment`
- Aparece repetidamente en exceptions.log cada ~3 minutos
- No bloquea el motor; el turno sigue procesándose
- Causa: bot expansionista intenta reclutar cuando ya tiene 3 ejércitos y no cumple la ratio feudos/ejércitos

## Docker Crash-Loop por Módulo No Instalado
- Ver [project_docker_crash_pattern.md](project_docker_crash_pattern.md)
- Síntoma: "SERVER STARTED" en logs pero NUNCA "[CONFIG] Configuration loaded", crash-loop ~1min
- Causa raíz A: módulo npm añadido en host sin reconstruir imagen Docker
- Causa raíz B (CONFIRMADA 2026-03-17): imagen reconstruida con --no-cache pero volumen anónimo /app/node_modules persiste del contenedor anterior → tapa los node_modules instalados en la nueva imagen
- Error exacto: `Cannot find module 'google-auth-library'` en OAuthService.js
- Fix CORRECTO: `docker compose down -v && docker compose build --no-cache backend && docker compose up -d`
- El flag `-v` borra solo volúmenes anónimos (node_modules). El volumen nombrado `pgdata` NO se borra.

## Migraciones SQL Pendientes de Aplicar
- Patrón recurrente: el código usa columnas nuevas pero la migración SQL existe pero NO fue ejecutada en la DB
- `066_noble_rank_promotion.sql`: añade `players.last_rank_promotion VARCHAR(20)` — ver error 2026-03-20
- Al detectar `column X does not exist`, siempre buscar primero en `/sql/` si hay una migración que añade esa columna

## `fief_buildings` — Esquema (sin columna player_id)
- Tabla definida en `sql/019_buildings.sql`: columnas `h3_index (PK)`, `building_id`, `remaining_construction_turns`, `is_under_construction`, `created_at`
- `player_id` del propietario del edificio NO está en `fief_buildings` — se obtiene via JOIN a `h3_map.player_id`
- `building_decay.js` usó `fb.player_id` directamente → error SQL "column fb.player_id does not exist"
- Fix: reemplazar `fb.player_id` por `m.player_id` y añadir `JOIN h3_map m ON m.h3_index = fb.h3_index` en las queries de `building_decay.js`

## Sistema Naval - Flotas (is_naval = TRUE)

- Flotas usan la tabla `armies` con `is_naval = TRUE` y `fleet_ships` para sus barcos
- Las flotas NO tienen registros en la tabla `troops` — usan `fleet_ships` en su lugar
- `executeArmyTurn` en `ArmySimulationService.js` lines 606-609: si `troops` está vacío → devuelve `success: false, moved: false`
- Este guard bloquea TODAS las flotas con destino porque nunca tienen filas en `troops`
- `processArmyRecovery` en `turn_engine.js` (~línea 984): NO filtra `is_naval = FALSE` → llama `processPassiveRecovery` para flotas → falla con "no tiene unidades" porque flotas no tienen filas en `troops`
- Fix recovery: añadir `AND a.is_naval = FALSE` en la SELECT de `processArmyRecovery`, O skipear flotas con `if (army.is_naval) continue`
- Fix recovery (alternativa): añadir `a.is_naval` a la SELECT y hacer `if (army.is_naval) { skippedCount++; continue; }`
- Error en exceptions.log: `"Ejército Flota de N no tiene unidades"` y `"Ejército Tridens no tiene unidades"` — ambos son flotas navales (×1515 en sesión 2026-03-25)
- Patrón de velocidad naval: derivar `maxCells` de `MIN(st.speed)` sobre `fleet_ships JOIN ship_types`

## Archivos Clave

- Motor: `server/src/logic/turn_engine.js`
- Servicio de turnos: `server/src/services/TurnService.js`
- Config global: `server/src/config.js` (objeto CONFIG + loadGameConfig)
- Punto de entrada: `server/index.js`
- Rutas admin: `server/routes/api.js` línea 149 (`POST /admin/engine/start`)
