

-- 1. TIPOS DE UNIDADES (ESTADÍSTICAS BASE)
CREATE TABLE IF NOT EXISTS unit_types (
    unit_type_id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    attack INT DEFAULT 10,
    health_points INT DEFAULT 100,
    speed INT DEFAULT 1,
    detection_range INT DEFAULT 1,
    gold_upkeep DECIMAL(10,2) DEFAULT 5.00,
    food_consumption DECIMAL(10,2) DEFAULT 2.00,
    is_siege BOOLEAN DEFAULT FALSE,
    descrip TEXT
);

-- 2. TABLA DE EJÉRCITOS (LOGÍSTICA Y MOVIMIENTO)
CREATE TABLE IF NOT EXISTS armies (
    army_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    player_id INT NOT NULL,
    h3_index VARCHAR(15) NOT NULL,
    -- Provisiones cargadas por el ejército
    gold_provisions DECIMAL(12,2) DEFAULT 0.00,
    food_provisions DECIMAL(12,2) DEFAULT 0.00,
    wood_provisions DECIMAL(12,2) DEFAULT 0.00,
    stone_provisions DECIMAL(12,2) DEFAULT 0.00,
    iron_provisions DECIMAL(12,2) DEFAULT 0.00,
    -- Modificadores de movimiento
    speed_penalty_multiplier DECIMAL(3,2) DEFAULT 1.00, -- Basado en la carga
    rest_level DECIMAL(5,2) DEFAULT 100.00, -- 0 a 100, al llegar a 0 se detiene. Si en un turno no se mueves, está descansando y recupera.
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. REQUISITOS DE MATERIALES (N:M)
CREATE TABLE IF NOT EXISTS unit_requirements (
    id SERIAL PRIMARY KEY,
    unit_type_id INT REFERENCES unit_types(unit_type_id) ON DELETE CASCADE,
    resource_type VARCHAR(20),
    amount INT NOT NULL
);

-- 4. INSTANCIAS DE UNIDADES (DENTRO DE UN EJÉRCITO)
CREATE TABLE IF NOT EXISTS troops (
    troop_id SERIAL PRIMARY KEY,
    army_id INT REFERENCES armies(army_id) ON DELETE CASCADE,
    unit_type_id INT REFERENCES unit_types(unit_type_id),
    quantity INT NOT NULL DEFAULT 1,
    experience DECIMAL(5,2) DEFAULT 0.00,
    morale DECIMAL(5,2) DEFAULT 100.00,
    last_fed_turn INT
);

-- 5. MODIFICADORES DE TERRENO Y COMBATE
CREATE TABLE IF NOT EXISTS unit_terrain_modifiers (
    id SERIAL PRIMARY KEY,
    unit_type_id INT REFERENCES unit_types(unit_type_id) ON DELETE CASCADE,
    terrain_type VARCHAR(30),
    attack_modificator DECIMAL(3,2) DEFAULT 1.00,
    defense_modificator DECIMAL(3,2) DEFAULT 1.00,
    speed_modificator INT DEFAULT 0,
    stamina_drain_modificator DECIMAL(3,2) DEFAULT 1.00
);

-- 6. MATRIZ DE COUNTERS (BONUS ENTRE TROPAS)
CREATE TABLE IF NOT EXISTS unit_combat_counters (
    id SERIAL PRIMARY KEY,
    attacker_type_id INT REFERENCES unit_types(unit_type_id) ON DELETE CASCADE,
    defender_type_id INT REFERENCES unit_types(unit_type_id) ON DELETE CASCADE,
    damage_multiplier DECIMAL(3,2) DEFAULT 1.00
);

-- ÍNDICES
CREATE INDEX IF NOT EXISTS idx_army_h3_main ON armies (h3_index);

-- ---------------------------------------------------------
-- CARGA DE TROPAS ACTUALIZADA
-- ---------------------------------------------------------

COMMIT;

INSERT INTO unit_types (name, attack, health_points, speed, detection_range, gold_upkeep, food_consumption, is_siege, descrip) VALUES
('Milicia', 5, 30, 2, 1, 0.50, 0.1, FALSE, 'Campesinos con lanzas de madera.'),
('Soldados', 12, 80, 2, 2, 1.50, 0.1, FALSE, 'Infantería de línea profesional.'),
('Lanceros', 10, 90, 2, 2, 1.50, 0.1, FALSE, 'Muro de picas contra la caballería.'),
('Arqueros', 13, 50, 2, 3, 2.00, 0.1, FALSE, 'Hostigamiento a larga distancia.'),
('Ballesteros', 16, 55, 2, 2, 3.00, 0.1, FALSE, 'Potencia de fuego lenta pero letal.'),
('Caballería Ligera', 14, 75, 4, 4, 4.00, 0.2, FALSE, 'Exploración ofensiva y flanqueo.'),
('Caballería Pesada', 22, 130, 3, 2, 6.00, 0.3, FALSE, 'El martillo del campo de batalla.'),
('Explorador', 1, 40, 5, 6, 1.50, 0.1, FALSE, 'Ojos y oídos del general.'),
('Ariete', 5, 200, 1, 1, 8.00, 0.1, TRUE, 'Madera reforzada para romper portones.'),
('Catapulta', 35, 210, 1, 1, 22.00, 0.1, TRUE, 'Ingeniería pesada de destrucción.');


-- Requisitos para Milicia (Básico)
INSERT INTO unit_requirements (unit_type_id, resource_type, amount) 
VALUES ((SELECT unit_type_id FROM unit_types WHERE name='Milicia'), 'gold', 25);

-- Requisitos para Soldados (Hierro)
INSERT INTO unit_requirements (unit_type_id, resource_type, amount) 
VALUES ((SELECT unit_type_id FROM unit_types WHERE name='Soldados'), 'gold', 100),
       ((SELECT unit_type_id FROM unit_types WHERE name='Soldados'), 'iron_stored', 30);

-- Requisitos para Lanceros (Madera + Hierro)
INSERT INTO unit_requirements (unit_type_id, resource_type, amount) 
VALUES ((SELECT unit_type_id FROM unit_types WHERE name='Lanceros'), 'gold', 80),
       ((SELECT unit_type_id FROM unit_types WHERE name='Lanceros'), 'wood_stored', 20),
       ((SELECT unit_type_id FROM unit_types WHERE name='Lanceros'), 'iron_stored', 15);

-- Requisitos para Arqueros (Madera)
INSERT INTO unit_requirements (unit_type_id, resource_type, amount) 
VALUES ((SELECT unit_type_id FROM unit_types WHERE name='Arqueros'), 'gold', 120),
       ((SELECT unit_type_id FROM unit_types WHERE name='Arqueros'), 'wood_stored', 50);

-- Requisitos para Ballesteros (Madera + Hierro)
INSERT INTO unit_requirements (unit_type_id, resource_type, amount) 
VALUES ((SELECT unit_type_id FROM unit_types WHERE name='Ballesteros'), 'gold', 150),
       ((SELECT unit_type_id FROM unit_types WHERE name='Ballesteros'), 'wood_stored', 30),
       ((SELECT unit_type_id FROM unit_types WHERE name='Ballesteros'), 'iron_stored', 20);

-- Requisitos para Caballería Ligera (Oro alto por caballos)
INSERT INTO unit_requirements (unit_type_id, resource_type, amount) 
VALUES ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Ligera'), 'gold', 250),
       ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Ligera'), 'wood_stored', 10);

-- Requisitos para Caballería Pesada (Mucho Hierro y Oro)
INSERT INTO unit_requirements (unit_type_id, resource_type, amount) 
VALUES ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Pesada'), 'gold', 500),
       ((SELECT unit_type_id FROM unit_types WHERE name='Caballería Pesada'), 'iron_stored', 100);

-- Requisitos para Explorador (Comida/Oro)
INSERT INTO unit_requirements (unit_type_id, resource_type, amount) 
VALUES ((SELECT unit_type_id FROM unit_types WHERE name='Explorador'), 'gold', 100);

-- Requisitos para Ariete (Mucha Madera)
INSERT INTO unit_requirements (unit_type_id, resource_type, amount) 
VALUES ((SELECT unit_type_id FROM unit_types WHERE name='Ariete'), 'gold', 200),
       ((SELECT unit_type_id FROM unit_types WHERE name='Ariete'), 'wood_stored', 150);

-- Requisitos para Catapulta (Madera, Hierro y Oro)
INSERT INTO unit_requirements (unit_type_id, resource_type, amount) 
VALUES ((SELECT unit_type_id FROM unit_types WHERE name='Catapulta'), 'gold', 600),
       ((SELECT unit_type_id FROM unit_types WHERE name='Catapulta'), 'wood_stored', 100),
       ((SELECT unit_type_id FROM unit_types WHERE name='Catapulta'), 'iron_stored', 50);


-- CABALLERÍA: Bonus en Llanuras (Plains), penalización en Montañas.
INSERT INTO unit_terrain_modifiers (unit_type_id, terrain_type, attack_modificator, defense_modificator, speed_modificator, stamina_drain_modificator)
VALUES 
((SELECT unit_type_id FROM unit_types WHERE name='Caballería Pesada'), 'Plains', 1.30, 1.00, 1, 0.80),
((SELECT unit_type_id FROM unit_types WHERE name='Caballería Pesada'), 'Mountain', 0.70, 0.50, -2, 2.00);

-- ARQUEROS: Bonus defensivo enorme en Bosques (Forest).
INSERT INTO unit_terrain_modifiers (unit_type_id, terrain_type, attack_modificator, defense_modificator, speed_modificator, stamina_drain_modificator)
VALUES 
((SELECT unit_type_id FROM unit_types WHERE name='Arqueros'), 'Forest', 1.20, 1.80, 0, 0.90);

-- INFANTERÍA (Soldados/Lanceros): Estables en Colinas y Montañas.
INSERT INTO unit_terrain_modifiers (unit_type_id, terrain_type, attack_modificator, defense_modificator, speed_modificator, stamina_drain_modificator)
VALUES 
((SELECT unit_type_id FROM unit_types WHERE name='Lanceros'), 'Mountain', 1.00, 1.40, -1, 1.20),
((SELECT unit_type_id FROM unit_types WHERE name='Soldados'), 'Mountain', 1.00, 1.30, -1, 1.20);

-- EXPLORADORES: No sufren por el terreno.
INSERT INTO unit_terrain_modifiers (unit_type_id, terrain_type, attack_modificator, defense_modificator, speed_modificator, stamina_drain_modificator)
VALUES 
((SELECT unit_type_id FROM unit_types WHERE name='Explorador'), 'Forest', 1.00, 1.00, 0, 0.70),
((SELECT unit_type_id FROM unit_types WHERE name='Explorador'), 'Mountain', 1.00, 1.00, 0, 0.80);


-- LANCEROS vs CABALLERÍA (El counter clásico)
INSERT INTO unit_combat_counters (attacker_type_id, defender_type_id, damage_multiplier)
VALUES 
((SELECT unit_type_id FROM unit_types WHERE name='Lanceros'), (SELECT unit_type_id FROM unit_types WHERE name='Caballería Pesada'), 2.50),
((SELECT unit_type_id FROM unit_types WHERE name='Lanceros'), (SELECT unit_type_id FROM unit_types WHERE name='Caballería Ligera'), 2.00);

-- CABALLERÍA vs ARQUEROS/BALLESTEROS (Carga de flanco)
INSERT INTO unit_combat_counters (attacker_type_id, defender_type_id, damage_multiplier)
VALUES 
((SELECT unit_type_id FROM unit_types WHERE name='Caballería Ligera'), (SELECT unit_type_id FROM unit_types WHERE name='Arqueros'), 1.80),
((SELECT unit_type_id FROM unit_types WHERE name='Caballería Pesada'), (SELECT unit_type_id FROM unit_types WHERE name='Ballesteros'), 2.00);

-- ARQUEROS vs INFANTERÍA (Hostigamiento)
INSERT INTO unit_combat_counters (attacker_type_id, defender_type_id, damage_multiplier)
VALUES 
((SELECT unit_type_id FROM unit_types WHERE name='Arqueros'), (SELECT unit_type_id FROM unit_types WHERE name='Milicia'), 1.50),
((SELECT unit_type_id FROM unit_types WHERE name='Arqueros'), (SELECT unit_type_id FROM unit_types WHERE name='Soldados'), 1.30);

-- BALLESTEROS vs CABALLERÍA PESADA (Penetración de armadura)
INSERT INTO unit_combat_counters (attacker_type_id, defender_type_id, damage_multiplier)
VALUES 
((SELECT unit_type_id FROM unit_types WHERE name='Ballesteros'), (SELECT unit_type_id FROM unit_types WHERE name='Caballería Pesada'), 1.60);

