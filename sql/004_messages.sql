-- Tabla de Mensajes
CREATE TABLE messages (
    id SERIAL PRIMARY KEY,
    sender_id INT REFERENCES players(player_id),
    receiver_id INT REFERENCES players(player_id), -- NULL si es mensaje del sistema
    subject VARCHAR(255),
    body TEXT,
    h3_index TEXT, -- Referencia opcional a una celda
    is_read BOOLEAN DEFAULT FALSE,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 1. Añadir el campo de rol a la tabla players
ALTER TABLE players ADD COLUMN role VARCHAR(20) DEFAULT 'player';

-- Aseguramos que el admin sea admin (ajusta el ID según tu usuario)
UPDATE players SET role = 'admin' WHERE username = 'LordAdmin';

-- 1. Añadimos la columna 'password' (si no existía)
ALTER TABLE players ADD COLUMN password VARCHAR(255);

-- 2. Nos aseguramos de que el campo 'role' también esté presente
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='players' AND column_name='role') THEN
        ALTER TABLE players ADD COLUMN role VARCHAR(20) DEFAULT 'player';
    END IF;
END $$;

COMMIT;

-- 3. Ahora que existen, configuramos el Admin
-- SUSTITUYE 'tu_contraseña_aqui' por la que quieras usar
UPDATE players 
SET password = '111' 