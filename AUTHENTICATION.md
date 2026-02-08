# Sistema de Autenticación - Sesiones basadas en Cookies

## Resumen

El sistema utiliza **autenticación basada en sesiones con cookies** (NO JWT). Las sesiones son manejadas por `express-session` y las cookies son enviadas automáticamente por el navegador en cada petición.

## Configuración del Servidor

### Middleware de Sesión (index.js)

```javascript
app.use(session({
  secret: process.env.SESSION_SECRET || 'medieval-game-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,        // Set to true in production with HTTPS
    httpOnly: true,       // Prevents client-side JS from accessing the cookie
    sameSite: 'lax',      // CSRF protection
    maxAge: 24 * 60 * 60 * 1000  // 24 hours
  }
}));
```

**Flags de Seguridad:**
- `httpOnly: true` - Previene que JavaScript del lado del cliente acceda a la cookie
- `secure: false` - En desarrollo. Cambiar a `true` en producción con HTTPS
- `sameSite: 'lax'` - Protección contra CSRF

### CORS Configuration

```javascript
app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true  // CRITICAL: Allows cookies to be sent cross-origin
}));
```

## Endpoints de Autenticación

### POST /api/auth/login

**Request Body:**
```json
{
  "username": "string",
  "password": "string"
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

**Comportamiento:**
- Valida credenciales contra la base de datos
- Establece `req.session.user` con datos del usuario
- Registra en `actions.log`: "Inició sesión exitosamente (role)"
- NO devuelve tokens en el JSON
- La cookie de sesión es enviada automáticamente por express-session

**Logs:**
- Login exitoso → `actions.log`
- Usuario no existe → `exceptions.log`
- Contraseña incorrecta → `exceptions.log`
- Sin credenciales → `exceptions.log`

### POST /api/auth/logout

**Response:**
```json
{
  "success": true,
  "message": "Sesión cerrada exitosamente"
}
```

**Comportamiento:**
- Destruye la sesión del servidor
- Registra en `actions.log`: "Cerró sesión"
- La cookie es invalidada automáticamente

### GET /api/auth/me

Verifica si hay una sesión activa.

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

**Response (No Session):**
```json
{
  "success": false,
  "message": "No hay sesión activa"
}
```

## Middleware de Protección

### requireAuth

Protege rutas que requieren autenticación.

**Uso:**
```javascript
router.get('/protected-route', requireAuth, async (req, res) => {
  // req.session.user está disponible aquí
  const playerId = req.session.user.player_id;
});
```

**Comportamiento:**
- Verifica la existencia de `req.session.user`
- Si no hay sesión, retorna 401 y registra en `exceptions.log`
- Si hay sesión, permite el acceso

### requireAdmin

Protege rutas que requieren permisos de administrador.

**Comportamiento:**
- Verifica la existencia de `req.session.user`
- Verifica que `req.session.user.role === 'admin'`
- Registra intentos de acceso no autorizados en `exceptions.log`

## Configuración del Frontend

### Axios Configuration (MapViewer.vue)

```javascript
// Configure axios globally to send credentials with all requests
axios.defaults.withCredentials = true;
```

**IMPORTANTE:**
- `withCredentials: true` es **CRÍTICO** para que las cookies sean enviadas
- Debe estar configurado antes de hacer cualquier petición
- Sin esto, las cookies NO se envían y la autenticación falla

### Ejemplo de Login

```javascript
const login = async (username, password) => {
  try {
    const response = await axios.post(`${API_URL}/api/auth/login`, {
      username,
      password
    });

    if (response.data.success) {
      // La sesión está establecida automáticamente vía cookie
      // No necesitas guardar nada en localStorage
      console.log('Logged in:', response.data.user);
    }
  } catch (error) {
    console.error('Login failed:', error);
  }
};
```

### Ejemplo de Logout

```javascript
const logout = async () => {
  try {
    const response = await axios.post(`${API_URL}/api/auth/logout`);

    if (response.data.success) {
      // La sesión fue destruida
      // Redirigir a login
    }
  } catch (error) {
    console.error('Logout failed:', error);
  }
};
```

## Logs de Seguridad

### actions.log

Registra eventos de autenticación exitosos:
```
[2026-02-08T10:30:45.123Z] [USER:1] Inició sesión exitosamente (admin)
[2026-02-08T14:22:10.456Z] [USER:1] Cerró sesión
```

### exceptions.log

Registra intentos fallidos y errores:
```
[2026-02-08T10:29:12.789Z] =====================================
ERROR: Login attempt with non-existent user
TYPE: error
ENDPOINT: /api/auth/login
USERNAME: hackeruser
=====================================

[2026-02-08T10:30:00.111Z] =====================================
ERROR: Unauthorized access attempt
TYPE: error
ENDPOINT: /api/admin/config
METHOD: POST
IP: ::1
=====================================

[2026-02-08T14:15:30.222Z] =====================================
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

### Protección Implementada

1. **HttpOnly Cookies**: JavaScript no puede acceder a las cookies de sesión
2. **SameSite Protection**: Protección contra CSRF
3. **Session Timeout**: 24 horas de inactividad
4. **Logging Completo**: Todos los eventos de autenticación son registrados
5. **CORS Restrictivo**: Solo permite el origen configurado
6. **Role-Based Access**: Middleware verifica roles para endpoints administrativos

### Recomendaciones para Producción

1. Cambiar `cookie.secure` a `true`
2. Usar HTTPS obligatoriamente
3. Cambiar `SESSION_SECRET` a un valor seguro y aleatorio
4. Considerar usar un store de sesiones (Redis) en lugar de memoria
5. Implementar rate limiting en endpoints de login
6. Agregar hash de contraseñas (bcrypt) en lugar de texto plano
7. Implementar tokens CSRF para operaciones críticas

## Debugging

### Verificar que la cookie se está enviando

**En el navegador (DevTools > Network):**
1. Hacer login
2. Verificar en la respuesta de `/api/auth/login` que hay un header `Set-Cookie`
3. En peticiones subsecuentes, verificar que hay un header `Cookie` con el sessionId

**En el servidor:**
```javascript
console.log('Session:', req.session);
console.log('User:', req.session?.user);
```

### Problemas Comunes

1. **Cookie no se envía:**
   - Verificar `axios.defaults.withCredentials = true`
   - Verificar CORS con `credentials: true`
   - Verificar que frontend y backend están en el mismo dominio o configurados correctamente

2. **Sesión se pierde:**
   - Verificar que `saveUninitialized: false`
   - Verificar que no hay múltiples instancias del servidor
   - Considerar usar un store persistente (Redis)

3. **401 en todas las peticiones:**
   - Verificar que la sesión no expiró
   - Verificar que las cookies no están bloqueadas
   - Verificar configuración de CORS

## Migración desde JWT

Si anteriormente usabas JWT:

1. **Eliminar del Frontend:**
   - Borrar cualquier `localStorage.setItem('token', ...)`
   - Eliminar headers `Authorization: Bearer <token>`
   - Agregar `axios.defaults.withCredentials = true`

2. **Eliminar del Backend:**
   - Borrar middleware `authenticateToken` basado en JWT
   - Eliminar `jsonwebtoken` de dependencies
   - Usar `requireAuth` que verifica sesiones

3. **Actualizar Endpoints:**
   - Login ya NO debe devolver tokens
   - Endpoints protegidos ya NO deben verificar headers Authorization
   - Usar `req.session.user` en lugar de `req.user` del JWT
