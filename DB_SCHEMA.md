# Mapeo de Base de Datos - Antigravity

## Tabla: unit_types
- unit_type_id (SERIAL PK)
- name (VARCHAR)
- attack (INT)
- health_points (INT)
- speed (INT)
- detection_range (INT)
- gold_upkeep (DECIMAL 10,2)
- food_consumption (DECIMAL 10,2)
- is_siege (BOOLEAN)
- descrip (TEXT)

## Tabla: armies
- army_id (SERIAL PK)
- name VARCHAR(100) 
- player_id (INT)
- h3_index (VARCHAR 15) <- Usar siempre para localización
- name (TEXT)
- gold_provisions, food_provisions, wood_provisions, etc. (DECIMAL 12,2)
- rest_level (DECIMAL 5,2) 0 a 100, al llegar a 0 se detiene. Si en un turno no se mueves, está descansando y recupera.
- created_at (TIMESTAMP)
- destination (VARCHAR 16)
- recovering (INT)
- movement_points (DECIMAL 5,2)

## Tabla: territory_details
- h3_index (VARCHAR 15 PK) <- ¡OJO! No tiene columna 'id'
- wood_stored, iron_stored, stone_stored, food_stored (INT)
- discovered_resource (VARCHAR)
- grace_turns (INT)
- division_id (INT FK -> political_divisions.id) - Pertenece a una división política (opcional)

## Tabla: terrain_types
- terrain_type_id (SERIAL PK)
- name (VARCHAR 50)
- color (VARCHAR 7)
- food_output, wood_output, stone_output, iron_output, fishing_output (INT)
- defense_bonus (INT)
- movement_cost (DECIMAL 5,2 DEFAULT 1.0) ← usado por executeArmyTurn; -1 = impasable (Mar)
  - Valores típicos: Mar=-1, Costa=1, Río=1.5, Bosque=2, Colinas=2, Pantano=3, Alta Montaña=5

## Tabla: unit_requirements
- id (SERIAL PK)
- unit_type_id (INT FK -> unit_types.unit_type_id)
- resource_type VARCHAR(20),
- amount INT NOT NULL

## Tabla: unit_terrain_modifiers 
- troop_id (SERIAL PK)
- unit_type_id (INT FK -> unit_types.unit_type_id)
- terrain_type VARCHAR(30)
- attack_modificator (DECIMAL 3,2)
- defense_modificator (DECIMAL 3,2)
- speed_modificator (INT)
- stamina_drain_modificator (DECIMAL 3,2)

## Tabla: unit_combat_counters 
- id (SERIAL PK)
- attacker_type_id (INT FK -> unit_types.unit_type_id)
- defender_type_id (INT FK -> unit_types.unit_type_id)
- damage_multiplier (DECIMAL 3,2)

## Tabla: troops 
- troop_id (SERIAL PK)
- army_id (INT FK -> armies.army_id)
- unit_type_id (INT FK -> unit_types.unit_type_id)
- quantity (INT)
- experience (DECIMAL 5,2)
- morale (DECIMAL 5,2)
- last_fed_turn (INT)
- stamina (DECIMAL 5,2)
- force_rest (BOOLEAN)

## Tabla: world_state
- id (SERIAL PK)
- current_turn (INT)
- game_date (DATE)
- is_paused (BOOLEAN)
- last_updated (TIMESTAMP)
- days_per_year (INT)

## Tabla: army_routes
- army_id (INT PK FK -> armies.army_id ON DELETE CASCADE)
- path (JSONB NOT NULL) — Array ordenado de índices H3 que forman la ruta, excluyendo la posición actual. Ej: ["88392...", "88392..."]
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
- Generada por ArmySimulationService.calculateAndSaveRoute() con algoritmo A*
- Leída y actualizada cada turno por executeArmyTurn() (elimina hexágonos visitados)
- Se elimina cuando el ejército llega al destino (path vacío)

## Tabla: game_config
- id (SERIAL PK)
- group (VARCHAR 50)
- KEY (VARCHAR 50)
- value (VARCHAR 255)

## Tabla: notifications 
- id (SERIAL PK)
- player_id (INT FK -> players.player_id)
- turn_number (INT)
- type (VARCHAR 50)
- content (TEXT)
- is_read (BOOLEAN)
- created_at (TIMESTAMP)

## Tabla: army_routes
- army_id (SERIAL PK)
- path (jsonb)
- created_at (timestamp)
- updated_at (timestamp)

## Tabla: building_types
- building_type_id (SERIAL PK)
- name (VARCHAR 50) - 'military', 'religious', 'economic', 'other'
- icon_slug (VARCHAR 50) - Identificador para iconos en la interfaz

## Tabla: buildings
- id (SERIAL PK)
- name (VARCHAR 100)
- type_id (INT FK -> building_types.building_type_id)
- gold_cost (INT) - Coste para iniciar construcción
- construction_time_turns (INT) - Turnos totales para completarse
- required_building_id (INT NULL FK -> buildings.id) - Pre-requisito tecnológico
- food_bonus (INT) - Sustituye a la antigua columna 'delta_alim'
- description (TEXT)

## Tabla: fief_buildings
- h3_index (VARCHAR 15 PK FK -> h3_map.h3_index) - Un edificio por cada índice H3
- building_id (INT FK -> buildings.id)
- remaining_construction_turns (INT) - Contador regresivo de obra
- is_under_construction (BOOLEAN) - True mientras se construye
- created_at (TIMESTAMP)

## Tabla: workers_types
- worker_type_id (SERIAL PK)
- name (VARCHAR 50) - Ej: 'constructor', 'scout'
- hp (INT)
- speed (INT)
- detection_range (INT)
- cost (INT)

## Tabla: workers
- worker_id (SERIAL PK)
- player_id (INT FK -> players.player_id)
- h3_index (VARCHAR 15)
- type_id (INT FK -> workers_types.worker_type_id)
- current_hp (INT) - HP actual (permite daño/curación)
- speed (INT)
- detection_range (INT)
- created_at (TIMESTAMP)

## Tabla: active_constructions
- h3_index (VARCHAR 15 PK)
- type (VARCHAR 20) - Ej: 'BRIDGE'
- progress_turns (INT)
- total_turns (INT)
- player_id (INT FK -> players.player_id)

## Tabla: bridges
- h3_index (VARCHAR 15 PK)
- constructed_at (TIMESTAMP)

## Tabla: noble_ranks
- id (SERIAL PK)
- title_male (VARCHAR 50)
- title_female (VARCHAR 50)
- territory_name (VARCHAR 100)
- min_fiefs_required (INT)
- level_order (INT)
- required_parent_rank_id (INT, FK -> noble_ranks.id) - ID del rango inferior necesario para ascender
- required_count (INT) - Cantidad de divisiones del rango inferior necesarias

## Tabla: political_divisions
- id (SERIAL PK)
- player_id (INT FK -> players.player_id)
- name (VARCHAR 100)
- noble_rank_id (INT FK -> noble_ranks.id)
- capital_territory_id (INT FK -> territory_details.id)
- boundary_geojson (JSONB) - Polígono en formato GeoJSON que representa el borde exterior del dominio para renderizado eficiente en mapa.
- created_at (TIMESTAMP)

## Tabla: players
- player_id (SERIAL PK)
- username (VARCHAR 50)
- color (VARCHAR 7)
- gold (INT)
- created_at (TIMESTAMP)
- role (VARCHAR 20)
- password (VARCHAR 255)
- capital_h3 (VARCHAR 20)
- display_name (VARCHAR 50)
- is_exiled (BOOLEAN)
- is_ai (BOOLEAN)
- ai_profile (VARCHAR 50)
- deleted (BOOLEAN)
- tax_percentage (NUMERIC 5, 2)
- tithe_active (BOOLEAN)
- is_initialized (BOOLEAN)
- first_name (VARCHAR 100)
- last_name (VARCHAR 100)
- gender (CHAR 1)
- noble_rank_id (INT FK -> noble_ranks.id)

