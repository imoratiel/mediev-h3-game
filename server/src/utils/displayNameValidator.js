/**
 * displayNameValidator.js
 * Validates and sanitizes player display names before DB insertion.
 *
 * Rules:
 *   - Strip HTML/script tags (XSS prevention)
 *   - Only letters (including accented), digits and single spaces
 *   - Length: 3–20 characters after trimming
 *   - No all-whitespace names
 *   - Not a reserved system word
 *   - No blacklisted terms (case-insensitive, partial match)
 */

// ── Regex ─────────────────────────────────────────────────────────────────
// Allows: a-z A-Z 0-9 áéíóú ÁÉÍÓÚ ñÑ üÜ and single spaces
const VALID_CHARS = /^[a-zA-Z0-9áéíóúÁÉÍÓÚñÑüÜ ]+$/;

// ── Reserved system words (case-insensitive exact match) ──────────────────
const RESERVED_WORDS = new Set([
    'admin', 'administrador', 'server', 'servidor', 'system', 'sistema',
    'moderador', 'moderator', 'gm', 'gamemaster', 'neutral', 'dios', 'god',
    'soporte', 'support', 'staff', 'root', 'null', 'undefined'
]);

// ── Blacklisted substrings (case-insensitive) ─────────────────────────────
// Keep it practical: common insults in Spanish and English.
const BLACKLIST = [
    // Spanish
    'puta', 'puto', 'mierda', 'cojone', 'coño', 'hostia', 'gilipollas',
    'capullo', 'cabrón', 'cabron', 'marica', 'maricón', 'maricon',
    'imbecil', 'imbécil', 'idiota', 'estupido', 'estúpido', 'pendejo',
    'culero', 'culiao', 'huevon', 'huevón', 'verga', 'polla', 'chinga',
    'chingado', 'pinche', 'mamón', 'mamon', 'hdp', 'hijo de puta',
    // English
    'fuck', 'shit', 'bitch', 'asshole', 'bastard', 'nigger', 'faggot',
    'cunt', 'whore', 'slut', 'dick', 'cock', 'pussy', 'retard', 'spic',
    'kike', 'dyke', 'tranny'
];

/**
 * Strips HTML/XML tags and PHP-style tags from a string.
 * Prevents XSS injection in stored names.
 * @param {string} input
 * @returns {string}
 */
function stripTags(input) {
    return String(input)
        .replace(/<[^>]*>/g, '')      // Remove HTML/XML tags
        .replace(/&[a-z]+;/gi, '')    // Remove HTML entities
        .replace(/javascript:/gi, '') // Remove JS protocol
        .trim();
}

/**
 * Validates a display_name and returns a result object.
 * @param {string} raw - Raw input from the user
 * @returns {{ valid: boolean, sanitized?: string, error?: string }}
 */
function validate(raw) {
    if (typeof raw !== 'string') {
        return { valid: false, error: 'El nombre de personaje debe ser un texto válido' };
    }

    // 1. Strip tags (XSS prevention) then trim
    const sanitized = stripTags(raw).replace(/  +/g, ' ').trim();

    // 2. Empty / only whitespace
    if (!sanitized) {
        return { valid: false, error: 'El nombre de personaje no puede estar vacío' };
    }

    // 3. Length
    if (sanitized.length < 3) {
        return { valid: false, error: 'El nombre de personaje debe tener al menos 3 caracteres' };
    }
    if (sanitized.length > 20) {
        return { valid: false, error: 'El nombre de personaje no puede superar los 20 caracteres' };
    }

    // 4. Allowed characters
    if (!VALID_CHARS.test(sanitized)) {
        return { valid: false, error: 'El nombre solo puede contener letras, números y espacios' };
    }

    // 5. Reserved words (exact match on the whole name, case-insensitive)
    if (RESERVED_WORDS.has(sanitized.toLowerCase())) {
        return { valid: false, error: 'El nombre contiene palabras no permitidas o caracteres inválidos' };
    }

    // 6. Blacklist (substring match, case-insensitive)
    const lower = sanitized.toLowerCase();
    const forbidden = BLACKLIST.find(word => lower.includes(word));
    if (forbidden) {
        return { valid: false, error: 'El nombre contiene palabras no permitidas o caracteres inválidos' };
    }

    return { valid: true, sanitized };
}

module.exports = { validate };
