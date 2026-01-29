# Reglas del Proyecto: Mediev-H3

## 1. Organización de Carpetas
- `/client`: Aplicación frontend (Vue/Vite).
- `/server`: Aplicación backend (Node.js/Express).
- `/sql`: Scripts de base de datos incrementales.
- `/tools`: Aplicaciones auxiliares (conversores, scripts de limpieza, etc.).

## 2. Idioma y Nomenclatura
- **Código y Scripts:** Todo el código (variables, funciones, clases, comentarios) debe estar en **Inglés**.
- **Contenido y Datos:** Los nombres de las cosas (terrenos, unidades, nombres de tablas de negocio) deben estar en **Español**.
- Ejemplo: `const forestTerrain = await db.select().from('terrenos').where({ nombre: 'Espesuras' });`

## 3. Base de Datos (SQL)
- Los scripts deben ser incrementales en `/sql/`.
- Nomenclatura: `XXX_description.sql`.
- **IMPORTANTE:** Tablas, columnas, comentarios SQL y nombres de archivos deben estar en **Inglés**.
- **CONTENIDO:** Solo los datos de las filas (values) que el usuario final leerá en la interfaz irán en **Español**.
- Usar `BIGINT` para índices H3.

## 4. Privacidad y Seguridad
- **REGLA DE PRIVACIDAD:** No accedas ni leas archivos que contengan contraseñas reales (como `.env` o `config.php`). Usa siempre archivos `.env.example`.
- **REGLA DE BUGS:** Para depuración, céntrate en la lógica de código (Node.js/TypeScript) y estructura HTML. No es necesario procesar CSS o binarios a menos que se pida expresamente.