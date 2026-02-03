# Reglas del Proyecto: Mediev-H3

## 1. Organización de Carpetas
- `/client`: Aplicación frontend (Vue/Vite).
- `/server`: Aplicación backend (Node.js/Express).
- `/sql`: Scripts de base de datos incrementales.
- `/tools`: Aplicaciones auxiliares (conversores, scripts de limpieza, etc.).

## 2. Idioma y Nomenclatura
- **CÓDIGO (Inglés):** Variables, funciones, tablas de BBDD, columnas y comentarios técnicos deben estar en **INGLÉS**.
  - Ej: `calculate_gold`, `fetch_settlements`, `player_id`.
- **MENSAJES (Español):** Textos de UI, logs visibles, respuestas de API y mensajes de error para el usuario deben estar en **ESPAÑOL**.
  - Ej: "Oro insuficiente", "Turno completado", "Error al conectar".

## 3. Base de Datos (SQL)
- **SEGURIDAD:** NO usar `DROP TABLE` en migraciones. Usar `ALTER TABLE` o `CREATE IF NOT EXISTS` para proteger datos.
- Los scripts deben ser incrementales en `/sql/`.
- Nomenclatura de archivos: `XXX_description.sql`.
- Usar `BIGINT` para índices H3.

## 4. Privacidad y Seguridad
- **NO LEER SECRETOS:** JAMÁS leas ni pidas el contenido de archivos de configuración real (`.env`, `config.php`).
- **SIMULACIÓN:** Usa siempre credenciales ficticias (ej: `'DB_PASS'`, `'fake_secret'`) en el código generado. Usa `.env.example` para referencia de estructura.

## 5. Ejecución y Bugs
- **EJECUCIÓN:** NO ejecutes scripts de servidor ni comandos SQL complejos automáticamente (especialmente mutaciones). Genera el código completo para revisión y ejecución manual por el usuario.
- **BUGS:** Céntrate en la lógica (PHP/JS/HTML/Python). Ignora CSS e imágenes a menos que sea un problema específicamente visual del mapa.