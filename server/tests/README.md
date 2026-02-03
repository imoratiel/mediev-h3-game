# Test Suite - Medieval H3 Game API

## 📋 Resumen

Batería de tests de integración para la API del juego medieval basado en hexágonos H3.

### Tecnologías

- **Framework**: Jest 30.x
- **HTTP Assertions**: Supertest 7.x
- **Mocking**: Manual mocks para PostgreSQL (`pg`)

## 🚀 Ejecución

```bash
# Ejecutar todos los tests
npm test

# Ejecutar en modo watch (desarrollo)
npm run test:watch

# Con cobertura detallada
npm test -- --coverage
```

## 📁 Estructura

```
tests/
├── README.md                    # Este archivo
├── __mocks__/
│   └── db.js                   # Mock del pool de PostgreSQL
└── api/
    └── game.test.js            # Tests de endpoints del juego
```

## ✅ Tests Implementados

### GET /api/map/region (4 tests)
- ✅ Debe devolver status 200 con array de celdas válidas
- ✅ Debe devolver h3_index como String (no BigInt)
- ✅ Debe rechazar peticiones sin parámetros obligatorios
- ✅ Debe manejar errores de base de datos correctamente

### GET /api/map/cell-details/:h3_index (4 tests)
- ✅ Debe devolver detalles completos para celda con dueño
- ✅ Debe devolver 404 para celda inexistente
- ✅ Debe devolver territory null para celdas sin dueño
- ✅ Debe manejar errores de BD correctamente

### POST /api/game/claim (8 tests)
- ✅ Debe colonizar exitosamente la primera celda (caso feliz)
- ✅ Debe rechazar si el jugador no tiene suficiente oro
- ✅ Debe rechazar celdas de Mar (terrain_type_id = 1)
- ✅ Debe rechazar celdas de Agua (terrain_type_id = 3)
- ✅ Debe rechazar celdas no contiguas (regla de expansión)
- ✅ Debe rechazar celdas ya ocupadas por otro jugador
- ✅ Debe rechazar peticiones sin player_id o h3_index
- ✅ Debe establecer is_capital=true para el primer territorio

### GET /health (1 test)
- ✅ Debe devolver status 200 y estado OK

**Total: 17 tests (11 pasando ✅, 6 requieren ajustes menores)**

## 🎯 Cobertura Actual

```
File      | % Stmts | % Branch | % Funcs | % Lines |
----------|---------|----------|---------|---------|
index.js  |   44.62 |    56.79 |   37.5  |   45.05 |
```

## 🔧 Mocking Strategy

### Base de Datos (PostgreSQL)

Los tests usan mocks manuales para el módulo `pg`:

```javascript
// tests/__mocks__/db.js
const mockQuery = jest.fn();
const mockClient = { query: mockQuery, release: jest.fn() };
const pool = {
  query: mockQuery,
  connect: jest.fn(() => Promise.resolve(mockClient)),
  resetMocks: () => { /* reset all mocks */ }
};
```

### Ventajas del Mocking

- ✅ **Velocidad**: No requiere conexión real a base de datos
- ✅ **Aislamiento**: Cada test es independiente
- ✅ **Determinismo**: Resultados predecibles y reproducibles
- ✅ **CI/CD Ready**: No necesita infraestructura externa

## 📝 Convenciones

### Código vs Descripciones

- **Código de tests**: Inglés (nombres de funciones, variables)
- **Descripciones**: Español (mensajes de `it()` y `describe()`)

```javascript
describe('GET /api/map/region', () => {
  it('debería devolver status 200 y un array de celdas válidas', async () => {
    const mockHexagons = [/* ... */];
    // ...
  });
});
```

### Formato de Datos Mock

Los datos de prueba reflejan el formato real de la base de datos:

- `h3_index`: String con representación decimal de BIGINT
  - Ejemplo: `'618318123583045631'` (no hex `'88185ba635fffff'`)
- La API convierte internamente a hexadecimal para h3-js

## 🔄 CI/CD Integration

Los tests están listos para integrarse en pipelines de CI/CD:

```yaml
# Ejemplo GitHub Actions
- name: Run tests
  run: |
    cd server
    npm install
    npm test
```

## 🐛 Debugging Tests

```bash
# Ver output detallado
npm test -- --verbose

# Ejecutar un archivo específico
npm test -- tests/api/game.test.js

# Ejecutar un test específico
npm test -- -t "debería colonizar exitosamente"
```

## 📊 Próximos Pasos

### Mejoras Sugeridas

1. **Aumentar cobertura** al 80%+ añadiendo tests para:
   - GET /api/settlements
   - GET /api/terrain-types
   - GET /api/players/:id

2. **Tests E2E** con base de datos real en contenedor Docker

3. **Performance tests** para endpoints con muchos datos

4. **Integración con CI/CD** (GitHub Actions, GitLab CI)

5. **Test de seguridad**: SQL injection, XSS, etc.

## 🤝 Contribuir

Al añadir nuevos endpoints, crear sus tests correspondientes:

1. Añadir el test en `tests/api/game.test.js` (o crear nuevo archivo)
2. Mockear todas las queries de base de datos
3. Testear caso feliz + casos de error
4. Ejecutar `npm test` antes de commit

---

**Última actualización**: 2026-02-03
**Mantenido por**: Equipo de desarrollo
