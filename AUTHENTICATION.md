# Sistema de Autenticación - JWT con HttpOnly Cookies

## Resumen

El sistema utiliza **JSON Web Tokens (JWT)** enviados como **cookies HttpOnly**. El sistema es completamente **stateless** - el servidor NO mantiene sesiones en memoria. Toda la información del usuario viaja cifrada en el token.

## 🔑 Características Clave

- ✅ **Stateless**: Sin estado en el servidor, reiniciar no afecta usuarios autenticados
- ✅ **JWT en Cookie HttpOnly**: Protección contra XSS
- ✅ **SameSite Protection**: Protección contra CSRF
- ✅ **Logs Completos**: Todos los eventos de autenticación registrados
- ✅ **Expiración de 24 horas**: Tokens válidos por un día

## Configuración del Servidor

### Middleware (index.js)

```javascript
const cookieParser = require('cookie-parser');

app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true  // CRITICAL: Allows cookies cross-origin
}));
app.use(express.json());
app.use(cookieParser()); // Parse cookies for JWT extraction
```

### Variables de Entorno

```bash
JWT_SECRET=medieval-h3-game-jwt-secret-CHANGE-IN-PRODUCTION
```

**IMPORTANTE**: En producción, usar un secret fuerte y aleatorio de al menos 64 caracteres.

## Endpoints de Autenticación

### POST /api/auth/login

Genera un JWT y lo envía como cookie HttpOnly.

**Request Body:**
```json
{
  "username": "admin",
  "password": "admin123"
}
```

**Response (Success):**
```json
{
  "success": true,
  "user": {
    "player_id": 1,
    "username": "admin",
    "role": "admin"
  }
}
```

**Cookie Enviada:**
```
Set-Cookie: access_token=<JWT_TOKEN>; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400
```

**Comportamiento:**
1. Valida credenciales contra la base de datos
2. Genera JWT firmado con payload: `{ player_id, username, role }`
3. Envía token como cookie HttpOnly llamada `access_token`
4. Registra en `actions.log`: "JWT generado y enviado para usuario X (role)"
5. NO devuelve el token en el JSON (solo en la cookie)

**Logs:**
- Login exitoso → `actions.log`
- Usuario no existe → `exceptions.log`
- Contraseña incorrecta → `exceptions.log`
- Sin credenciales → `exceptions.log`

### POST /api/auth/logout

Limpia la cookie del JWT.

**Request:** Requiere JWT válido en cookie

**Response:**
```json
{
  "success": true,
  "message": "Sesión cerrada exitosamente"
}
```

**Comportamiento:**
1. Verifica JWT (middleware `authenticateToken`)
2. Limpia cookie `access_token` con `res.clearCookie()`
3. Registra en `actions.log`: "Cerró sesión (JWT invalidado)"

**Nota:** El JWT no se "invalida" realmente (es stateless), solo se elimina del navegador. Si alguien guardó el token, seguiría siendo válido hasta su expiración.

### GET /api/auth/me

Verifica si hay un JWT válido.

**Request:** Requiere JWT válido en cookie

**Response (Success):**
```json
{
  "success": true,
  "user": {
    "player_id": 1,
    "username": "admin",
    "role": "admin"
  }
}
```

**Response (No Token / Invalid):**
```json
{
  "success": false,
  "message": "Autenticación requerida. Por favor, inicia sesión."
}
```

## Middleware de Protección

### authenticateToken

Extrae y verifica el JWT desde la cookie `access_token`.

**Ubicación:** `server/src/middleware/auth.js`

**Uso:**
```javascript
router.get('/protected-route', authenticateToken, async (req, res) => {
  // req.user contiene: { player_id, username, role }
  const playerId = req.user.player_id;
});
```

**Comportamiento:**
1. Extrae token desde `req.cookies.access_token`
2. Si no hay token, retorna 401 y registra en `exceptions.log`
3. Verifica firma del JWT con `jwt.verify(token, JWT_SECRET)`
4. Si el token es inválido, retorna 401 con mensaje "Token inválido"
5. Si el token expiró, retorna 401 con mensaje "Tu sesión ha expirado"
6. Si es válido, decodifica payload y lo asigna a `req.user`
7. Llama a `next()` para continuar

**Errores Manejados:**
- `JsonWebTokenError`: Token malformado o firma inválida
- `TokenExpiredError`: Token expirado
- Otros errores: Error 500

### requireAdmin

Verifica que el usuario tenga rol de administrador.

**IMPORTANTE:** Debe usarse DESPUÉS de `authenticateToken`:

```javascript
router.post('/admin/action', authenticateToken, requireAdmin, async (req, res) => {
  // Solo accesible por admins
});
```

**Comportamiento:**
1. Verifica que `req.user` exista (debe haberse ejecutado `authenticateToken`)
2. Verifica que `req.user.role === 'admin'`
3. Si no es admin, retorna 403 y registra en `exceptions.log`

## Estructura del JWT

### Payload

```json
{
  "player_id": 1,
  "username": "admin",
  "role": "admin",
  "iat": 1675123456,  // Issued At (timestamp)
  "exp": 1675209856   // Expiration (timestamp)
}
```

### Configuración JWT

```javascript
// server/src/middleware/auth.js
const JWT_SECRET = process.env.JWT_SECRET || 'medieval-h3-game-jwt-secret-CHANGE-IN-PRODUCTION';
const JWT_EXPIRES_IN = '24h';

const generateToken = (payload) => {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN
  });
};
```

## Configuración del Frontend

### Axios Configuration

```javascript
// CRITICAL: Must be set before any API calls
axios.defaults.withCredentials = true;
```

**IMPORTANTE:**
- `withCredentials: true` es **OBLIGATORIO** para que las cookies se envíen
- Sin esto, la cookie NO se incluye en las peticiones y la autenticación falla
- Debe configurarse ANTES de hacer cualquier petición

### Ejemplo de Login

```javascript
const login = async (username, password) => {
  try {
    const response = await axios.post(`${API_URL}/api/auth/login`, {
      username,
      password
    });

    if (response.data.success) {
      // El JWT está en la cookie - NO en response.data
      // No necesitas guardarlo en localStorage
      console.log('Logged in:', response.data.user);

      // El navegador automáticamente enviará la cookie en futuras peticiones
    }
  } catch (error) {
    if (error.response?.status === 401) {
      console.error('Credenciales incorrectas');
    }
  }
};
```

### Ejemplo de Logout

```javascript
const logout = async () => {
  try {
    const response = await axios.post(`${API_URL}/api/auth/logout`);

    if (response.data.success) {
      // Cookie eliminada, redirigir a login
      window.location.href = '/login';
    }
  } catch (error) {
    console.error('Logout failed:', error);
  }
};
```

### Ejemplo de Petición Protegida

```javascript
// El JWT en cookie se envía automáticamente
const getMyData = async () => {
  try {
    const response = await axios.get(`${API_URL}/api/game/my-fiefs`);
    return response.data.fiefs;
  } catch (error) {
    if (error.response?.status === 401) {
      // Token inválido o expirado, redirigir a login
      window.location.href = '/login';
    }
  }
};
```

## Logs de Seguridad

### actions.log

```
[2026-02-08T15:30:45.123Z] [USER:1] JWT generado y enviado para usuario admin (admin)
[2026-02-08T18:22:10.456Z] [USER:1] Cerró sesión (JWT invalidado)
```

### exceptions.log

```
[2026-02-08T15:29:12.789Z] =====================================
ERROR: Unauthorized access attempt - No token provided
TYPE: error
ENDPOINT: /api/game/my-fiefs
METHOD: GET
IP: ::1
=====================================

[2026-02-08T15:30:00.111Z] =====================================
ERROR: Invalid JWT token
TYPE: error
ENDPOINT: /api/auth/me
METHOD: GET
ERROR: invalid signature
=====================================

[2026-02-08T18:15:30.222Z] =====================================
ERROR: Expired JWT token
TYPE: error
ENDPOINT: /api/military/troops
METHOD: GET
EXPIRED_AT: 2026-02-07T18:15:30.222Z
=====================================

[2026-02-08T14:22:05.333Z] =====================================
ERROR: Non-admin user attempted admin access
TYPE: error
ENDPOINT: /api/admin/reset
METHOD: POST
USER_ID: 2
USERNAME: player1
ROLE: player
=====================================
```

## Seguridad

### Protecciones Implementadas

1. **HttpOnly Cookies**: JavaScript no puede acceder al token → Protección contra XSS
2. **SameSite=Lax**: Previene CSRF en la mayoría de casos
3. **Firma JWT**: Token no puede ser modificado sin conocer el secret
4. **Expiración**: Tokens expiran en 24 horas
5. **Logging Completo**: Todos los eventos de autenticación registrados
6. **CORS Restrictivo**: Solo permite origen configurado
7. **Role-Based Access**: Middleware verifica roles para endpoints administrativos

### Ventajas del Sistema Stateless

✅ **Escalabilidad**: No hay estado compartido entre servidores
✅ **Reinicio sin pérdida**: Reiniciar el servidor no cierra sesiones
✅ **Sin base de datos de sesiones**: No necesita Redis/Memcached
✅ **Simplicidad**: No hay sincronización de sesiones

### Desventajas y Consideraciones

⚠️ **No se puede invalidar antes de expiración**: Si un token es robado, será válido hasta expirar
⚠️ **Tamaño de cookie**: JWT es más grande que un session ID
⚠️ **Secret comprometido = catástrofe**: Si se filtra JWT_SECRET, todos los tokens son inválidos y cualquiera puede generar tokens

### Recomendaciones para Producción

1. ✅ **Cambiar `secure` a `true`** (requiere HTTPS)
2. ✅ **JWT_SECRET fuerte**: Mínimo 64 caracteres aleatorios
3. ✅ **HTTPS obligatorio**: Sin HTTPS, las cookies pueden ser interceptadas
4. ✅ **Rate limiting**: Limitar intentos de login (prevenir brute force)
5. ✅ **Hash de contraseñas**: Usar bcrypt en lugar de texto plano
6. ✅ **Tokens de refresh**: Para renovar sin pedir credenciales
7. ✅ **Lista negra de tokens**: Para invalidar tokens antes de expiración (requiere persistencia)
8. ✅ **Rotación de secrets**: Cambiar JWT_SECRET periódicamente con estrategia de migración

## Debugging

### Verificar que la cookie se envía

**En DevTools > Network:**

1. **Login Request:**
   - Response Headers debe contener: `Set-Cookie: access_token=<token>; ...`

2. **Peticiones subsecuentes:**
   - Request Headers debe contener: `Cookie: access_token=<token>`

**En DevTools > Application > Cookies:**
- Debe aparecer cookie `access_token` con:
  - Domain: `localhost`
  - Path: `/`
  - HttpOnly: ✅
  - SameSite: `Lax`

### Decodificar JWT (solo para debugging)

```javascript
// En consola del navegador (solo para ver payload, NO para validar)
const token = document.cookie.split('access_token=')[1]?.split(';')[0];
if (token) {
  const payload = JSON.parse(atob(token.split('.')[1]));
  console.log('JWT Payload:', payload);
}
```

**IMPORTANTE:** Esto solo decodifica el token, NO lo valida. La validación SIEMPRE debe hacerse en el servidor.

### Verificar en el servidor

```javascript
// Agregar temporalmente en authenticateToken
console.log('Token from cookie:', req.cookies.access_token);
console.log('Decoded user:', req.user);
```

### Problemas Comunes

1. **Cookie no se envía:**
   - ✅ Verificar `axios.defaults.withCredentials = true`
   - ✅ Verificar CORS con `credentials: true`
   - ✅ Verificar que frontend y backend están en dominios compatibles

2. **401 Unauthorized en todas las peticiones:**
   - ✅ Verificar que el token no expiró (24h)
   - ✅ Verificar que JWT_SECRET es el mismo en todas las instancias del servidor
   - ✅ Verificar que la cookie existe en DevTools

3. **Token se borra al recargar:**
   - ✅ Verificar que `maxAge` está configurado (24 horas)
   - ✅ Verificar que no estás en modo incógnito (cookies se borran al cerrar)

4. **CORS errors:**
   - ✅ Verificar que el origin en CORS coincide exactamente con el frontend
   - ✅ Verificar `credentials: true` en ambos lados (servidor y cliente)

## Comparación con Sesiones

| Característica | JWT (Actual) | Sesiones (Anterior) |
|---|---|---|
| Estado en servidor | ❌ Stateless | ✅ Stateful |
| Escalabilidad | ✅ Alta | ⚠️ Requiere store compartido |
| Reinicio del servidor | ✅ No afecta usuarios | ❌ Cierra todas las sesiones |
| Invalidación inmediata | ❌ Difícil | ✅ Fácil (destroy session) |
| Tamaño | ⚠️ JWT más grande | ✅ Solo session ID |
| Complejidad | ✅ Simple | ⚠️ Requiere session store |
| Seguridad | ✅ Firma criptográfica | ✅ ID aleatorio |

## Migración desde Sistema de Sesiones

Si vienes del sistema anterior con `express-session`:

### Cambios en Backend

❌ **Eliminado:**
```javascript
const session = require('express-session');
app.use(session({...}));
req.session.user
req.session.destroy()
```

✅ **Nuevo:**
```javascript
const cookieParser = require('cookie-parser');
app.use(cookieParser());
req.user  // Desde JWT
res.clearCookie('access_token')
```

### Cambios en Frontend

❌ **NO hacer:**
```javascript
localStorage.setItem('token', token);  // ¡NUNCA!
axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;  // ¡NO!
```

✅ **Correcto:**
```javascript
axios.defaults.withCredentials = true;  // Solo esto
// El navegador maneja la cookie automáticamente
```

### Sin Cambios Necesarios

✅ El frontend NO necesita cambios si ya estaba usando:
- `axios.defaults.withCredentials = true`
- Las peticiones ya enviaban cookies
- El sistema es transparente para el cliente

## Testing

### Test Manual de Login

```bash
# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' \
  -c cookies.txt \
  -v

# Verificar /auth/me
curl http://localhost:3000/api/auth/me \
  -b cookies.txt

# Logout
curl -X POST http://localhost:3000/api/auth/logout \
  -b cookies.txt
```

### Test de Endpoint Protegido

```bash
# Sin cookie (debe fallar)
curl http://localhost:3000/api/game/my-fiefs

# Con cookie (debe funcionar)
curl http://localhost:3000/api/game/my-fiefs -b cookies.txt
```
