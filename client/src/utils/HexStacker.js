/**
 * HexStacker.js
 *
 * Generates combined Leaflet divIcon HTML for map hexagons.
 * Shows three layers of information in a triangular layout:
 *
 *   TOP           (center-top)  → Building icon
 *   BOTTOM-LEFT                 → Own troops badge  (blue, si las hay)
 *   BOTTOM-RIGHT                → Enemy troops badge (red,  si las hay)
 */

// ─── Container geometry ────────────────────────────────────────────────────
const W  = 64;   // icon width  (px)
const H  = 56;   // icon height (px)
const CX = W / 2; // 32
const CY = H / 2; // 28
const R  = 26;    // abstract hex radius for triangle maths

// Percentage positions for each slot (element centered via translate(-50%,-50%))
const POS = {
  // TOP — building icon
  building: {
    left: (CX / W) * 100,                     // 50 %
    top:  ((CY - R * 0.5) / H) * 100,         // ~26.8 %
  },
  // TOP centered — building alone (no troops at all)
  buildingCenter: {
    left: 50,
    top:  44,
  },
  // BOTTOM-LEFT — own troops
  ownTroops: {
    left: ((CX - R * 0.4) / W) * 100,         // ~33.75 %
    top:  ((CY + R * 0.3) / H) * 100,         // ~63.9 %
  },
  // BOTTOM-RIGHT — enemy troops
  enemyTroops: {
    left: ((CX + R * 0.4) / W) * 100,         // ~66.25 %
    top:  ((CY + R * 0.3) / H) * 100,         // ~63.9 %
  },
  // CENTER — solo troops when there's no building
  troopsSoloLeft: {
    left: ((CX - R * 0.25) / W) * 100,        // ~38 %
    top:  50,
  },
  troopsSoloRight: {
    left: ((CX + R * 0.25) / W) * 100,        // ~62 %
    top:  50,
  },
  troopsOnlyCenter: {
    left: 50,
    top:  50,
  },
};

// ─── Icon helpers ──────────────────────────────────────────────────────────

const BUILDING_ICON_MAP = [
  [['granja', 'farm'],                                              '🌾'],
  [['cuartel', 'barrack', 'escuela', 'militar', 'military'],        '🏰'],
  [['iglesia', 'church', 'catedral', 'templo', 'santuario'],        '🏛️'],
  [['mercado', 'market', 'foro', 'lonja', 'factor', 'feria'],       '⚖️'],
  [['fortaleza', 'fortress', 'castillo'],                           '🏰'],
  [['astillero', 'shipyard', 'portus', 'cothon', 'emporio', 'embarcadero'], '⛵'],
  [['mina', 'mine'],                                                '⛏️'],
  [['aserradero', 'lumber', 'madera'],                              '🌲'],
  [['torre', 'tower'],                                              '🏯'],
];

/**
 * Returns an emoji icon for a building by name.
 * @param {string} name - building name or type name
 * @returns {string} emoji
 */
export function getBuildingIconEmoji(name = '', typeName = '') {
  const n = name.toLowerCase();
  for (const [keywords, icon] of BUILDING_ICON_MAP) {
    if (keywords.some(k => n.includes(k))) return icon;
  }
  const t = (typeName || '').toLowerCase();
  if (t === 'military')  return '🏰';
  if (t === 'religious') return '🏛️';
  if (t === 'economic')  return '⚖️';
  return '🏯';
}

/**
 * Returns true if the building produces food-related bonuses
 * (Market or Church) — used to show the 🌾 food indicator.
 * @param {string} name
 * @returns {boolean}
 */
function isFoodBonusBuilding(name = '') {
  const n = name.toLowerCase();
  return n.includes('mercado') || n.includes('market') ||
         n.includes('iglesia') || n.includes('church')  ||
         n.includes('templo');
}

/**
 * Formats a troop count into a compact string: "1.2K" or "450".
 * @param {number} n
 * @returns {string}
 */
function formatCount(n) {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

// ─── Troop badge builder ───────────────────────────────────────────────────

/**
 * Returns the HTML for a single troop badge at the given position.
 * @param {number} count         - troop count
 * @param {'own'|'enemy'} side
 * @param {Object} pos           - { left, top } percentage values
 * @param {boolean} isConflict
 * @param {boolean} isGarrison   - render as garrison (square) badge
 * @returns {string}
 */
function _troopBadge(count, side, pos, isConflict, isGarrison = false) {
  const isEnemy = side === 'enemy';
  // Garrison own: muted slate-blue; field army colors unchanged
  const bg     = isGarrison && !isEnemy ? '#2a3f5f'  : (isEnemy ? '#b71c1c' : '#1565C0');
  const border = isGarrison && !isEnemy ? '#607d9e'  : (isEnemy ? '#ef5350' : '#42a5f5');
  const glyph  = isGarrison ? '🏰' : (count > 1 ? '⚔️' : '🗡️');
  const radius = isGarrison ? '4px' : '50%';
  const shadow = isConflict
    ? '0 0 8px 2px rgba(255,23,68,0.8)'
    : '0 2px 5px rgba(0,0,0,0.5)';
  const badge  = formatCount(count);

  return `
    <div class="hs-troops" style="
      position:absolute;
      left:${pos.left.toFixed(1)}%;
      top:${pos.top.toFixed(1)}%;
      transform:translate(-50%,-50%);
      z-index:3;
      pointer-events:auto;
    ">
      <div style="
        background:${bg};
        border:2px solid ${border};
        border-radius:${radius};
        width:22px;height:22px;
        display:flex;align-items:center;justify-content:center;
        font-size:11px;
        box-shadow:${shadow};
        cursor:pointer;
        user-select:none;
        position:relative;
      ">
        ${glyph}
        <span style="
          position:absolute;
          top:-5px;right:-7px;
          background:#222;color:#fff;
          font-size:7px;font-weight:bold;
          border-radius:3px;padding:0 2px;
          line-height:11px;white-space:nowrap;
          border:1px solid ${border};
        ">${badge}</span>
      </div>
    </div>`;
}

// ─── Core HTML builder ─────────────────────────────────────────────────────

/**
 * Builds the inner HTML for a hex stacker divIcon.
 *
 * New triangle layout:
 *   TOP          → Building icon
 *   BOTTOM-LEFT  → Own troops  (blue badge, if own_troops > 0)
 *   BOTTOM-RIGHT → Enemy troops (red badge,  if enemy_troops > 0)
 *
 * @param {Object}      opts
 * @param {Object|null} opts.building - { name, is_under_construction } or null
 * @param {Object|null} opts.units    - { own_troops, enemy_troops, is_conflict } or null
 * @returns {string} HTML string for L.divIcon
 */
export function createStackerHTML({ building = null, units = null } = {}) {
  const hasBuilding     = !!building;
  const ownCount        = units?.own_troops        ?? 0;
  const enemyCount      = units?.enemy_troops      ?? 0;
  const ownGarrisonOnly = !!(units?.own_garrison_only);
  const hasOwn          = ownCount   > 0;
  const hasEnemy        = enemyCount > 0;
  const hasTroops       = hasOwn || hasEnemy;
  const isConflict      = !!(units?.is_conflict);
  const hasFleet        = !!(units?.has_embarked_troops);

  if (!hasBuilding && !hasTroops && !hasFleet) return '';

  const parts = [];

  // ── Building (TOP) ────────────────────────────────────────────────────────
  if (hasBuilding) {
    const bldName  = building.name || building.building_name || '';
    const bldType  = building.type_name || '';
    const icon     = building.is_under_construction ? '🏗️' : getBuildingIconEmoji(bldName, bldType);
    const opacity = building.is_under_construction ? '0.65' : '1';
    const bBorder = building.is_under_construction ? '#c5a059' : '#9e9e9e';
    const bBg     = building.is_under_construction ? 'rgba(30,20,10,0.82)' : 'rgba(20,30,20,0.82)';
    const foodTag = !building.is_under_construction && isFoodBonusBuilding(bldName)
      ? '<span style="position:absolute;top:-4px;right:-5px;font-size:7px;">🌾</span>'
      : '';
    const turnsLeft = building.remaining_construction_turns ?? 0;
    const turnsTag  = building.is_under_construction && turnsLeft > 0
      ? `<span style="position:absolute;bottom:-6px;left:50%;transform:translateX(-50%);background:#222;color:#fff;font-size:7px;font-weight:700;border-radius:2px;padding:0 2px;line-height:11px;white-space:nowrap;border:1px solid ${bBorder};">${turnsLeft}t</span>`
      : '';
    const pos     = hasTroops ? POS.building : POS.buildingCenter;

    parts.push(`
      <div class="hs-building" style="
        position:absolute;
        left:${pos.left.toFixed(1)}%;
        top:${pos.top.toFixed(1)}%;
        transform:translate(-50%,-50%);
        z-index:2;
        opacity:${opacity};
        pointer-events:none;
      ">
        <div style="
          background:${bBg};
          border:1.5px solid ${bBorder};
          border-radius:4px;
          width:18px;height:18px;
          display:flex;align-items:center;justify-content:center;
          font-size:11px;
          box-shadow:0 1px 4px rgba(0,0,0,0.5);
          user-select:none;
          position:relative;
        ">${icon}${foodTag}${turnsTag}</div>
      </div>`);
  }

  // ── Fleet badge (TOP-RIGHT) ────────────────────────────────────────────────
  if (hasFleet) {
    const fleetBg     = '#0d47a1';
    const fleetBorder = '#64b5f6';
    parts.push(`
      <div style="
        position:absolute;
        right:0%;top:0%;
        transform:translate(30%,-30%);
        background:${fleetBg};
        border:1.5px solid ${fleetBorder};
        border-radius:50%;
        width:14px;height:14px;
        display:flex;align-items:center;justify-content:center;
        font-size:9px;
        box-shadow:0 1px 3px rgba(0,0,0,0.6);
        z-index:5;
        pointer-events:none;
      ">⚔️</div>`);
  }

  // ── Troop badges (BOTTOM-LEFT / BOTTOM-RIGHT) ─────────────────────────────
  if (hasTroops) {
    if (hasOwn && hasEnemy) {
      // Ambos → posiciones fijas de la base del triángulo
      parts.push(_troopBadge(ownCount,   'own',   POS.ownTroops,   isConflict, ownGarrisonOnly));
      parts.push(_troopBadge(enemyCount, 'enemy', POS.enemyTroops, isConflict, false));
    } else if (hasBuilding) {
      // Solo un tipo con edificio → posición base correspondiente
      if (hasOwn)   parts.push(_troopBadge(ownCount,   'own',   POS.ownTroops,   isConflict, ownGarrisonOnly));
      if (hasEnemy) parts.push(_troopBadge(enemyCount, 'enemy', POS.enemyTroops, isConflict, false));
    } else {
      // Sin edificio → tropos centradas o ligeramente desplazadas
      if (hasOwn && !hasEnemy) {
        parts.push(_troopBadge(ownCount, 'own', POS.troopsOnlyCenter, isConflict, ownGarrisonOnly));
      } else if (hasEnemy && !hasOwn) {
        parts.push(_troopBadge(enemyCount, 'enemy', POS.troopsOnlyCenter, isConflict, false));
      } else {
        parts.push(_troopBadge(ownCount,   'own',   POS.troopsSoloLeft,  isConflict, ownGarrisonOnly));
        parts.push(_troopBadge(enemyCount, 'enemy', POS.troopsSoloRight, isConflict, false));
      }
    }
  }

  return `<div class="hex-stacker" style="
    width:${W}px;height:${H}px;
    position:relative;
    pointer-events:none;
  ">${parts.join('')}</div>`;
}

/**
 * Creates a Leaflet DivIcon from stacker data.
 * The caller must pass the Leaflet `L` instance.
 *
 * @param {Object} L    - Leaflet
 * @param {Object} data - { building, units }
 * @returns {L.DivIcon}
 */
export function createStackerDivIcon(L, data) {
  return L.divIcon({
    html:       createStackerHTML(data),
    className:  'hex-stacker-icon',
    iconSize:   [W, H],
    iconAnchor: [W / 2, H / 2],
  });
}
