'use strict';

/**
 * RelationConfig.js
 * Constantes configurables del sistema de relaciones políticas.
 * Modificar aquí para rebalancear sin tocar la lógica.
 */

// ── Tasas de tributo ─────────────────────────────────────────
const TRIBUTE_RATE_DEVOTIO    = 0.05;   // 5% ingresos → patrón
const TRIBUTE_RATE_CLIENTELA  = 0.10;   // 10% ingresos → patrón
const TRIBUTE_RATE_REHENES    = 0.02;   // 2% ingresos → custodio

// Tributo forzado: rango definido por el receptor
const TRIBUTO_MIN_RATE   = 0.05;        // 5%
const TRIBUTO_MAX_RATE   = 0.10;        // 10%
const TRIBUTO_MIN_MONTHS = 12;          // 1 año de juego
const TRIBUTO_MAX_MONTHS = 120;         // 10 años de juego

// ── Mercenariado ─────────────────────────────────────────────
const MERCENARIOS_MIN_MONTHS = 6;       // duración mínima del contrato
const MERCENARIOS_MAX_MONTHS = 24;      // duración máxima (2 años)
const MERCENARIOS_MIN_PAY    = 100;     // pago mínimo fijo mensual (oro)

// ── Devotio: efectos mientras el patrón vive ─────────────────
const DEVOTIO_ATTACK_BONUS   = 0.05;   // +5% ataque para el seguidor
const DEVOTIO_DEFENSE_BONUS  = 0.05;   // +5% defensa para el seguidor

// ── Devotio: consecuencias al morir el patrón en combate ─────
const DEVOTIO_TROOP_LOSS_FRACTION = 0.10;  // 10% tropas del seguidor mueren
// El main_character del seguidor también muere (lógica en onMainCharacterDeath)

// ── Reputación ───────────────────────────────────────────────
const REPUTATION_BREAK_PENALTY = -10;  // perder reputación al romper unilateralmente
const REPUTATION_BREAK_DEVOTIO = -25;  // devotio es irrompible; si se fuerza, penalización mayor
const REPUTATION_MIN = -100;
const REPUTATION_MAX = 100;

// ── Turno aproximado por mes ──────────────────────────────────
// 1 turno = 1 día de juego → 1 mes ≈ 30 turnos
const TURNS_PER_MONTH = 30;

// ── Día del mes en que se procesan los tributos ───────────────
// Mismo día que la recaudación fiscal (tax_collector.js)
const TRIBUTE_COLLECTION_DAY = 10;

module.exports = {
    TRIBUTE_RATE_DEVOTIO,
    TRIBUTE_RATE_CLIENTELA,
    TRIBUTE_RATE_REHENES,
    TRIBUTO_MIN_RATE,
    TRIBUTO_MAX_RATE,
    TRIBUTO_MIN_MONTHS,
    TRIBUTO_MAX_MONTHS,
    MERCENARIOS_MIN_MONTHS,
    MERCENARIOS_MAX_MONTHS,
    MERCENARIOS_MIN_PAY,
    DEVOTIO_ATTACK_BONUS,
    DEVOTIO_DEFENSE_BONUS,
    DEVOTIO_TROOP_LOSS_FRACTION,
    REPUTATION_BREAK_PENALTY,
    REPUTATION_BREAK_DEVOTIO,
    REPUTATION_MIN,
    REPUTATION_MAX,
    TURNS_PER_MONTH,
    TRIBUTE_COLLECTION_DAY,
};
