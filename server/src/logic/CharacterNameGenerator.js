'use strict';

/**
 * Genera nombres de personaje histórico según cultura y género.
 * El nombre final es: [nombre de pila cultural] [linaje del jugador]
 *
 * culture_id: 1=Romano, 2=Cartaginés, 3=Íbero, 4=Celta
 */

const NAMES = {
    // ── Romano ───────────────────────────────────────────────────────────────
    1: {
        M: [
            // Praenomina
            'Marcus', 'Lucius', 'Gaius', 'Quintus', 'Titus', 'Publius', 'Gnaeus',
            'Aulus', 'Manius', 'Servius', 'Appius', 'Kaeso', 'Spurius', 'Decimus',
            'Numerius', 'Caius', 'Sextus', 'Vibius', 'Opiter', 'Volero',
            // Cognomina históricos usados como nombre
            'Flavius', 'Drusus', 'Brutus', 'Cassius', 'Scipio', 'Cato', 'Crassus',
            'Rufus', 'Niger', 'Strabo', 'Flaccus', 'Naso', 'Labeo', 'Calvus',
            'Torquatus', 'Regulus', 'Balbus', 'Nasica', 'Laenas', 'Bibulus',
            'Vatia', 'Celer', 'Scaeva', 'Lentulus', 'Piso', 'Tubero', 'Dentatus',
            'Cursor', 'Rullus', 'Maximus', 'Lepidus', 'Agrippa', 'Nerva',
            'Trajan', 'Hadrian', 'Vespasian', 'Galba', 'Otho', 'Vitellius',
            'Petronius', 'Seneca', 'Tacitus', 'Sallust', 'Plautus', 'Terentius',
            'Hortensius', 'Lucullus', 'Murena', 'Pansa', 'Hirtius', 'Dolabella',
        ],
        F: [
            'Claudia', 'Julia', 'Livia', 'Cornelia', 'Valeria', 'Aemilia',
            'Fulvia', 'Calpurnia', 'Sempronia', 'Porcia', 'Terentia', 'Caecilia',
            'Tullia', 'Servilia', 'Marcia', 'Fabia', 'Pompeia', 'Mucia', 'Junia',
            'Atia', 'Octavia', 'Scribonia', 'Drusilla', 'Agrippina', 'Messalina',
            'Poppaea', 'Statilia', 'Flavia', 'Domitia', 'Plotina', 'Sabina',
            'Faustina', 'Lucilla', 'Crispina', 'Paulina', 'Clodia', 'Licinia',
            'Hortensia', 'Antonia', 'Minucia', 'Voconia', 'Manlia', 'Sentia',
            'Plaetoria', 'Rutilia', 'Salvia', 'Naevia', 'Oppia', 'Titia',
        ],
    },

    // ── Cartaginés ────────────────────────────────────────────────────────────
    2: {
        M: [
            'Hannibal', 'Hasdrubal', 'Hamilcar', 'Mago', 'Adherbal', 'Bomilcar',
            'Gesco', 'Himilco', 'Maharbal', 'Mutines', 'Carthalo', 'Bostar',
            'Naravas', 'Imilco', 'Azrubal', 'Hiempsal', 'Barcas', 'Sapho',
            'Mastanabal', 'Micipsa', 'Jugurtha', 'Juba', 'Masinissa', 'Syphax',
            'Bocchus', 'Vermina', 'Capussa', 'Massiva', 'Gulussa', 'Lakumazes',
            'Mazares', 'Lakumas', 'Stembas', 'Dimichus', 'Iesalcas', 'Sofax',
            'Mazitulus', 'Barnabas', 'Melichus', 'Baalhanno', 'Asdrubal',
            'Hecataeus', 'Malchus', 'Azcarro', 'Himilcat', 'Bodmelqart',
            'Abdobaal', 'Channaath', 'Shalambaal', 'Abibaal', 'Abdmelqart',
            'Baalazor', 'Baaliaton', 'Eshmunazar', 'Yatonbaal', 'Milkyaton',
        ],
        F: [
            'Sophoniba', 'Elissa', 'Dido', 'Tanit', 'Arishat', 'Baliaton',
            'Salammbo', 'Hamilcara', 'Nahar', 'Imilcat', 'Astarte',
            'Qart', 'Tinnit', 'Batbaal', 'Batnoam', 'Imilkat', 'Ashtart',
            'Muttunbaal', 'Hannibaal', 'Shupiluliuma', 'Azrubaal', 'Maatana',
            'Yatarimut', 'Bastet', 'Anatbaal', 'Abdastarte', 'Tinnit',
            'Arishat', 'Bomilcara', 'Gesconibaal', 'Himila', 'Birzamath',
        ],
    },

    // ── Íbero ─────────────────────────────────────────────────────────────────
    3: {
        M: [
            'Viriato', 'Indortes', 'Corocotta', 'Attenes', 'Moericanus',
            'Istolatius', 'Corbis', 'Orsua', 'Abaro', 'Leucon', 'Turmo',
            'Amusico', 'Retogenes', 'Megara', 'Lircus', 'Edesco', 'Bilistages',
            'Mandonius', 'Indibilis', 'Allucius', 'Culcas', 'Abilyx', 'Baises',
            'Tantalos', 'Teibar', 'Urke', 'Iluro', 'Setus', 'Bello',
            'Nerto', 'Iltikesken', 'Turibas', 'Balke', 'Likine', 'Neitin',
            'Tautin', 'Arse', 'Eraton', 'Baskunes', 'Agiris', 'Olondikos',
            'Karos', 'Letondos', 'Sedetanus', 'Ilduradin', 'Baesadines',
            'Urchail', 'Biuror', 'Likanos', 'Ketubelos', 'Sosinaden',
            'Orgiago', 'Suessetanos', 'Lacetanos', 'Boles', 'Iltiber',
        ],
        F: [
            'Himilce', 'Luscina', 'Saldubia', 'Arco', 'Nertobriga', 'Ildirta',
            'Salduba', 'Baria', 'Urso', 'Castulo', 'Obulco', 'Iltiraka',
            'Turba', 'Arsa', 'Kalare', 'Seta', 'Birike', 'Baase', 'Kelse',
            'Lakune', 'Ikesalir', 'Ildurbeles', 'Tautindals', 'Bastok',
            'Beles', 'Ildunike', 'Ilturadin', 'Neitin', 'Ikale', 'Unes',
            'Ikori', 'Iltune', 'Arketara', 'Salir', 'Bastertaun',
        ],
    },

    // ── Celta ─────────────────────────────────────────────────────────────────
    4: {
        M: [
            'Vercingetorix', 'Brennus', 'Dumnorix', 'Ambiorix', 'Orgetorix',
            'Diviciacus', 'Cassivellaunus', 'Caratacus', 'Togodumnus', 'Cunobelin',
            'Adminius', 'Vercassivellaunus', 'Lucterius', 'Drappes', 'Commius',
            'Epasnactus', 'Tasgetius', 'Sedulius', 'Viridovix', 'Boduognatus',
            'Catuvolcus', 'Cingetorix', 'Indutiomarus', 'Sacrovir', 'Florus',
            'Tasciovanus', 'Epaticcus', 'Verica', 'Cogidubnus', 'Segovax',
            'Lugotorix', 'Mandubracius', 'Carvilios', 'Acco', 'Litavicus',
            'Cotus', 'Gutuater', 'Surus', 'Criognatos', 'Teutomatos',
            'Gobannitio', 'Morikamos', 'Toutorix', 'Celtillos', 'Nammeios',
            'Viducus', 'Vertico', 'Roucillus', 'Eguus', 'Cotus', 'Dumnacus',
            'Moritasgus', 'Catamantaloedes', 'Ollovico', 'Dumnovellauno',
        ],
        F: [
            'Boudicca', 'Epona', 'Cartimandua', 'Veleda', 'Medb',
            'Onomaris', 'Scathach', 'Flidais', 'Brigantia', 'Andraste',
            'Rigantona', 'Damona', 'Sirona', 'Derbforgaill', 'Macha',
            'Morrigan', 'Nemain', 'Badb', 'Fand', 'Niamh',
            'Aine', 'Cliodhna', 'Eriu', 'Banba', 'Fodla',
            'Cessair', 'Tailtu', 'Carman', 'Tlachtga', 'Mongfind',
            'Etain', 'Deichtine', 'Emer', 'Finnabair', 'Gráinne',
            'Muirenn', 'Liadain', 'Nessa', 'Dervla', 'Scota',
        ],
    },
};

class CharacterNameGenerator {
    static #pick(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    /**
     * Genera un nombre completo: "[nombre de pila] [linaje]"
     * @param {number|null} culture_id
     * @param {'M'|'F'} gender
     * @param {string} linaje
     */
    static generate(culture_id, gender = 'M', linaje = '') {
        const cultureNames = NAMES[culture_id] ?? NAMES[3];
        const genderPool   = cultureNames[gender] ?? cultureNames['M'];
        const firstName    = this.#pick(genderPool);
        return linaje ? `${firstName} ${linaje}` : firstName;
    }
}

module.exports = CharacterNameGenerator;
