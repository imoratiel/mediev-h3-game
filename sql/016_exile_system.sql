-- Sistema de Exilio: marca a jugadores que han perdido todos sus territorios
ALTER TABLE players ADD COLUMN IF NOT EXISTS is_exiled BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN players.is_exiled IS 'TRUE cuando el jugador ha perdido todos sus feudos. Le permite colonizar cualquier hex libre ignorando la adyacencia.';
