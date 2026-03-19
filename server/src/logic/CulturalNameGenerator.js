'use strict';

/**
 * CulturalNameGenerator.js
 *
 * Genera nombres de divisiones políticas basados en la cultura del fundador
 * y el terreno dominante del territorio.
 *
 * Combinatoria:
 *   25 prefijos × 20 sufijos = 500 nombres base por cultura
 *   × 12 modificadores de terreno = 6 000 combinaciones por cultura
 *
 * El nombre es DETERMINISTA: el mismo h3_index siempre produce el mismo nombre.
 */

// ── Morfemas por cultura ──────────────────────────────────────────────────────
// culture_id: 1=Romano, 2=Cartaginés, 3=Íbero, 4=Celta

const MORPHEMES = {
    1: { // Romano — raíces latino-hispanas
        prefix: [
            'Aqui',   'Augu',    'Argen',   'Braca',  'Caes',
            'Calu',   'Canta',   'Casta',   'Cluni',  'Condimb',
            'Cordu',  'Emeri',   'Flavi',   'Hispa',  'Itali',
            'Lauri',  'Lucu',    'Narbo',   'Nova',   'Osso',
            'Porta',  'Salman',  'Segovi',  'Tarra',  'Valenti',
        ],
        suffix: [
            'um',     'a',       'ica',     'anum',   'ensis',
            'ana',    'inia',    'etum',    'acum',   'alia',
            'ium',    'ianum',   'onia',    'uria',   'ula',
            'ella',   'aca',     'aria',    'onum',   'itum',
        ],
        terrain: {
            'Alta Montaña':       'Alpinum',
            'Bosque':             'Silvanum',
            'Espesuras':          'Nemoris',
            'Colinas':            'Collinum',
            'Oteros':             'Tumulum',
            'Río':                'Flumen',
            'Pantanos':           'Paludes',
            'Costa':              'Maritimum',
            'Tierras de Cultivo': 'Campanum',
            'Tierras de Secano':  'Siccanum',
            'Estepas':            'Planitium',
            'Asentamiento':       'Vicum',
        },
    },

    2: { // Cartaginés — raíces púnico-fenicias
        prefix: [
            'Qart',   'Rus',     'Hadr',    'Baal',   'Hann',
            'Mago',   'Adh',     'Sopho',   'Eliss',  'Motya',
            'Pano',   'Lixu',    'Siga',    'Thevs',  'Kerkua',
            'Hadrum', 'Utica',   'Leptis',  'Sabrath','Zama',
            'Zimb',   'Yatan',   'Asdrub',  'Tigis',  'Macar',
        ],
        suffix: [
            'addir',  'umet',    'adasht',  'ibim',   'obal',
            'erbal',  'abar',    'atis',    'enim',   'adath',
            'ibur',   'anem',    'utim',    'acim',   'adim',
            'urim',   'ibal',    'omon',    'athan',  'adir',
        ],
        terrain: {
            'Alta Montaña':       'Ha-Har',
            'Bosque':             "Ha-Ya'ar",
            'Espesuras':          'Ha-Sevach',
            'Colinas':            'Ha-Givot',
            'Oteros':             'Ha-Tel',
            'Río':                'Ha-Nahar',
            'Pantanos':           'Ha-Bitza',
            'Costa':              'Ha-Yam',
            'Tierras de Cultivo': 'Ha-Sadeh',
            'Tierras de Secano':  'Ha-Tziah',
            'Estepas':            'Ha-Midbar',
            'Asentamiento':       'Ha-Ir',
        },
    },

    3: { // Íbero — raíces de topónimos ibéricos
        prefix: [
            'Ili',    'Seg',     'Tur',     'Osca',   'Bel',
            'Kese',   'Atin',    'Edeta',   'Arse',   'Sago',
            'Saiti',  'Iltirta', 'Laies',   'Iesso',  'Aeso',
            'Kontrebi','Ilerda', 'Tader',   'Ikale',  'Orce',
            'Kelin',  'Ilunia',  'Basti',   'Ikales', 'Celi',
        ],
        suffix: [
            'briga',  'sega',    'dunum',   'kena',   'iltun',
            'esken',  'adin',    'itur',    'tikan',  'ostur',
            'ike',    'aun',     'sken',    'bels',   'tike',
            'atur',   'nion',    'iltur',   'eban',   'osca',
        ],
        terrain: {
            'Alta Montaña':       'Aro',
            'Bosque':             'Ilun',
            'Espesuras':          'Oihan',
            'Colinas':            'Oski',
            'Oteros':             'Muño',
            'Río':                'Ibar',
            'Pantanos':           'Laku',
            'Costa':              'Kai',
            'Tierras de Cultivo': 'Baso',
            'Tierras de Secano':  'Argi',
            'Estepas':            'Zaldi',
            'Asentamiento':       'Kale',
        },
    },

    4: { // Celta — raíces galo-celtas
        prefix: [
            'Duno',   'Mag',     'Brig',    'Cambo',  'Nanto',
            'Vero',   'Equo',    'Mori',    'Uxelo',  'Medio',
            'Lugdu',  'Eburo',   'Vesun',   'Namne',  'Roto',
            'Bibrac', 'Alesia',  'Mandub',  'Cenabo', 'Aremo',
            'Vindob', 'Gergo',   'Sego',    'Telo',   'Novio',
        ],
        suffix: [
            'dunum',  'briga',   'magus',   'ritum',  'nium',
            'durum',  'ialo',    'acum',    'etum',   'onum',
            'atum',   'icum',    'anum',    'esum',   'osum',
            'acom',   'illum',   'odum',    'aedum',  'olum',
        ],
        terrain: {
            'Alta Montaña':       'Vindos',
            'Bosque':             'Nemeton',
            'Espesuras':          'Caeto',
            'Colinas':            'Briga',
            'Oteros':             'Duro',
            'Río':                'Dubron',
            'Pantanos':           'Lindo',
            'Costa':              'Mori',
            'Tierras de Cultivo': 'Magos',
            'Tierras de Secano':  'Siro',
            'Estepas':            'Plano',
            'Asentamiento':       'Dunum',
        },
    },
};

// Fallback si la cultura no está en el mapa
const DEFAULT_CULTURE = 3;

// ── Generación determinista ───────────────────────────────────────────────────

/**
 * Extrae dos índices independientes del h3_index para elegir prefijo y sufijo.
 * Usa tramos distintos del string hexadecimal para evitar correlación.
 *
 * @param {string} h3Index  H3 cell index (ej: "881f0a2a3bfffff")
 * @returns {{ a: number, b: number }}
 */
function _seedFromH3(h3Index) {
    const hex = h3Index.replace(/[^0-9a-f]/gi, '');
    const a = parseInt(hex.slice(0, 6), 16) || 0;    // primeros 24 bits
    const b = parseInt(hex.slice(5, 11), 16) || 0;   // desplazado 20 bits
    return { a, b };
}

/**
 * Genera el nombre base (sin modificador de terreno) de forma determinista.
 *
 * @param {number} cultureId
 * @param {string} h3Index   Capital del pagus — actúa como semilla
 * @returns {string}
 */
function generateBaseName(cultureId, h3Index) {
    const morph    = MORPHEMES[cultureId] ?? MORPHEMES[DEFAULT_CULTURE];
    const { a, b } = _seedFromH3(h3Index);

    const prefix = morph.prefix[a % morph.prefix.length];
    const suffix = morph.suffix[b % morph.suffix.length];

    // Capitalizar primera letra del prefijo, sufijo en minúsculas
    return prefix.charAt(0).toUpperCase() + prefix.slice(1).toLowerCase() + suffix;
}

/**
 * Genera el nombre completo del pagus: nombre base + modificador de terreno
 * en el idioma cultural del fundador.
 *
 * @param {number}      cultureId    ID de cultura del jugador fundador
 * @param {string}      h3Index      H3 index de la capital (semilla determinista)
 * @param {string|null} terrainName  Nombre del terreno dominante (de terrain_types.name)
 * @returns {string}
 */
function generateDivisionName(cultureId, h3Index, terrainName = null) {
    const morph    = MORPHEMES[cultureId] ?? MORPHEMES[DEFAULT_CULTURE];
    const baseName = generateBaseName(cultureId, h3Index);
    const modifier = terrainName ? morph.terrain[terrainName] : null;

    return modifier ? `${baseName} ${modifier}` : baseName;
}

module.exports = { generateDivisionName, generateBaseName };
