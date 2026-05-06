/**
 * FiefService.js
 * Domain logic for fief management.
 * Pure functions — no DB access, no HTTP.
 */

'use strict';

// Monthly consumption formula (mirrors processCivilFoodConsumption)
const monthlyConsumption = (population) => Math.floor(population / 100) * 3;

/**
 * Computes the new happiness value for a single fief.
 *
 * Rules (applied as inertia delta each tick):
 *
 *  TAX RATE (effective 1-15 scale)
 *    1– 5 %  → +2
 *    6–10 %  →  0
 *   11–15 %  → -2
 *
 *  FOOD AUTONOMY  (stock / monthly_consumption)
 *    stock === 0       → -15   (starvation)
 *    autonomy < 6 mo   → -5
 *    autonomy > 24 mo  → +2
 *    6–24 mo           →  0   (neutral)
 *
 *  SECURITY
 *    garrison present  → +1
 *    is_war_zone       → -10
 *
 * @param {{ happiness: number, food_stored: number, population: number, is_war_zone: boolean }} fiefData
 * @param {{ tax_rate: number, has_garrison: boolean }} context
 * @returns {number} New happiness clamped to [0, 100]
 */
function calculateHappiness(fiefData, context) {
    const { happiness, food_stored, population, is_war_zone } = fiefData;
    const { tax_rate, has_garrison } = context;

    let delta = 0;

    // --- Tax ---
    const tax = parseFloat(tax_rate) || 10;
    if      (tax <= 5)  delta += 4;
    else if (tax <= 10) delta += 0;
    else                delta -= 4;   // 11-15

    // --- Food ---
    const food    = Math.max(0, parseFloat(food_stored) || 0);
    const monthly = monthlyConsumption(population || 0);

    if (food === 0) {
        delta -= 15;
    } else if (monthly > 0) {
        const autonomy = food / monthly;
        if      (autonomy > 24) delta += 2;
        else if (autonomy < 6)  delta -= 3;
        // 6–24 months: neutral
    }
    // If monthly === 0 (unpopulated) → no food penalty

    // --- Security ---
    if (has_garrison) delta += 1;
    if (is_war_zone)  delta -= 10;

    // --- Inertia: add delta, clamp ---
    return Math.min(100, Math.max(0, (happiness || 50) + delta));
}

module.exports = { calculateHappiness, monthlyConsumption };