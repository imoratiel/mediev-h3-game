-- =============================================================
-- 085_terrain_modifiers_and_counters.sql
-- Modificadores de terreno y matriz de counters para las 32
-- unidades del juego (4 culturas × 8 tipos de unidad).
--
-- MODIFICADORES DE TERRENO — attack/defense_modificator son deltas:
--   +0.20 → ×1.20   (CombatService: terrainMod = 1 + modificator)
--   -0.30 → ×0.70
--
-- COUNTERS — damage_multiplier aplicado al daño del atacante
--   cuando afronta ese tipo de unidad defensora.
-- =============================================================

DELETE FROM unit_terrain_modifiers;
DELETE FROM unit_combat_counters;

-- =============================================================
-- PARTE 1 — MODIFICADORES DE TERRENO
-- =============================================================

-- ── CAVALRY_1 ─────────────────────────────────────────────────
-- Equites · Caballería Numida · Jinetes con Lanza
-- Caballería Exploración
-- Máxima efectividad en llanura; muy penalizados en bosque,
-- montaña y pantanos.
INSERT INTO unit_terrain_modifiers (unit_type_id, terrain_type, attack_modificator, defense_modificator) VALUES
  -- Equites
  ((SELECT unit_type_id FROM unit_types WHERE name='Equites'), 'Tierras de Cultivo',  0.20,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Equites'), 'Tierras de Secano',   0.20,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Equites'), 'Estepas',             0.20,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Equites'), 'Pantanos',           -0.25, -0.15),
  ((SELECT unit_type_id FROM unit_types WHERE name='Equites'), 'Bosque',             -0.20, -0.10),
  ((SELECT unit_type_id FROM unit_types WHERE name='Equites'), 'Espesuras',          -0.35, -0.20),
  ((SELECT unit_type_id FROM unit_types WHERE name='Equites'), 'Cerros',             -0.10,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Equites'), 'Colinas',            -0.10,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Equites'), 'Alta Montaña',       -0.30, -0.20),
  ((SELECT unit_type_id FROM unit_types WHERE name='Equites'), 'Asentamiento',       -0.10, -0.10),
  -- Caballería Numida
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Numida'), 'Tierras de Cultivo',  0.20,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Numida'), 'Tierras de Secano',   0.20,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Numida'), 'Estepas',             0.20,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Numida'), 'Pantanos',           -0.25, -0.15),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Numida'), 'Bosque',             -0.20, -0.10),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Numida'), 'Espesuras',          -0.35, -0.20),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Numida'), 'Cerros',             -0.10,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Numida'), 'Colinas',            -0.10,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Numida'), 'Alta Montaña',       -0.30, -0.20),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Numida'), 'Asentamiento',       -0.10, -0.10),
  -- Jinetes con Lanza
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes con Lanza'), 'Tierras de Cultivo',  0.20,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes con Lanza'), 'Tierras de Secano',   0.20,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes con Lanza'), 'Estepas',             0.20,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes con Lanza'), 'Pantanos',           -0.25, -0.15),
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes con Lanza'), 'Bosque',             -0.20, -0.10),
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes con Lanza'), 'Espesuras',          -0.35, -0.20),
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes con Lanza'), 'Cerros',             -0.10,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes con Lanza'), 'Colinas',            -0.10,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes con Lanza'), 'Alta Montaña',       -0.30, -0.20),
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes con Lanza'), 'Asentamiento',       -0.10, -0.10),
  -- Caballería Exploración
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Exploración'), 'Tierras de Cultivo',  0.20,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Exploración'), 'Tierras de Secano',   0.20,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Exploración'), 'Estepas',             0.20,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Exploración'), 'Pantanos',           -0.25, -0.15),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Exploración'), 'Bosque',             -0.20, -0.10),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Exploración'), 'Espesuras',          -0.35, -0.20),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Exploración'), 'Cerros',             -0.10,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Exploración'), 'Colinas',            -0.10,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Exploración'), 'Alta Montaña',       -0.30, -0.20),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Exploración'), 'Asentamiento',       -0.10, -0.10);

-- ── CAVALRY_2 ─────────────────────────────────────────────────
-- Auxilia · Caballería Hispana · Jinetes de Élite · Nobles a Caballo
-- Carga devastadora en campo abierto; sufren más que CAVALRY_1
-- en terreno cerrado por ser más pesados.
INSERT INTO unit_terrain_modifiers (unit_type_id, terrain_type, attack_modificator, defense_modificator) VALUES
  -- Auxilia
  ((SELECT unit_type_id FROM unit_types WHERE name='Auxilia'), 'Tierras de Cultivo',  0.30,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Auxilia'), 'Tierras de Secano',   0.30,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Auxilia'), 'Estepas',             0.30,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Auxilia'), 'Pantanos',           -0.35, -0.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Auxilia'), 'Bosque',             -0.30, -0.25),
  ((SELECT unit_type_id FROM unit_types WHERE name='Auxilia'), 'Espesuras',          -0.50, -0.40),
  ((SELECT unit_type_id FROM unit_types WHERE name='Auxilia'), 'Cerros',             -0.15, -0.10),
  ((SELECT unit_type_id FROM unit_types WHERE name='Auxilia'), 'Colinas',            -0.15, -0.10),
  ((SELECT unit_type_id FROM unit_types WHERE name='Auxilia'), 'Alta Montaña',       -0.40, -0.35),
  ((SELECT unit_type_id FROM unit_types WHERE name='Auxilia'), 'Asentamiento',       -0.15, -0.10),
  -- Caballería Hispana
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Hispana'), 'Tierras de Cultivo',  0.30,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Hispana'), 'Tierras de Secano',   0.30,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Hispana'), 'Estepas',             0.30,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Hispana'), 'Pantanos',           -0.35, -0.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Hispana'), 'Bosque',             -0.30, -0.25),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Hispana'), 'Espesuras',          -0.50, -0.40),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Hispana'), 'Cerros',             -0.15, -0.10),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Hispana'), 'Colinas',            -0.15, -0.10),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Hispana'), 'Alta Montaña',       -0.40, -0.35),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Hispana'), 'Asentamiento',       -0.15, -0.10),
  -- Jinetes de Élite
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes de Élite'), 'Tierras de Cultivo',  0.30,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes de Élite'), 'Tierras de Secano',   0.30,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes de Élite'), 'Estepas',             0.30,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes de Élite'), 'Pantanos',           -0.35, -0.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes de Élite'), 'Bosque',             -0.30, -0.25),
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes de Élite'), 'Espesuras',          -0.50, -0.40),
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes de Élite'), 'Cerros',             -0.15, -0.10),
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes de Élite'), 'Colinas',            -0.15, -0.10),
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes de Élite'), 'Alta Montaña',       -0.40, -0.35),
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes de Élite'), 'Asentamiento',       -0.15, -0.10),
  -- Nobles a Caballo
  ((SELECT unit_type_id FROM unit_types WHERE name='Nobles a Caballo'), 'Tierras de Cultivo',  0.30,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Nobles a Caballo'), 'Tierras de Secano',   0.30,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Nobles a Caballo'), 'Estepas',             0.30,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Nobles a Caballo'), 'Pantanos',           -0.35, -0.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Nobles a Caballo'), 'Bosque',             -0.30, -0.25),
  ((SELECT unit_type_id FROM unit_types WHERE name='Nobles a Caballo'), 'Espesuras',          -0.50, -0.40),
  ((SELECT unit_type_id FROM unit_types WHERE name='Nobles a Caballo'), 'Cerros',             -0.15, -0.10),
  ((SELECT unit_type_id FROM unit_types WHERE name='Nobles a Caballo'), 'Colinas',            -0.15, -0.10),
  ((SELECT unit_type_id FROM unit_types WHERE name='Nobles a Caballo'), 'Alta Montaña',       -0.40, -0.35),
  ((SELECT unit_type_id FROM unit_types WHERE name='Nobles a Caballo'), 'Asentamiento',       -0.15, -0.10);

-- ── INFANTRY_1 (genérica) ──────────────────────────────────────
-- Hastati · Infantería Libia · Celtíberos
-- Infantería de línea: ligera mejora defensiva en cobertura.
INSERT INTO unit_terrain_modifiers (unit_type_id, terrain_type, attack_modificator, defense_modificator) VALUES
  ((SELECT unit_type_id FROM unit_types WHERE name='Hastati'),        'Bosque',       0.00,  0.10),
  ((SELECT unit_type_id FROM unit_types WHERE name='Hastati'),        'Espesuras',    0.00,  0.15),
  ((SELECT unit_type_id FROM unit_types WHERE name='Hastati'),        'Alta Montaña', 0.00,  0.10),
  ((SELECT unit_type_id FROM unit_types WHERE name='Infantería Libia'),'Bosque',       0.00,  0.10),
  ((SELECT unit_type_id FROM unit_types WHERE name='Infantería Libia'),'Espesuras',    0.00,  0.15),
  ((SELECT unit_type_id FROM unit_types WHERE name='Infantería Libia'),'Alta Montaña', 0.00,  0.10),
  ((SELECT unit_type_id FROM unit_types WHERE name='Celtíberos'),     'Bosque',       0.00,  0.10),
  ((SELECT unit_type_id FROM unit_types WHERE name='Celtíberos'),     'Espesuras',    0.00,  0.15),
  ((SELECT unit_type_id FROM unit_types WHERE name='Celtíberos'),     'Alta Montaña', 0.00,  0.10);

-- ── INFANTRY_1 Caetrati (excepción guerrilla) ──────────────────
-- Guerreros de escaramuza; el bosque es su hogar natural.
INSERT INTO unit_terrain_modifiers (unit_type_id, terrain_type, attack_modificator, defense_modificator) VALUES
  ((SELECT unit_type_id FROM unit_types WHERE name='Caetrati'), 'Bosque',       0.00,  0.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caetrati'), 'Espesuras',    0.00,  0.40),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caetrati'), 'Alta Montaña', 0.00,  0.20);

-- ── INFANTRY_2 defensiva ───────────────────────────────────────
-- Triarii · Lanceros del Norte
-- Infantería de muro de escudos/picas: posiciones elevadas
-- y asentamientos amplifican su capacidad defensiva.
INSERT INTO unit_terrain_modifiers (unit_type_id, terrain_type, attack_modificator, defense_modificator) VALUES
  ((SELECT unit_type_id FROM unit_types WHERE name='Triarii'),          'Cerros',       0.00,  0.20),
  ((SELECT unit_type_id FROM unit_types WHERE name='Triarii'),          'Colinas',      0.00,  0.15),
  ((SELECT unit_type_id FROM unit_types WHERE name='Triarii'),          'Alta Montaña', 0.00,  0.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Triarii'),          'Asentamiento', 0.00,  0.20),
  ((SELECT unit_type_id FROM unit_types WHERE name='Triarii'),          'Pantanos',    -0.10,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Lanceros del Norte'),'Cerros',       0.00,  0.20),
  ((SELECT unit_type_id FROM unit_types WHERE name='Lanceros del Norte'),'Colinas',      0.00,  0.15),
  ((SELECT unit_type_id FROM unit_types WHERE name='Lanceros del Norte'),'Alta Montaña', 0.00,  0.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Lanceros del Norte'),'Asentamiento', 0.00,  0.20),
  ((SELECT unit_type_id FROM unit_types WHERE name='Lanceros del Norte'),'Pantanos',    -0.10,  0.00);

-- ── INFANTRY_2 ofensiva ────────────────────────────────────────
-- Mercenarios Galos · Scutarii · Lanzahachas
-- Prefieren campo abierto para la carga; penalizados en terreno
-- que frena su impulso.
INSERT INTO unit_terrain_modifiers (unit_type_id, terrain_type, attack_modificator, defense_modificator) VALUES
  ((SELECT unit_type_id FROM unit_types WHERE name='Mercenarios Galos'), 'Tierras de Cultivo',  0.10,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Mercenarios Galos'), 'Tierras de Secano',   0.10,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Mercenarios Galos'), 'Estepas',             0.10,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Mercenarios Galos'), 'Alta Montaña',       -0.10,  0.10),
  ((SELECT unit_type_id FROM unit_types WHERE name='Mercenarios Galos'), 'Pantanos',           -0.15,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Scutarii'),          'Tierras de Cultivo',  0.10,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Scutarii'),          'Tierras de Secano',   0.10,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Scutarii'),          'Estepas',             0.10,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Scutarii'),          'Alta Montaña',       -0.10,  0.10),
  ((SELECT unit_type_id FROM unit_types WHERE name='Scutarii'),          'Pantanos',           -0.15,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Lanzahachas'),       'Tierras de Cultivo',  0.10,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Lanzahachas'),       'Tierras de Secano',   0.10,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Lanzahachas'),       'Estepas',             0.10,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Lanzahachas'),       'Alta Montaña',       -0.10,  0.10),
  ((SELECT unit_type_id FROM unit_types WHERE name='Lanzahachas'),       'Pantanos',           -0.15,  0.00);

-- ── ARCHER_1 (genérica) ────────────────────────────────────────
-- Velites · Honderos Baleares · Falarica
-- Terreno elevado o cubierto multiplica su efectividad;
-- la estepa abierta los deja expuestos.
INSERT INTO unit_terrain_modifiers (unit_type_id, terrain_type, attack_modificator, defense_modificator) VALUES
  ((SELECT unit_type_id FROM unit_types WHERE name='Velites'),          'Bosque',        0.00,  0.50),
  ((SELECT unit_type_id FROM unit_types WHERE name='Velites'),          'Espesuras',    -0.10,  0.60),
  ((SELECT unit_type_id FROM unit_types WHERE name='Velites'),          'Cerros',        0.15,  0.20),
  ((SELECT unit_type_id FROM unit_types WHERE name='Velites'),          'Colinas',       0.10,  0.20),
  ((SELECT unit_type_id FROM unit_types WHERE name='Velites'),          'Alta Montaña',  0.20,  0.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Velites'),          'Asentamiento',  0.00,  0.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Velites'),          'Estepas',       0.00, -0.10),
  ((SELECT unit_type_id FROM unit_types WHERE name='Honderos Baleares'),'Bosque',        0.00,  0.50),
  ((SELECT unit_type_id FROM unit_types WHERE name='Honderos Baleares'),'Espesuras',    -0.10,  0.60),
  ((SELECT unit_type_id FROM unit_types WHERE name='Honderos Baleares'),'Cerros',        0.15,  0.20),
  ((SELECT unit_type_id FROM unit_types WHERE name='Honderos Baleares'),'Colinas',       0.10,  0.20),
  ((SELECT unit_type_id FROM unit_types WHERE name='Honderos Baleares'),'Alta Montaña',  0.20,  0.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Honderos Baleares'),'Asentamiento',  0.00,  0.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Honderos Baleares'),'Estepas',       0.00, -0.10),
  ((SELECT unit_type_id FROM unit_types WHERE name='Falarica'),         'Bosque',        0.00,  0.50),
  ((SELECT unit_type_id FROM unit_types WHERE name='Falarica'),         'Espesuras',    -0.10,  0.60),
  ((SELECT unit_type_id FROM unit_types WHERE name='Falarica'),         'Cerros',        0.15,  0.20),
  ((SELECT unit_type_id FROM unit_types WHERE name='Falarica'),         'Colinas',       0.10,  0.20),
  ((SELECT unit_type_id FROM unit_types WHERE name='Falarica'),         'Alta Montaña',  0.20,  0.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Falarica'),         'Asentamiento',  0.00,  0.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Falarica'),         'Estepas',       0.00, -0.10);

-- ── ARCHER_1 Cazadores (excepción sigilo en bosque) ────────────
-- Obtienen bono de ataque en bosque que los hostigadores genéricos
-- no tienen; el bosque es su ambiente natural.
INSERT INTO unit_terrain_modifiers (unit_type_id, terrain_type, attack_modificator, defense_modificator) VALUES
  ((SELECT unit_type_id FROM unit_types WHERE name='Cazadores'), 'Bosque',       0.20,  0.60),
  ((SELECT unit_type_id FROM unit_types WHERE name='Cazadores'), 'Espesuras',    0.25,  0.70),
  ((SELECT unit_type_id FROM unit_types WHERE name='Cazadores'), 'Cerros',       0.15,  0.20),
  ((SELECT unit_type_id FROM unit_types WHERE name='Cazadores'), 'Colinas',      0.10,  0.20),
  ((SELECT unit_type_id FROM unit_types WHERE name='Cazadores'), 'Alta Montaña', 0.20,  0.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Cazadores'), 'Asentamiento', 0.00,  0.30);

-- ── ARCHER_2 ───────────────────────────────────────────────────
-- Sagitarii · Arqueros Fenicios · Honderos (Íberos)
-- Idéntica lógica que ARCHER_1 con bonos ligeramente superiores
-- por mayor entrenamiento.
INSERT INTO unit_terrain_modifiers (unit_type_id, terrain_type, attack_modificator, defense_modificator) VALUES
  ((SELECT unit_type_id FROM unit_types WHERE name='Sagitarii'),         'Bosque',        0.00,  0.55),
  ((SELECT unit_type_id FROM unit_types WHERE name='Sagitarii'),         'Espesuras',    -0.10,  0.65),
  ((SELECT unit_type_id FROM unit_types WHERE name='Sagitarii'),         'Cerros',        0.15,  0.25),
  ((SELECT unit_type_id FROM unit_types WHERE name='Sagitarii'),         'Colinas',       0.10,  0.25),
  ((SELECT unit_type_id FROM unit_types WHERE name='Sagitarii'),         'Alta Montaña',  0.20,  0.35),
  ((SELECT unit_type_id FROM unit_types WHERE name='Sagitarii'),         'Asentamiento',  0.00,  0.35),
  ((SELECT unit_type_id FROM unit_types WHERE name='Sagitarii'),         'Estepas',       0.00, -0.15),
  ((SELECT unit_type_id FROM unit_types WHERE name='Arqueros Fenicios'), 'Bosque',        0.00,  0.55),
  ((SELECT unit_type_id FROM unit_types WHERE name='Arqueros Fenicios'), 'Espesuras',    -0.10,  0.65),
  ((SELECT unit_type_id FROM unit_types WHERE name='Arqueros Fenicios'), 'Cerros',        0.15,  0.25),
  ((SELECT unit_type_id FROM unit_types WHERE name='Arqueros Fenicios'), 'Colinas',       0.10,  0.25),
  ((SELECT unit_type_id FROM unit_types WHERE name='Arqueros Fenicios'), 'Alta Montaña',  0.20,  0.35),
  ((SELECT unit_type_id FROM unit_types WHERE name='Arqueros Fenicios'), 'Asentamiento',  0.00,  0.35),
  ((SELECT unit_type_id FROM unit_types WHERE name='Arqueros Fenicios'), 'Estepas',       0.00, -0.15),
  ((SELECT unit_type_id FROM unit_types WHERE name='Honderos'),          'Bosque',        0.00,  0.55),
  ((SELECT unit_type_id FROM unit_types WHERE name='Honderos'),          'Espesuras',    -0.10,  0.65),
  ((SELECT unit_type_id FROM unit_types WHERE name='Honderos'),          'Cerros',        0.15,  0.25),
  ((SELECT unit_type_id FROM unit_types WHERE name='Honderos'),          'Colinas',       0.10,  0.25),
  ((SELECT unit_type_id FROM unit_types WHERE name='Honderos'),          'Alta Montaña',  0.20,  0.35),
  ((SELECT unit_type_id FROM unit_types WHERE name='Honderos'),          'Asentamiento',  0.00,  0.35),
  ((SELECT unit_type_id FROM unit_types WHERE name='Honderos'),          'Estepas',       0.00, -0.15);

-- ── INFANTRY_ELITE individuales ────────────────────────────────

-- Pretorianos: guardia disciplinada, neutral en casi todo.
INSERT INTO unit_terrain_modifiers (unit_type_id, terrain_type, attack_modificator, defense_modificator) VALUES
  ((SELECT unit_type_id FROM unit_types WHERE name='Pretorianos'), 'Alta Montaña', 0.00,  0.10),
  ((SELECT unit_type_id FROM unit_types WHERE name='Pretorianos'), 'Asentamiento', 0.00,  0.15);

-- Elefantes: devastadores en campo abierto; bosques y pantanos
-- los inutilizan casi por completo.
INSERT INTO unit_terrain_modifiers (unit_type_id, terrain_type, attack_modificator, defense_modificator) VALUES
  ((SELECT unit_type_id FROM unit_types WHERE name='Elefantes'), 'Tierras de Cultivo',  0.10,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Elefantes'), 'Tierras de Secano',   0.10,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Elefantes'), 'Estepas',             0.10,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Elefantes'), 'Bosque',             -0.40, -0.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Elefantes'), 'Espesuras',          -0.50, -0.40),
  ((SELECT unit_type_id FROM unit_types WHERE name='Elefantes'), 'Alta Montaña',       -0.20, -0.20),
  ((SELECT unit_type_id FROM unit_types WHERE name='Elefantes'), 'Pantanos',           -0.30, -0.20),
  ((SELECT unit_type_id FROM unit_types WHERE name='Elefantes'), 'Asentamiento',       -0.25, -0.20);

-- Devotio: fanáticos sagrados, rendimiento constante
-- en cualquier terreno. Sin modificadores.

-- Carros: requieren espacio abierto; completamente inutilizados
-- en bosques, montañas y ciudades.
INSERT INTO unit_terrain_modifiers (unit_type_id, terrain_type, attack_modificator, defense_modificator) VALUES
  ((SELECT unit_type_id FROM unit_types WHERE name='Carros'), 'Tierras de Cultivo',  0.25,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Carros'), 'Tierras de Secano',   0.25,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Carros'), 'Estepas',             0.25,  0.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Carros'), 'Bosque',             -0.40, -0.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Carros'), 'Espesuras',          -0.50, -0.40),
  ((SELECT unit_type_id FROM unit_types WHERE name='Carros'), 'Alta Montaña',       -0.40, -0.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Carros'), 'Pantanos',           -0.35, -0.25),
  ((SELECT unit_type_id FROM unit_types WHERE name='Carros'), 'Asentamiento',       -0.30, -0.20);

-- =============================================================
-- PARTE 2 — CONTADORES DE COMBATE
-- =============================================================

-- ── A: PICAS / INFANTERÍA DEFENSIVA contra CABALLERÍA ─────────
-- El counter clásico: picas largas que detienen la carga.
INSERT INTO unit_combat_counters (attacker_type_id, defender_type_id, damage_multiplier) VALUES
  -- Lanceros del Norte vs CAVALRY_1 (2.50×)
  ((SELECT unit_type_id FROM unit_types WHERE name='Lanceros del Norte'),(SELECT unit_type_id FROM unit_types WHERE name='Equites'),              2.50),
  ((SELECT unit_type_id FROM unit_types WHERE name='Lanceros del Norte'),(SELECT unit_type_id FROM unit_types WHERE name='Caballería Numida'),    2.50),
  ((SELECT unit_type_id FROM unit_types WHERE name='Lanceros del Norte'),(SELECT unit_type_id FROM unit_types WHERE name='Jinetes con Lanza'),    2.50),
  ((SELECT unit_type_id FROM unit_types WHERE name='Lanceros del Norte'),(SELECT unit_type_id FROM unit_types WHERE name='Caballería Exploración'),2.50),
  -- Lanceros del Norte vs CAVALRY_2 (2.00×)
  ((SELECT unit_type_id FROM unit_types WHERE name='Lanceros del Norte'),(SELECT unit_type_id FROM unit_types WHERE name='Auxilia'),             2.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Lanceros del Norte'),(SELECT unit_type_id FROM unit_types WHERE name='Caballería Hispana'),  2.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Lanceros del Norte'),(SELECT unit_type_id FROM unit_types WHERE name='Jinetes de Élite'),    2.00),
  ((SELECT unit_type_id FROM unit_types WHERE name='Lanceros del Norte'),(SELECT unit_type_id FROM unit_types WHERE name='Nobles a Caballo'),    2.00),
  -- Triarii vs CAVALRY_1 (1.80×)
  ((SELECT unit_type_id FROM unit_types WHERE name='Triarii'),(SELECT unit_type_id FROM unit_types WHERE name='Equites'),              1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Triarii'),(SELECT unit_type_id FROM unit_types WHERE name='Caballería Numida'),    1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Triarii'),(SELECT unit_type_id FROM unit_types WHERE name='Jinetes con Lanza'),    1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Triarii'),(SELECT unit_type_id FROM unit_types WHERE name='Caballería Exploración'),1.80),
  -- Triarii vs CAVALRY_2 (1.50×)
  ((SELECT unit_type_id FROM unit_types WHERE name='Triarii'),(SELECT unit_type_id FROM unit_types WHERE name='Auxilia'),             1.50),
  ((SELECT unit_type_id FROM unit_types WHERE name='Triarii'),(SELECT unit_type_id FROM unit_types WHERE name='Caballería Hispana'),  1.50),
  ((SELECT unit_type_id FROM unit_types WHERE name='Triarii'),(SELECT unit_type_id FROM unit_types WHERE name='Jinetes de Élite'),    1.50),
  ((SELECT unit_type_id FROM unit_types WHERE name='Triarii'),(SELECT unit_type_id FROM unit_types WHERE name='Nobles a Caballo'),    1.50);

-- ── B: INFANTERÍA DE ESCUDO contra CABALLERÍA_1 ───────────────
INSERT INTO unit_combat_counters (attacker_type_id, defender_type_id, damage_multiplier) VALUES
  -- Scutarii vs CAVALRY_1 (1.50×) · vs CAVALRY_2 (1.30×)
  ((SELECT unit_type_id FROM unit_types WHERE name='Scutarii'),(SELECT unit_type_id FROM unit_types WHERE name='Equites'),              1.50),
  ((SELECT unit_type_id FROM unit_types WHERE name='Scutarii'),(SELECT unit_type_id FROM unit_types WHERE name='Caballería Numida'),    1.50),
  ((SELECT unit_type_id FROM unit_types WHERE name='Scutarii'),(SELECT unit_type_id FROM unit_types WHERE name='Jinetes con Lanza'),    1.50),
  ((SELECT unit_type_id FROM unit_types WHERE name='Scutarii'),(SELECT unit_type_id FROM unit_types WHERE name='Caballería Exploración'),1.50),
  ((SELECT unit_type_id FROM unit_types WHERE name='Scutarii'),(SELECT unit_type_id FROM unit_types WHERE name='Auxilia'),             1.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Scutarii'),(SELECT unit_type_id FROM unit_types WHERE name='Caballería Hispana'),  1.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Scutarii'),(SELECT unit_type_id FROM unit_types WHERE name='Jinetes de Élite'),    1.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Scutarii'),(SELECT unit_type_id FROM unit_types WHERE name='Nobles a Caballo'),    1.30),
  -- Infantería Libia vs CAVALRY_1 (1.40×)
  ((SELECT unit_type_id FROM unit_types WHERE name='Infantería Libia'),(SELECT unit_type_id FROM unit_types WHERE name='Equites'),              1.40),
  ((SELECT unit_type_id FROM unit_types WHERE name='Infantería Libia'),(SELECT unit_type_id FROM unit_types WHERE name='Caballería Numida'),    1.40),
  ((SELECT unit_type_id FROM unit_types WHERE name='Infantería Libia'),(SELECT unit_type_id FROM unit_types WHERE name='Jinetes con Lanza'),    1.40),
  ((SELECT unit_type_id FROM unit_types WHERE name='Infantería Libia'),(SELECT unit_type_id FROM unit_types WHERE name='Caballería Exploración'),1.40),
  -- Celtíberos vs CAVALRY_1 (1.40×)
  ((SELECT unit_type_id FROM unit_types WHERE name='Celtíberos'),(SELECT unit_type_id FROM unit_types WHERE name='Equites'),              1.40),
  ((SELECT unit_type_id FROM unit_types WHERE name='Celtíberos'),(SELECT unit_type_id FROM unit_types WHERE name='Caballería Numida'),    1.40),
  ((SELECT unit_type_id FROM unit_types WHERE name='Celtíberos'),(SELECT unit_type_id FROM unit_types WHERE name='Jinetes con Lanza'),    1.40),
  ((SELECT unit_type_id FROM unit_types WHERE name='Celtíberos'),(SELECT unit_type_id FROM unit_types WHERE name='Caballería Exploración'),1.40);

-- ── C: LANZAHACHAS contra INFANTERÍA_2 (rompe formaciones) ─────
INSERT INTO unit_combat_counters (attacker_type_id, defender_type_id, damage_multiplier) VALUES
  ((SELECT unit_type_id FROM unit_types WHERE name='Lanzahachas'),(SELECT unit_type_id FROM unit_types WHERE name='Triarii'),          1.40),
  ((SELECT unit_type_id FROM unit_types WHERE name='Lanzahachas'),(SELECT unit_type_id FROM unit_types WHERE name='Lanceros del Norte'),1.40),
  ((SELECT unit_type_id FROM unit_types WHERE name='Lanzahachas'),(SELECT unit_type_id FROM unit_types WHERE name='Mercenarios Galos'), 1.20),
  ((SELECT unit_type_id FROM unit_types WHERE name='Lanzahachas'),(SELECT unit_type_id FROM unit_types WHERE name='Scutarii'),          1.20);

-- ── D: CAVALRY_1 contra ARQUEROS ──────────────────────────────
-- Caballería ligera carga los flancos de arco antes de que disparen.
INSERT INTO unit_combat_counters (attacker_type_id, defender_type_id, damage_multiplier) VALUES
  -- vs ARCHER_1 (1.60×)
  ((SELECT unit_type_id FROM unit_types WHERE name='Equites'),(SELECT unit_type_id FROM unit_types WHERE name='Velites'),          1.60),
  ((SELECT unit_type_id FROM unit_types WHERE name='Equites'),(SELECT unit_type_id FROM unit_types WHERE name='Honderos Baleares'),1.60),
  ((SELECT unit_type_id FROM unit_types WHERE name='Equites'),(SELECT unit_type_id FROM unit_types WHERE name='Falarica'),         1.60),
  ((SELECT unit_type_id FROM unit_types WHERE name='Equites'),(SELECT unit_type_id FROM unit_types WHERE name='Cazadores'),        1.60),
  -- vs ARCHER_2 (1.40×)
  ((SELECT unit_type_id FROM unit_types WHERE name='Equites'),(SELECT unit_type_id FROM unit_types WHERE name='Sagitarii'),         1.40),
  ((SELECT unit_type_id FROM unit_types WHERE name='Equites'),(SELECT unit_type_id FROM unit_types WHERE name='Arqueros Fenicios'), 1.40),
  ((SELECT unit_type_id FROM unit_types WHERE name='Equites'),(SELECT unit_type_id FROM unit_types WHERE name='Honderos'),          1.40),
  -- Caballería Numida vs ARCHER_1
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Numida'),(SELECT unit_type_id FROM unit_types WHERE name='Velites'),          1.60),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Numida'),(SELECT unit_type_id FROM unit_types WHERE name='Honderos Baleares'),1.60),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Numida'),(SELECT unit_type_id FROM unit_types WHERE name='Falarica'),         1.60),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Numida'),(SELECT unit_type_id FROM unit_types WHERE name='Cazadores'),        1.60),
  -- Caballería Numida vs ARCHER_2
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Numida'),(SELECT unit_type_id FROM unit_types WHERE name='Sagitarii'),         1.40),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Numida'),(SELECT unit_type_id FROM unit_types WHERE name='Arqueros Fenicios'), 1.40),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Numida'),(SELECT unit_type_id FROM unit_types WHERE name='Honderos'),          1.40),
  -- Jinetes con Lanza vs ARCHER_1
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes con Lanza'),(SELECT unit_type_id FROM unit_types WHERE name='Velites'),          1.60),
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes con Lanza'),(SELECT unit_type_id FROM unit_types WHERE name='Honderos Baleares'),1.60),
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes con Lanza'),(SELECT unit_type_id FROM unit_types WHERE name='Falarica'),         1.60),
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes con Lanza'),(SELECT unit_type_id FROM unit_types WHERE name='Cazadores'),        1.60),
  -- Jinetes con Lanza vs ARCHER_2
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes con Lanza'),(SELECT unit_type_id FROM unit_types WHERE name='Sagitarii'),         1.40),
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes con Lanza'),(SELECT unit_type_id FROM unit_types WHERE name='Arqueros Fenicios'), 1.40),
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes con Lanza'),(SELECT unit_type_id FROM unit_types WHERE name='Honderos'),          1.40),
  -- Caballería Exploración vs ARCHER_1
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Exploración'),(SELECT unit_type_id FROM unit_types WHERE name='Velites'),          1.60),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Exploración'),(SELECT unit_type_id FROM unit_types WHERE name='Honderos Baleares'),1.60),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Exploración'),(SELECT unit_type_id FROM unit_types WHERE name='Falarica'),         1.60),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Exploración'),(SELECT unit_type_id FROM unit_types WHERE name='Cazadores'),        1.60),
  -- Caballería Exploración vs ARCHER_2
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Exploración'),(SELECT unit_type_id FROM unit_types WHERE name='Sagitarii'),         1.40),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Exploración'),(SELECT unit_type_id FROM unit_types WHERE name='Arqueros Fenicios'), 1.40),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Exploración'),(SELECT unit_type_id FROM unit_types WHERE name='Honderos'),          1.40);

-- ── E: CAVALRY_2 contra ARQUEROS ──────────────────────────────
-- Carga pesada: multiplier superior al de CAVALRY_1.
INSERT INTO unit_combat_counters (attacker_type_id, defender_type_id, damage_multiplier) VALUES
  -- Auxilia vs ARCHER_1 (1.80×) · vs ARCHER_2 (1.60×)
  ((SELECT unit_type_id FROM unit_types WHERE name='Auxilia'),(SELECT unit_type_id FROM unit_types WHERE name='Velites'),          1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Auxilia'),(SELECT unit_type_id FROM unit_types WHERE name='Honderos Baleares'),1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Auxilia'),(SELECT unit_type_id FROM unit_types WHERE name='Falarica'),         1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Auxilia'),(SELECT unit_type_id FROM unit_types WHERE name='Cazadores'),        1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Auxilia'),(SELECT unit_type_id FROM unit_types WHERE name='Sagitarii'),         1.60),
  ((SELECT unit_type_id FROM unit_types WHERE name='Auxilia'),(SELECT unit_type_id FROM unit_types WHERE name='Arqueros Fenicios'), 1.60),
  ((SELECT unit_type_id FROM unit_types WHERE name='Auxilia'),(SELECT unit_type_id FROM unit_types WHERE name='Honderos'),          1.60),
  -- Caballería Hispana
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Hispana'),(SELECT unit_type_id FROM unit_types WHERE name='Velites'),          1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Hispana'),(SELECT unit_type_id FROM unit_types WHERE name='Honderos Baleares'),1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Hispana'),(SELECT unit_type_id FROM unit_types WHERE name='Falarica'),         1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Hispana'),(SELECT unit_type_id FROM unit_types WHERE name='Cazadores'),        1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Hispana'),(SELECT unit_type_id FROM unit_types WHERE name='Sagitarii'),         1.60),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Hispana'),(SELECT unit_type_id FROM unit_types WHERE name='Arqueros Fenicios'), 1.60),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Hispana'),(SELECT unit_type_id FROM unit_types WHERE name='Honderos'),          1.60),
  -- Jinetes de Élite
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes de Élite'),(SELECT unit_type_id FROM unit_types WHERE name='Velites'),          1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes de Élite'),(SELECT unit_type_id FROM unit_types WHERE name='Honderos Baleares'),1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes de Élite'),(SELECT unit_type_id FROM unit_types WHERE name='Falarica'),         1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes de Élite'),(SELECT unit_type_id FROM unit_types WHERE name='Cazadores'),        1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes de Élite'),(SELECT unit_type_id FROM unit_types WHERE name='Sagitarii'),         1.60),
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes de Élite'),(SELECT unit_type_id FROM unit_types WHERE name='Arqueros Fenicios'), 1.60),
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes de Élite'),(SELECT unit_type_id FROM unit_types WHERE name='Honderos'),          1.60),
  -- Nobles a Caballo
  ((SELECT unit_type_id FROM unit_types WHERE name='Nobles a Caballo'),(SELECT unit_type_id FROM unit_types WHERE name='Velites'),          1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Nobles a Caballo'),(SELECT unit_type_id FROM unit_types WHERE name='Honderos Baleares'),1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Nobles a Caballo'),(SELECT unit_type_id FROM unit_types WHERE name='Falarica'),         1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Nobles a Caballo'),(SELECT unit_type_id FROM unit_types WHERE name='Cazadores'),        1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Nobles a Caballo'),(SELECT unit_type_id FROM unit_types WHERE name='Sagitarii'),         1.60),
  ((SELECT unit_type_id FROM unit_types WHERE name='Nobles a Caballo'),(SELECT unit_type_id FROM unit_types WHERE name='Arqueros Fenicios'), 1.60),
  ((SELECT unit_type_id FROM unit_types WHERE name='Nobles a Caballo'),(SELECT unit_type_id FROM unit_types WHERE name='Honderos'),          1.60);

-- ── F: ARCHER_1 contra INFANTRY_1 ─────────────────────────────
-- Hostigamiento: diezman infantería básica antes del choque.
INSERT INTO unit_combat_counters (attacker_type_id, defender_type_id, damage_multiplier) VALUES
  ((SELECT unit_type_id FROM unit_types WHERE name='Velites'),(SELECT unit_type_id FROM unit_types WHERE name='Hastati'),        1.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Velites'),(SELECT unit_type_id FROM unit_types WHERE name='Infantería Libia'),1.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Velites'),(SELECT unit_type_id FROM unit_types WHERE name='Caetrati'),        1.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Velites'),(SELECT unit_type_id FROM unit_types WHERE name='Celtíberos'),      1.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Honderos Baleares'),(SELECT unit_type_id FROM unit_types WHERE name='Hastati'),        1.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Honderos Baleares'),(SELECT unit_type_id FROM unit_types WHERE name='Infantería Libia'),1.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Honderos Baleares'),(SELECT unit_type_id FROM unit_types WHERE name='Caetrati'),        1.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Honderos Baleares'),(SELECT unit_type_id FROM unit_types WHERE name='Celtíberos'),      1.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Falarica'),(SELECT unit_type_id FROM unit_types WHERE name='Hastati'),        1.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Falarica'),(SELECT unit_type_id FROM unit_types WHERE name='Infantería Libia'),1.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Falarica'),(SELECT unit_type_id FROM unit_types WHERE name='Caetrati'),        1.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Falarica'),(SELECT unit_type_id FROM unit_types WHERE name='Celtíberos'),      1.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Cazadores'),(SELECT unit_type_id FROM unit_types WHERE name='Hastati'),        1.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Cazadores'),(SELECT unit_type_id FROM unit_types WHERE name='Infantería Libia'),1.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Cazadores'),(SELECT unit_type_id FROM unit_types WHERE name='Caetrati'),        1.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Cazadores'),(SELECT unit_type_id FROM unit_types WHERE name='Celtíberos'),      1.30);

-- ── G: ARCHER_2 contra INFANTRY_1 ─────────────────────────────
-- Mayor entrenamiento → mayor efectividad que ARCHER_1.
INSERT INTO unit_combat_counters (attacker_type_id, defender_type_id, damage_multiplier) VALUES
  ((SELECT unit_type_id FROM unit_types WHERE name='Sagitarii'),(SELECT unit_type_id FROM unit_types WHERE name='Hastati'),        1.40),
  ((SELECT unit_type_id FROM unit_types WHERE name='Sagitarii'),(SELECT unit_type_id FROM unit_types WHERE name='Infantería Libia'),1.40),
  ((SELECT unit_type_id FROM unit_types WHERE name='Sagitarii'),(SELECT unit_type_id FROM unit_types WHERE name='Caetrati'),        1.40),
  ((SELECT unit_type_id FROM unit_types WHERE name='Sagitarii'),(SELECT unit_type_id FROM unit_types WHERE name='Celtíberos'),      1.40),
  ((SELECT unit_type_id FROM unit_types WHERE name='Arqueros Fenicios'),(SELECT unit_type_id FROM unit_types WHERE name='Hastati'),        1.40),
  ((SELECT unit_type_id FROM unit_types WHERE name='Arqueros Fenicios'),(SELECT unit_type_id FROM unit_types WHERE name='Infantería Libia'),1.40),
  ((SELECT unit_type_id FROM unit_types WHERE name='Arqueros Fenicios'),(SELECT unit_type_id FROM unit_types WHERE name='Caetrati'),        1.40),
  ((SELECT unit_type_id FROM unit_types WHERE name='Arqueros Fenicios'),(SELECT unit_type_id FROM unit_types WHERE name='Celtíberos'),      1.40),
  ((SELECT unit_type_id FROM unit_types WHERE name='Honderos'),(SELECT unit_type_id FROM unit_types WHERE name='Hastati'),        1.40),
  ((SELECT unit_type_id FROM unit_types WHERE name='Honderos'),(SELECT unit_type_id FROM unit_types WHERE name='Infantería Libia'),1.40),
  ((SELECT unit_type_id FROM unit_types WHERE name='Honderos'),(SELECT unit_type_id FROM unit_types WHERE name='Caetrati'),        1.40),
  ((SELECT unit_type_id FROM unit_types WHERE name='Honderos'),(SELECT unit_type_id FROM unit_types WHERE name='Celtíberos'),      1.40);

-- ── H: HONDEROS BALEARES especial (penetración de armadura) ───
-- La honda ignora armadura; efectivos incluso contra élite.
INSERT INTO unit_combat_counters (attacker_type_id, defender_type_id, damage_multiplier) VALUES
  ((SELECT unit_type_id FROM unit_types WHERE name='Honderos Baleares'),(SELECT unit_type_id FROM unit_types WHERE name='Triarii'),          1.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Honderos Baleares'),(SELECT unit_type_id FROM unit_types WHERE name='Lanceros del Norte'),1.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Honderos Baleares'),(SELECT unit_type_id FROM unit_types WHERE name='Pretorianos'),       1.20),
  ((SELECT unit_type_id FROM unit_types WHERE name='Honderos Baleares'),(SELECT unit_type_id FROM unit_types WHERE name='Devotio'),           1.20);

-- ── I: ARCHER_2 contra INFANTRY_2 ofensiva ─────────────────────
-- Hostigamiento ligero contra unidades que no usan escudo.
INSERT INTO unit_combat_counters (attacker_type_id, defender_type_id, damage_multiplier) VALUES
  ((SELECT unit_type_id FROM unit_types WHERE name='Sagitarii'),(SELECT unit_type_id FROM unit_types WHERE name='Mercenarios Galos'),1.20),
  ((SELECT unit_type_id FROM unit_types WHERE name='Sagitarii'),(SELECT unit_type_id FROM unit_types WHERE name='Scutarii'),          1.20),
  ((SELECT unit_type_id FROM unit_types WHERE name='Sagitarii'),(SELECT unit_type_id FROM unit_types WHERE name='Lanzahachas'),       1.20),
  ((SELECT unit_type_id FROM unit_types WHERE name='Arqueros Fenicios'),(SELECT unit_type_id FROM unit_types WHERE name='Mercenarios Galos'),1.20),
  ((SELECT unit_type_id FROM unit_types WHERE name='Arqueros Fenicios'),(SELECT unit_type_id FROM unit_types WHERE name='Scutarii'),          1.20),
  ((SELECT unit_type_id FROM unit_types WHERE name='Arqueros Fenicios'),(SELECT unit_type_id FROM unit_types WHERE name='Lanzahachas'),       1.20);

-- ── J: COUNTERS DE ÉLITE ───────────────────────────────────────

-- Elefantes: pánico en formaciones de infantería y caballería.
INSERT INTO unit_combat_counters (attacker_type_id, defender_type_id, damage_multiplier) VALUES
  ((SELECT unit_type_id FROM unit_types WHERE name='Elefantes'),(SELECT unit_type_id FROM unit_types WHERE name='Hastati'),              1.60),
  ((SELECT unit_type_id FROM unit_types WHERE name='Elefantes'),(SELECT unit_type_id FROM unit_types WHERE name='Infantería Libia'),     1.60),
  ((SELECT unit_type_id FROM unit_types WHERE name='Elefantes'),(SELECT unit_type_id FROM unit_types WHERE name='Caetrati'),             1.60),
  ((SELECT unit_type_id FROM unit_types WHERE name='Elefantes'),(SELECT unit_type_id FROM unit_types WHERE name='Celtíberos'),           1.60),
  ((SELECT unit_type_id FROM unit_types WHERE name='Elefantes'),(SELECT unit_type_id FROM unit_types WHERE name='Equites'),              1.50),
  ((SELECT unit_type_id FROM unit_types WHERE name='Elefantes'),(SELECT unit_type_id FROM unit_types WHERE name='Caballería Numida'),    1.50),
  ((SELECT unit_type_id FROM unit_types WHERE name='Elefantes'),(SELECT unit_type_id FROM unit_types WHERE name='Jinetes con Lanza'),    1.50),
  ((SELECT unit_type_id FROM unit_types WHERE name='Elefantes'),(SELECT unit_type_id FROM unit_types WHERE name='Caballería Exploración'),1.50),
  ((SELECT unit_type_id FROM unit_types WHERE name='Elefantes'),(SELECT unit_type_id FROM unit_types WHERE name='Auxilia'),              1.40),
  ((SELECT unit_type_id FROM unit_types WHERE name='Elefantes'),(SELECT unit_type_id FROM unit_types WHERE name='Caballería Hispana'),   1.40),
  ((SELECT unit_type_id FROM unit_types WHERE name='Elefantes'),(SELECT unit_type_id FROM unit_types WHERE name='Jinetes de Élite'),     1.40),
  ((SELECT unit_type_id FROM unit_types WHERE name='Elefantes'),(SELECT unit_type_id FROM unit_types WHERE name='Nobles a Caballo'),     1.40);

-- INFANTRY_2 vs Elefantes: picas largas detienen la carga.
INSERT INTO unit_combat_counters (attacker_type_id, defender_type_id, damage_multiplier) VALUES
  ((SELECT unit_type_id FROM unit_types WHERE name='Triarii'),          (SELECT unit_type_id FROM unit_types WHERE name='Elefantes'), 1.50),
  ((SELECT unit_type_id FROM unit_types WHERE name='Lanceros del Norte'),(SELECT unit_type_id FROM unit_types WHERE name='Elefantes'), 1.50),
  ((SELECT unit_type_id FROM unit_types WHERE name='Mercenarios Galos'),(SELECT unit_type_id FROM unit_types WHERE name='Elefantes'), 1.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Scutarii'),         (SELECT unit_type_id FROM unit_types WHERE name='Elefantes'), 1.30);

-- Pretorianos: élite romana aplasta infantería básica y veterana.
INSERT INTO unit_combat_counters (attacker_type_id, defender_type_id, damage_multiplier) VALUES
  ((SELECT unit_type_id FROM unit_types WHERE name='Pretorianos'),(SELECT unit_type_id FROM unit_types WHERE name='Hastati'),        1.40),
  ((SELECT unit_type_id FROM unit_types WHERE name='Pretorianos'),(SELECT unit_type_id FROM unit_types WHERE name='Infantería Libia'),1.40),
  ((SELECT unit_type_id FROM unit_types WHERE name='Pretorianos'),(SELECT unit_type_id FROM unit_types WHERE name='Caetrati'),        1.40),
  ((SELECT unit_type_id FROM unit_types WHERE name='Pretorianos'),(SELECT unit_type_id FROM unit_types WHERE name='Celtíberos'),      1.40),
  ((SELECT unit_type_id FROM unit_types WHERE name='Pretorianos'),(SELECT unit_type_id FROM unit_types WHERE name='Triarii'),         1.20),
  ((SELECT unit_type_id FROM unit_types WHERE name='Pretorianos'),(SELECT unit_type_id FROM unit_types WHERE name='Lanceros del Norte'),1.20),
  ((SELECT unit_type_id FROM unit_types WHERE name='Pretorianos'),(SELECT unit_type_id FROM unit_types WHERE name='Mercenarios Galos'),1.20),
  ((SELECT unit_type_id FROM unit_types WHERE name='Pretorianos'),(SELECT unit_type_id FROM unit_types WHERE name='Scutarii'),         1.20),
  ((SELECT unit_type_id FROM unit_types WHERE name='Pretorianos'),(SELECT unit_type_id FROM unit_types WHERE name='Lanzahachas'),      1.20);

-- Devotio: guerreros sagrados contra infantería básica.
INSERT INTO unit_combat_counters (attacker_type_id, defender_type_id, damage_multiplier) VALUES
  ((SELECT unit_type_id FROM unit_types WHERE name='Devotio'),(SELECT unit_type_id FROM unit_types WHERE name='Hastati'),        1.25),
  ((SELECT unit_type_id FROM unit_types WHERE name='Devotio'),(SELECT unit_type_id FROM unit_types WHERE name='Infantería Libia'),1.25),
  ((SELECT unit_type_id FROM unit_types WHERE name='Devotio'),(SELECT unit_type_id FROM unit_types WHERE name='Caetrati'),        1.25),
  ((SELECT unit_type_id FROM unit_types WHERE name='Devotio'),(SELECT unit_type_id FROM unit_types WHERE name='Celtíberos'),      1.25);

-- Carros: carga que aplasta formaciones ligeras y arqueros.
INSERT INTO unit_combat_counters (attacker_type_id, defender_type_id, damage_multiplier) VALUES
  ((SELECT unit_type_id FROM unit_types WHERE name='Carros'),(SELECT unit_type_id FROM unit_types WHERE name='Hastati'),        1.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Carros'),(SELECT unit_type_id FROM unit_types WHERE name='Infantería Libia'),1.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Carros'),(SELECT unit_type_id FROM unit_types WHERE name='Caetrati'),        1.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Carros'),(SELECT unit_type_id FROM unit_types WHERE name='Celtíberos'),      1.30),
  ((SELECT unit_type_id FROM unit_types WHERE name='Carros'),(SELECT unit_type_id FROM unit_types WHERE name='Velites'),          1.50),
  ((SELECT unit_type_id FROM unit_types WHERE name='Carros'),(SELECT unit_type_id FROM unit_types WHERE name='Honderos Baleares'),1.50),
  ((SELECT unit_type_id FROM unit_types WHERE name='Carros'),(SELECT unit_type_id FROM unit_types WHERE name='Falarica'),         1.50),
  ((SELECT unit_type_id FROM unit_types WHERE name='Carros'),(SELECT unit_type_id FROM unit_types WHERE name='Cazadores'),        1.50);

-- Mercenarios Galos: carga berserk contra infantería sin preparar.
INSERT INTO unit_combat_counters (attacker_type_id, defender_type_id, damage_multiplier) VALUES
  ((SELECT unit_type_id FROM unit_types WHERE name='Mercenarios Galos'),(SELECT unit_type_id FROM unit_types WHERE name='Hastati'),        1.20),
  ((SELECT unit_type_id FROM unit_types WHERE name='Mercenarios Galos'),(SELECT unit_type_id FROM unit_types WHERE name='Infantería Libia'),1.20),
  ((SELECT unit_type_id FROM unit_types WHERE name='Mercenarios Galos'),(SELECT unit_type_id FROM unit_types WHERE name='Caetrati'),        1.20),
  ((SELECT unit_type_id FROM unit_types WHERE name='Mercenarios Galos'),(SELECT unit_type_id FROM unit_types WHERE name='Celtíberos'),      1.20);

-- ── K: CABALLERÍA contra ASEDIO ───────────────────────────────
-- Caballería destruye máquinas de guerra sin escolta.
INSERT INTO unit_combat_counters (attacker_type_id, defender_type_id, damage_multiplier) VALUES
  -- CAVALRY_1 vs Onagro
  ((SELECT unit_type_id FROM unit_types WHERE name='Equites'),              (SELECT unit_type_id FROM unit_types WHERE name='Onagro'),                        1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Numida'),    (SELECT unit_type_id FROM unit_types WHERE name='Onagro'),                        1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes con Lanza'),    (SELECT unit_type_id FROM unit_types WHERE name='Onagro'),                        1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Exploración'),(SELECT unit_type_id FROM unit_types WHERE name='Onagro'),                       1.80),
  -- CAVALRY_1 vs Ariete (Cartago)
  ((SELECT unit_type_id FROM unit_types WHERE name='Equites'),              (SELECT unit_type_id FROM unit_types WHERE name='Ariete' AND culture_id=2),       1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Numida'),    (SELECT unit_type_id FROM unit_types WHERE name='Ariete' AND culture_id=2),       1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes con Lanza'),    (SELECT unit_type_id FROM unit_types WHERE name='Ariete' AND culture_id=2),       1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Exploración'),(SELECT unit_type_id FROM unit_types WHERE name='Ariete' AND culture_id=2),      1.80),
  -- CAVALRY_1 vs Ariete (Íberos)
  ((SELECT unit_type_id FROM unit_types WHERE name='Equites'),              (SELECT unit_type_id FROM unit_types WHERE name='Ariete' AND culture_id=3),       1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Numida'),    (SELECT unit_type_id FROM unit_types WHERE name='Ariete' AND culture_id=3),       1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes con Lanza'),    (SELECT unit_type_id FROM unit_types WHERE name='Ariete' AND culture_id=3),       1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Exploración'),(SELECT unit_type_id FROM unit_types WHERE name='Ariete' AND culture_id=3),      1.80),
  -- CAVALRY_1 vs Ariete (Celtas)
  ((SELECT unit_type_id FROM unit_types WHERE name='Equites'),              (SELECT unit_type_id FROM unit_types WHERE name='Ariete' AND culture_id=4),       1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Numida'),    (SELECT unit_type_id FROM unit_types WHERE name='Ariete' AND culture_id=4),       1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes con Lanza'),    (SELECT unit_type_id FROM unit_types WHERE name='Ariete' AND culture_id=4),       1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Exploración'),(SELECT unit_type_id FROM unit_types WHERE name='Ariete' AND culture_id=4),      1.80),
  -- CAVALRY_2 vs Onagro
  ((SELECT unit_type_id FROM unit_types WHERE name='Auxilia'),              (SELECT unit_type_id FROM unit_types WHERE name='Onagro'),                        1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Hispana'),   (SELECT unit_type_id FROM unit_types WHERE name='Onagro'),                        1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes de Élite'),     (SELECT unit_type_id FROM unit_types WHERE name='Onagro'),                        1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Nobles a Caballo'),     (SELECT unit_type_id FROM unit_types WHERE name='Onagro'),                        1.80),
  -- CAVALRY_2 vs Ariete (Cartago)
  ((SELECT unit_type_id FROM unit_types WHERE name='Auxilia'),              (SELECT unit_type_id FROM unit_types WHERE name='Ariete' AND culture_id=2),       1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Hispana'),   (SELECT unit_type_id FROM unit_types WHERE name='Ariete' AND culture_id=2),       1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes de Élite'),     (SELECT unit_type_id FROM unit_types WHERE name='Ariete' AND culture_id=2),       1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Nobles a Caballo'),     (SELECT unit_type_id FROM unit_types WHERE name='Ariete' AND culture_id=2),       1.80),
  -- CAVALRY_2 vs Ariete (Íberos)
  ((SELECT unit_type_id FROM unit_types WHERE name='Auxilia'),              (SELECT unit_type_id FROM unit_types WHERE name='Ariete' AND culture_id=3),       1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Hispana'),   (SELECT unit_type_id FROM unit_types WHERE name='Ariete' AND culture_id=3),       1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes de Élite'),     (SELECT unit_type_id FROM unit_types WHERE name='Ariete' AND culture_id=3),       1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Nobles a Caballo'),     (SELECT unit_type_id FROM unit_types WHERE name='Ariete' AND culture_id=3),       1.80),
  -- CAVALRY_2 vs Ariete (Celtas)
  ((SELECT unit_type_id FROM unit_types WHERE name='Auxilia'),              (SELECT unit_type_id FROM unit_types WHERE name='Ariete' AND culture_id=4),       1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Hispana'),   (SELECT unit_type_id FROM unit_types WHERE name='Ariete' AND culture_id=4),       1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Jinetes de Élite'),     (SELECT unit_type_id FROM unit_types WHERE name='Ariete' AND culture_id=4),       1.80),
  ((SELECT unit_type_id FROM unit_types WHERE name='Nobles a Caballo'),     (SELECT unit_type_id FROM unit_types WHERE name='Ariete' AND culture_id=4),       1.80);

-- ── L: INFANTRY_1 contra ASEDIO ────────────────────────────────
-- Infantería básica sobrepasa fácilmente máquinas sin escolta.
INSERT INTO unit_combat_counters (attacker_type_id, defender_type_id, damage_multiplier) VALUES
  ((SELECT unit_type_id FROM unit_types WHERE name='Hastati'),        (SELECT unit_type_id FROM unit_types WHERE name='Onagro'),                       1.50),
  ((SELECT unit_type_id FROM unit_types WHERE name='Infantería Libia'),(SELECT unit_type_id FROM unit_types WHERE name='Onagro'),                      1.50),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caetrati'),        (SELECT unit_type_id FROM unit_types WHERE name='Onagro'),                      1.50),
  ((SELECT unit_type_id FROM unit_types WHERE name='Celtíberos'),      (SELECT unit_type_id FROM unit_types WHERE name='Onagro'),                      1.50),
  ((SELECT unit_type_id FROM unit_types WHERE name='Hastati'),        (SELECT unit_type_id FROM unit_types WHERE name='Ariete' AND culture_id=2),      1.50),
  ((SELECT unit_type_id FROM unit_types WHERE name='Infantería Libia'),(SELECT unit_type_id FROM unit_types WHERE name='Ariete' AND culture_id=2),     1.50),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caetrati'),        (SELECT unit_type_id FROM unit_types WHERE name='Ariete' AND culture_id=2),     1.50),
  ((SELECT unit_type_id FROM unit_types WHERE name='Celtíberos'),      (SELECT unit_type_id FROM unit_types WHERE name='Ariete' AND culture_id=2),     1.50),
  ((SELECT unit_type_id FROM unit_types WHERE name='Hastati'),        (SELECT unit_type_id FROM unit_types WHERE name='Ariete' AND culture_id=3),      1.50),
  ((SELECT unit_type_id FROM unit_types WHERE name='Infantería Libia'),(SELECT unit_type_id FROM unit_types WHERE name='Ariete' AND culture_id=3),     1.50),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caetrati'),        (SELECT unit_type_id FROM unit_types WHERE name='Ariete' AND culture_id=3),     1.50),
  ((SELECT unit_type_id FROM unit_types WHERE name='Celtíberos'),      (SELECT unit_type_id FROM unit_types WHERE name='Ariete' AND culture_id=3),     1.50),
  ((SELECT unit_type_id FROM unit_types WHERE name='Hastati'),        (SELECT unit_type_id FROM unit_types WHERE name='Ariete' AND culture_id=4),      1.50),
  ((SELECT unit_type_id FROM unit_types WHERE name='Infantería Libia'),(SELECT unit_type_id FROM unit_types WHERE name='Ariete' AND culture_id=4),     1.50),
  ((SELECT unit_type_id FROM unit_types WHERE name='Caetrati'),        (SELECT unit_type_id FROM unit_types WHERE name='Ariete' AND culture_id=4),     1.50),
  ((SELECT unit_type_id FROM unit_types WHERE name='Celtíberos'),      (SELECT unit_type_id FROM unit_types WHERE name='Ariete' AND culture_id=4),     1.50);

-- =============================================================
-- VERIFICACIÓN
-- =============================================================
SELECT 'Terrain modifiers insertados:' AS info, COUNT(*) AS total FROM unit_terrain_modifiers;
SELECT 'Combat counters insertados:' AS info, COUNT(*) AS total FROM unit_combat_counters;

SELECT ut.name, utm.terrain_type, utm.attack_modificator, utm.defense_modificator
FROM unit_terrain_modifiers utm
JOIN unit_types ut ON ut.unit_type_id = utm.unit_type_id
ORDER BY ut.culture_id, ut.unit_class, utm.terrain_type
LIMIT 20;

-- =============================================================
INSERT INTO schema_migrations (script_name)
VALUES ('085_terrain_modifiers_and_counters.sql')
ON CONFLICT DO NOTHING;
