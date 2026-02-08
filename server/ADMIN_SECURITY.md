# Seguridad del Panel de Administración

## Resumen

Todas las rutas administrativas están protegidas con **JWT + verificación de rol de administrador**. Solo usuarios con `role = 'admin'` en la base de datos pueden acceder.

## Arquitectura de Protección

### Doble Middleware en Cascada

```javascript
router.post('/admin/action', authenticateToken, requireAdmin, async (req, res) => {
  // Solo ejecuta si:
  // 1. JWT válido en cookie (authenticateToken)
  // 2. req.user.role === 'admin' (requireAdmin)
});
```

**Orden CRÍTICO:**
1. `authenticateToken` - Verifica JWT y establece `req.user`
2. `requireAdmin` - Verifica que `req.user.role === 'admin'`

**❌ INCORRECTO:**
```javascript
router.post('/admin/action', requireAdmin, async (req, res) => {
  // ❌ FALLA: req.user no existe porque authenticateToken no se ejecutó
});
```

## Rutas Protegidas

Todas las rutas que comienzan con `/api/admin/*` están protegidas:

### 1. POST /api/admin/reset
**Acción:** Resetea el mundo del juego (turno 0, fecha inicial)

**Middlewares:** `authenticateToken` → `requireAdmin`

**Logs:**
- Acceso: `"Acceso administrativo a /admin/reset - Reseteando mundo"`
- Éxito: `"Mundo reseteado exitosamente"`
- Error: `exceptions.log`

### 2. GET /api/admin/stats
**Acción:** Obtiene estadísticas del juego (turnos, jugadores, territorios, etc.)

**Middlewares:** `authenticateToken` → `requireAdmin`

**Logs:**
- Acceso: `"Acceso administrativo a /admin/stats"`

### 3. POST /api/admin/reset-explorations
**Acción:** Resetea todas las exploraciones en progreso

**Middlewares:** `authenticateToken` → `requireAdmin`

**Logs:**
- Acceso: `"Acceso administrativo a /admin/reset-explorations - Reseteando exploraciones"`
- Éxito: `"Exploraciones reseteadas exitosamente"`

### 4. POST /api/admin/config
**Acción:** Actualiza el intervalo de turnos (`turn_interval_seconds`)

**Middlewares:** `authenticateToken` → `requireAdmin`

**Logs:**
- Acceso: `"Acceso administrativo a /admin/config - Actualizando intervalo de turnos a Xs"`
- Éxito: `"Configuración actualizada: turn_interval_seconds = X"`

### 5. GET /api/admin/game-config
**Acción:** Obtiene la configuración completa del juego

**Middlewares:** `authenticateToken` → `requireAdmin`

**Logs:**
- Acceso: `"Acceso administrativo a /admin/game-config - Consultando configuración"`

### 6. PUT /api/admin/game-config
**Acción:** Actualiza cualquier valor de configuración del juego

**Middlewares:** `authenticateToken` → `requireAdmin`

**Logs:**
- Acceso: `"Acceso administrativo a /admin/game-config - Actualizando {group}.{key} = {value}"`
- Éxito: `"Configuración actualizada: {group}.{key} = {value}"`

## Flujo de Autenticación y Autorización

### Petición Autorizada (Admin)

```
1. Cliente → GET /api/admin/stats
   Cookie: access_token=<JWT_VÁLIDO_CON_ROLE_ADMIN>

2. authenticateToken:
   ✅ Verifica JWT
   ✅ Decodifica payload: { player_id: 1, username: "admin", role: "admin" }
   ✅ Establece req.user = payload
   ✅ Llama next()

3. requireAdmin:
   ✅ Verifica req.user existe
   ✅ Verifica req.user.role === "admin"
   ✅ Log: "Acceso administrativo a /admin/stats"
   ✅ Llama next()

4. Handler:
   ✅ Ejecuta lógica de negocio
   ✅ Retorna datos
```

### Petición Sin Token

```
1. Cliente → GET /api/admin/stats
   (Sin cookie)

2. authenticateToken:
   ❌ No hay token en req.cookies.access_token
   ❌ Log en exceptions.log: "Unauthorized access attempt - No token provided"
   ❌ Retorna 401: "Autenticación requerida. Por favor, inicia sesión."

   ⛔ Proceso termina aquí
```

### Petición con Token Inválido

```
1. Cliente → GET /api/admin/stats
   Cookie: access_token=<TOKEN_MALFORMADO>

2. authenticateToken:
   ❌ jwt.verify() falla
   ❌ Log en exceptions.log: "Invalid JWT token"
   ❌ Retorna 401: "Token inválido. Por favor, inicia sesión nuevamente."

   ⛔ Proceso termina aquí
```

### Petición con Token Expirado

```
1. Cliente → GET /api/admin/stats
   Cookie: access_token=<TOKEN_EXPIRADO>

2. authenticateToken:
   ❌ jwt.verify() detecta expiración
   ❌ Log en exceptions.log: "Expired JWT token"
   ❌ Retorna 401: "Tu sesión ha expirado. Por favor, inicia sesión nuevamente."

   ⛔ Proceso termina aquí
```

### Petición de Usuario No-Admin

```
1. Cliente → GET /api/admin/stats
   Cookie: access_token=<JWT_VÁLIDO_CON_ROLE_PLAYER>

2. authenticateToken:
   ✅ Verifica JWT
   ✅ Decodifica payload: { player_id: 2, username: "player1", role: "player" }
   ✅ Establece req.user = payload
   ✅ Llama next()

3. requireAdmin:
   ✅ Verifica req.user existe
   ❌ req.user.role = "player" ≠ "admin"
   ❌ Log en exceptions.log: "Non-admin user attempted admin access"
   ❌ Retorna 403: "Acceso denegado. Se requieren permisos de administrador."

   ⛔ Proceso termina aquí
```

## Frontend - Manejo de Errores

### Configuración Axios

```javascript
// OBLIGATORIO en todas las peticiones a /api/admin/*
axios.defaults.withCredentials = true;
```

### Ejemplo de Petición con Manejo de Errores

```javascript
const loadConfig = async () => {
  try {
    const response = await axios.get(`${API_URL}/api/admin/game-config`, {
      withCredentials: true
    });

    if (response.data.success) {
      // Procesar datos
    }
  } catch (err) {
    if (err.response?.status === 401) {
      // Token inválido o expirado
      console.error('❌ No autenticado');
      showToast('Sesión expirada o inválida', 'error');
      // Opción: Redirigir a login
    } else if (err.response?.status === 403) {
      // Token válido pero sin permisos de admin
      console.error('❌ Acceso denegado');
      showToast('⛔ Acceso Denegado: Se requieren permisos de administrador', 'error');
    } else {
      // Otro error
      console.error('Error:', err.message);
    }
  }
};
```

## Logs de Seguridad

### actions.log - Accesos Exitosos

```log
[2026-02-08T16:30:45.123Z] [USER:1] Acceso administrativo a /admin/stats
[2026-02-08T16:31:12.456Z] [USER:1] Acceso administrativo a /admin/config - Actualizando intervalo de turnos a 60s
[2026-02-08T16:31:12.789Z] [USER:1] Configuración actualizada: turn_interval_seconds = 60
[2026-02-08T16:35:20.111Z] [USER:1] Acceso administrativo a /admin/reset - Reseteando mundo
[2026-02-08T16:35:20.333Z] [USER:1] Mundo reseteado exitosamente
```

### exceptions.log - Intentos Fallidos

```log
[2026-02-08T16:25:30.222Z] =====================================
ERROR: Unauthorized access attempt - No token provided
TYPE: error
ENDPOINT: /api/admin/stats
METHOD: GET
IP: ::1
=====================================

[2026-02-08T16:28:15.444Z] =====================================
ERROR: Non-admin user attempted admin access
TYPE: error
ENDPOINT: /api/admin/config
METHOD: POST
USER_ID: 2
USERNAME: player1
ROLE: player
=====================================

[2026-02-08T16:29:45.666Z] =====================================
ERROR: Expired JWT token
TYPE: error
ENDPOINT: /api/admin/reset
METHOD: POST
EXPIRED_AT: 2026-02-07T16:29:45.666Z
=====================================
```

## Verificación de Seguridad

### Test Manual con curl

```bash
# 1. Login como admin
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' \
  -c cookies.txt

# 2. Intentar acceder a ruta admin CON cookie (debe funcionar)
curl http://localhost:3000/api/admin/stats -b cookies.txt

# 3. Intentar acceder SIN cookie (debe fallar con 401)
curl http://localhost:3000/api/admin/stats

# 4. Login como player
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"player1","password":"pass123"}' \
  -c cookies_player.txt

# 5. Intentar acceder con cookie de player (debe fallar con 403)
curl http://localhost:3000/api/admin/stats -b cookies_player.txt
```

### Resultados Esperados

1. **Con admin:** `200 OK` + datos
2. **Sin cookie:** `401 Unauthorized` + "Autenticación requerida"
3. **Con player:** `403 Forbidden` + "Acceso denegado. Se requieren permisos de administrador"

## Base de Datos - Roles

### Tabla: players

```sql
CREATE TABLE players (
  player_id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(20) DEFAULT 'player',
  ...
);
```

**Roles válidos:**
- `'player'` - Usuario normal (default)
- `'admin'` - Administrador del juego

### Verificar Rol de Usuario

```sql
SELECT player_id, username, role
FROM players
WHERE username = 'admin';

-- Resultado esperado:
-- player_id | username | role
-- ----------|----------|------
--     1     | admin    | admin
```

### Cambiar Rol de Usuario

```sql
-- Convertir usuario a admin
UPDATE players
SET role = 'admin'
WHERE username = 'nombre_usuario';

-- Quitar permisos de admin
UPDATE players
SET role = 'player'
WHERE username = 'nombre_usuario';
```

## Mejores Prácticas

### ✅ DO (Hacer)

1. **Siempre usar ambos middlewares en orden:**
   ```javascript
   router.post('/admin/x', authenticateToken, requireAdmin, handler);
   ```

2. **Registrar todos los accesos:**
   ```javascript
   Logger.action(`Acceso administrativo a ${endpoint}`, req.user.player_id);
   ```

3. **Usar `req.user` (NO `req.session`):**
   ```javascript
   const adminId = req.user.player_id;
   ```

4. **Verificar errores en frontend:**
   ```javascript
   if (err.response?.status === 403) { /* ... */ }
   ```

### ❌ DON'T (No Hacer)

1. **NO usar solo requireAdmin:**
   ```javascript
   // ❌ MALO: req.user no existe
   router.post('/admin/x', requireAdmin, handler);
   ```

2. **NO ignorar errores de autenticación:**
   ```javascript
   // ❌ MALO: No maneja 401/403
   try { await axios.get('/api/admin/x'); }
   catch (e) { /* silencioso */ }
   ```

3. **NO confiar en validación del frontend:**
   ```javascript
   // ❌ MALO: Validar rol en frontend no es suficiente
   if (userRole === 'admin') { showAdminButton(); }
   // El backend SIEMPRE debe verificar el rol
   ```

4. **NO hardcodear tokens:**
   ```javascript
   // ❌ MALO: NUNCA
   const token = 'eyJhbGciOiJIUzI1NiIs...';
   axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
   ```

## Monitoreo

### Auditoría de Accesos

```bash
# Ver todos los accesos administrativos hoy
grep "Acceso administrativo" server/logs/actions.log | grep "2026-02-08"

# Ver intentos fallidos de acceso admin
grep "Non-admin user attempted admin access" server/logs/exceptions.log

# Ver todos los cambios de configuración
grep "Configuración actualizada" server/logs/actions.log
```

### Alertas Recomendadas

1. **Múltiples intentos fallidos de admin** - Posible ataque
2. **Cambios de configuración fuera de horario** - Revisar
3. **Accesos desde IPs inusuales** - Verificar

## Respuesta a Incidentes

### Si un token de admin es comprometido:

1. **Inmediato:**
   - Cambiar `JWT_SECRET` en variables de entorno
   - Reiniciar servidor (invalida todos los tokens)
   - Cambiar contraseña del admin en BD

2. **Investigación:**
   - Revisar `actions.log` para acciones sospechosas
   - Revisar `exceptions.log` para intentos fallidos
   - Verificar cambios en `game_config` table

3. **Prevención:**
   - Implementar blacklist de tokens
   - Reducir tiempo de expiración de tokens
   - Implementar 2FA para admins
   - Rate limiting en endpoints de admin
