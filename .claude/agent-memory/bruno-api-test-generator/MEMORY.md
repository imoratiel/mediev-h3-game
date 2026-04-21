# Bruno API Test Generator - Memory

## Project Structure
- Bruno collection root: `D:\claude\mediev-h3-game\bruno\`
- Environment file: `bruno/environments/dev.bru`
- Collection manifest: `bruno/bruno.json` (version "1")
- Folder descriptors: each subfolder needs a `folder.bru` with `meta { name, seq }`

## Authentication Pattern
- JWT via cookie HttpOnly named `access_token` (stateless, NO sessions)
- Login: `POST /api/auth/login` with `{ username, password }` body
- Existing login test saves token to env var `jwt_token` (not `access_token`) - NOTE: the cookie flow means Bruno tests may not need to manually pass the token for public endpoints; for protected endpoints, the cookie is set automatically if Bruno shares the session
- Endpoints WITHOUT `authenticateToken` middleware are fully public (no auth test needed for 401)

## Endpoint Auth Status (confirmed from routes/api.js)
- `GET /api/map/region` - PUBLIC (no authenticateToken)
- `GET /api/terrain-types` - PUBLIC
- `GET /api/map/cell-details/:h3_index` - PUBLIC
- `GET /api/players/:id` - PUBLIC
- `GET /api/game/world-state` - PUBLIC
- `GET /api/military/unit-types` - PUBLIC
- Everything else requires `authenticateToken`

## /api/map/region Endpoint (confirmed)
- Method: GET, Auth: none (public)
- Query params: `minLat`, `maxLat`, `minLng`, `maxLng` (all required), `res` (optional, default 8)
- Response: JSON array (NOT wrapped in `{ success, data }`)
- Error 400: missing params `{ error: "Missing bounding box parameters" }`, non-numeric `{ error: "Invalid bounding box parameters" }`

## Response Format Inconsistency
- Map endpoints return raw arrays or objects (NOT `{ success: true, data: ... }`)
- Game/military/auth endpoints use `{ success: true/false, data/error: ... }` pattern

## Bruno Syntax — Critical Notes
- `tests {}` blocks use Chai: `expect(res.getStatus()).to.equal(200)` NOT `res.status: eq 200`
- `res.getStatus()`, `res.getBody()`, `res.getHeader("X-Header")` in scripts/tests
- `script:pre-request {}` supports `await` — use for sleep: `await new Promise(r => setTimeout(r, ms))`
- `settings { timeout: 40000 }` required for requests with pre-request sleep > default timeout
- `bru.setVar()` session scope, `bru.setEnvVar()` persistent env scope
- `auth: none` for public endpoints; cookies shared automatically in Bruno session

## Rate Limiter (rateLimiter.js) — confirmed limits
- AUTH: max 5 / 60s by IP → POST /api/auth/login → 429: `{ success: false, message: "Demasiados intentos..." }`
- WRITE_MILITARY: max 8 / 60s by player_id → move-army, attack, attack-army, recruit, merge
- WRITE_CONQUER: max 4 / 60s by player_id → conquer, conquer-fief, claim
- byPlayer: 429 message: `"Demasiadas peticiones. Espera un momento antes de continuar."`
- byPlayer skips if no req.user (unauthenticated) — returns next(), not 429
- Boundary: `hits.length <= max` → hit N = max IS allowed; hit N+1 is blocked

## Attack Cooldown (CombatService.js) — confirmed
- Table: `army_actions_cooldowns` with `turns_remaining`
- Cooldown applied ONLY after successful combat
- 400 response: `{ success: false, code: "COOLDOWN_ACTIVE", message: "...enfriamiento..." }`
- Cooldown is PER ARMY (army_id), not per player — other armies unaffected

## SuspicionDetector.js — confirmed rules
- Runs every 30s. Reads `audit.log` JSONL (fields: ts, pid, un, ip, action, endpoint, status, ms, meta)
- FAST_ACTIONS: pid count > 6 WRITE in 30s → severity: high
- HIGH_4XX_RATE: pid count > 15 status 4xx in 60s → severity: medium
- REPEATED_PAYLOAD: same pid:action:meta.h3 >= 3 times in 10s → severity: high (meta.h3 must be present)
- INHUMAN_TIMING: gap < 150ms between consecutive WRITEs from same pid → severity: high
- LOGIN_BRUTE_WIN: >= 4 status 401 then 200 from same IP in /auth/login → severity: high
- Dedup: no new alert if same (player_id, rule) unreviewed in last 10 min
- CAVEAT: auditMiddleware skips if !req.user → public login requests NOT in audit.log

## auditMiddleware — confirmed behavior
- Activated via POST /admin/player-audit/enable (requireAdmin)
- Only logs POST/PUT/PATCH/DELETE, only if req.user exists, skips 5xx
- meta.h3 from body.h3_index or req.params.h3_index

## Admin Player Audit Endpoints
- `POST /api/admin/player-audit/enable` → `{ success: true, message: "Auditoría activada" }`
- `GET /api/admin/player-audit/alerts?reviewed=false&limit=50` → `{ success: true, alerts: [...] }`
  - Alert fields: id, player_id, username, rule, severity, details (JSON string or object), created_at, reviewed_at
- Both require admin JWT (requireAdmin)

## SD Test Design Pattern
- Pattern: enable audit → actions → sleep 35s → check alerts
- Sleep: dedicated .bru file with `script:pre-request { await new Promise(r => setTimeout(r, 35000)); }` + `settings { timeout: 40000 }`
- Negative checks: sd-check-no-alert.bru with `bru.setVar("sd_check_rule", "RULE_NAME")` before running
- INHUMAN_TIMING is unreliable via Bruno on non-localhost (network latency often > 150ms)
- details field in alerts may be JSON string — always parse: `typeof d === "string" ? JSON.parse(d) : d`

## Environment Variables (dev.bru)
- `base_url`, `username`, `password`, `jwt_token`, `region_*` (existing)
- `admin_username` / `admin_password`: admin credentials (new)
- `test_army_id` / `test_army_id_2`: army IDs for CD tests
- `sd_repeated_h3` / `sd_boundary_h3`: h3 indices for SD payload tests
- `sd_check_rule`: rule name for sd-check-no-alert.bru
