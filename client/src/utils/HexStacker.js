/**
 * HexStacker.js
 *
 * Generates combined Leaflet divIcon HTML for map hexagons.
 * Shows three layers of information in a triangular layout:
 *
 *   TOP           (center-top)  → Building icon
 *   BOTTOM-LEFT                 → Own entities  (troops, characters, workers) — navigable if > 1
 *   BOTTOM-RIGHT                → Enemy entities (troops, enemy characters)   — navigable if > 1
 *
 * Entity object shapes passed in ownEntities / enemyEntities arrays:
 *   { type: 'troops', count, isGarrisonOnly }
 *   { type: 'fleet',  count }
 *   { type: 'char',   id, name, is_main_character, is_heir }
 *   { type: 'worker', h3_index, worker_count, worker_type }
 */

// ─── Container geometry ────────────────────────────────────────────────────
const W  = 80;   // icon width  (px) — wider to accommodate nav arrows
const H  = 56;   // icon height (px)
const CX = W / 2; // 40
const CY = H / 2; // 28
const R  = 26;    // abstract hex radius for triangle maths

// Percentage positions for each slot (element centered via translate(-50%,-50%))
const POS = {
  // TOP — building icon (always centered horizontally)
  building: {
    left: 50,
    top:  ((CY - R * 0.5) / H) * 100,   // ~26.8 %
  },
  // TOP centered — building alone (no entities)
  buildingCenter: {
    left: 50,
    top:  44,
  },
  // BOTTOM-LEFT — own entities slot
  ownSlot: {
    left: ((CX - R * 0.7) / W) * 100,   // ~27.25 %  (~21.8 px from left)
    top:  ((CY + R * 0.3) / H) * 100,   // ~63.9 %
  },
  // BOTTOM-RIGHT — enemy entities slot
  enemySlot: {
    left: ((CX + R * 0.7) / W) * 100,   // ~72.75 %  (~58.2 px from left)
    top:  ((CY + R * 0.3) / H) * 100,
  },
  // Center / split positions used when there is no building
  soloCenter: { left: 50, top: 50 },
  soloLeft:   { left: ((CX - R * 0.35) / W) * 100, top: 50 },
  soloRight:  { left: ((CX + R * 0.35) / W) * 100, top: 50 },
};

// ─── Navigation state ──────────────────────────────────────────────────────
/**
 * Persistent nav index per hex-slot.
 * Key: `${h3Index}_left`  | `${h3Index}_right`
 * Value: 0-based current index (number)
 */
export const hexNavState = new Map();

export function getNavIdx(h3, side) {
  return hexNavState.get(`${h3}_${side}`) ?? 0;
}

export function advanceNavIdx(h3, side, dir, count) {
  const key  = `${h3}_${side}`;
  const cur  = hexNavState.get(key) ?? 0;
  const next = (cur + dir + count) % count;
  hexNavState.set(key, next);
  return next;
}

export function resetNavState(h3) {
  hexNavState.delete(`${h3}_left`);
  hexNavState.delete(`${h3}_right`);
}

// ─── Building icon helpers ─────────────────────────────────────────────────
const BUILDING_ICON_MAP = [
  [['granja', 'farm'],                                              '🌾'],
  [['cuartel', 'barrack', 'escuela', 'militar', 'military'],        '🏰'],
  [['iglesia', 'church', 'catedral', 'templo', 'santuario'],        '🏛️'],
  [['mercado', 'market', 'foro', 'lonja', 'factor', 'feria'],       '⚖️'],
  [['castellum', 'fortaleza', 'fortress', 'castillo'],              '🏰'],
  [['astillero', 'shipyard', 'portus', 'cothon', 'emporio', 'embarcadero'], '⛵'],
  [['mina', 'mine'],                                                '⛏️'],
  [['aserradero', 'lumber', 'madera'],                              '🌲'],
  [['torre', 'tower'],                                              '🏯'],
];

/**
 * Returns an emoji icon for a building by name.
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

function isFoodBonusBuilding(name = '') {
  const n = name.toLowerCase();
  return n.includes('mercado') || n.includes('market') ||
         n.includes('iglesia') || n.includes('church')  ||
         n.includes('templo');
}

function formatCount(n) {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

// ─── Entity badge renderers ────────────────────────────────────────────────

function _troopsBadge(entity, isEnemy, isConflict) {
  const { count, isGarrisonOnly } = entity;
  const isGarrison = isGarrisonOnly && !isEnemy;
  const bg     = isGarrison ? '#2a3f5f'  : (isEnemy ? '#b71c1c' : '#1565C0');
  const border = isGarrison ? '#607d9e'  : (isEnemy ? '#ef5350' : '#42a5f5');
  const glyph  = isGarrison ? '🏰' : (count > 1 ? '⚔️' : '🗡️');
  const radius = isGarrison ? '4px' : '50%';
  const shadow = isConflict
    ? '0 0 8px 2px rgba(255,23,68,0.8)'
    : '0 2px 5px rgba(0,0,0,0.5)';
  const badge  = formatCount(count);

  return `<div class="hs-entity hs-troops" style="background:${bg};border:2px solid ${border};border-radius:${radius};width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:11px;box-shadow:${shadow};cursor:pointer;user-select:none;">${glyph}</div>`;
}

function _charBadge(entity, isEnemy) {
  const glyph  = isEnemy ? '🧑' : (entity.is_main_character ? '👑' : entity.is_heir ? '🤴' : '⭐');
  const bg     = isEnemy ? '#7f1d1d' : '#14532d';
  const border = isEnemy ? '#ef4444' : '#4ade80';
  return `<div class="hs-entity hs-char" data-char-id="${entity.id}" data-is-enemy="${isEnemy ? '1' : '0'}" style="background:${bg};border:2px solid ${border};border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:11px;box-shadow:0 2px 5px rgba(0,0,0,0.5);cursor:pointer;user-select:none;">${glyph}</div>`;
}

function _workerBadge(entity) {
  const bg     = '#451a03';
  const border = '#f59e0b';
  const badge  = entity.worker_count > 1 ? formatCount(entity.worker_count) : '';
  const counter = badge
    ? `<span style="position:absolute;top:-5px;right:-7px;background:#222;color:#fff;font-size:7px;font-weight:bold;border-radius:3px;padding:0 2px;line-height:11px;white-space:nowrap;border:1px solid ${border};">${badge}</span>`
    : '';
  return `<div class="hs-entity hs-worker" data-worker-h3="${entity.h3_index}" style="background:${bg};border:2px solid ${border};border-radius:4px;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:11px;box-shadow:0 2px 5px rgba(0,0,0,0.5);cursor:pointer;user-select:none;position:relative;">⛏️${counter}</div>`;
}

function _fleetBadge(entity, isEnemy) {
  const bg     = isEnemy ? '#b71c1c' : '#1a4a8a';
  const border = isEnemy ? '#ef5350' : '#4a9eff';
  return `<div class="hs-entity hs-fleet" style="background:${bg};border:2px solid ${border};border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:12px;box-shadow:0 2px 5px rgba(0,0,0,0.5);cursor:pointer;user-select:none;">⛵</div>`;
}

function _entityBadge(entity, isEnemy, isConflict) {
  if (entity.type === 'troops') return _troopsBadge(entity, isEnemy, isConflict);
  if (entity.type === 'fleet')  return _fleetBadge(entity, isEnemy);
  if (entity.type === 'char')   return _charBadge(entity, isEnemy);
  if (entity.type === 'worker') return _workerBadge(entity);
  return '';
}

// ─── Slot HTML (single entity or navigable multi-entity) ──────────────────

function _slotHTML(entities, pos, h3Index, side, navIdx, isConflict) {
  if (!entities || entities.length === 0) return '';
  const isEnemy = side === 'right';
  const count   = entities.length;
  const cur     = entities[navIdx % count];
  const badge   = _entityBadge(cur, isEnemy, isConflict);

  if (count === 1) {
    return `<div style="position:absolute;left:${pos.left.toFixed(1)}%;top:${pos.top.toFixed(1)}%;transform:translate(-50%,-50%);z-index:3;pointer-events:auto;">${badge}</div>`;
  }

  // Multiple entities: show ◀ / ▶ nav arrows
  const arw = 'background:rgba(0,0,0,0.65);color:#ccc;border:none;border-radius:2px;width:8px;height:22px;font-size:5px;cursor:pointer;padding:0;line-height:1;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
  return `<div style="position:absolute;left:${pos.left.toFixed(1)}%;top:${pos.top.toFixed(1)}%;transform:translate(-50%,-50%);z-index:3;pointer-events:auto;display:flex;align-items:center;gap:1px;"><button class="hs-nav-btn" data-h3="${h3Index}" data-side="${side}" data-dir="-1" data-count="${count}" style="${arw}">◀</button><div style="position:relative;">${badge}</div><button class="hs-nav-btn" data-h3="${h3Index}" data-side="${side}" data-dir="1" data-count="${count}" style="${arw}">▶</button></div>`;
}

// ─── Core HTML builder ─────────────────────────────────────────────────────

/**
 * Builds the inner HTML for a hex stacker divIcon.
 *
 * @param {Object}      opts
 * @param {Object|null} opts.building       - { name, is_under_construction, ... } or null
 * @param {Array}       opts.ownEntities    - own player entities (troops, chars, workers)
 * @param {Array}       opts.enemyEntities  - enemy entities (troops, chars)
 * @param {string}      opts.h3Index        - hex cell index (for nav keys)
 * @param {number}      opts.ownNavIdx      - current own-slot nav index
 * @param {number}      opts.enemyNavIdx    - current enemy-slot nav index
 * @param {boolean}     opts.isConflict     - own troops AND enemy troops present
 * @param {boolean}     opts.hasFleet       - show embarked-troops fleet badge
 * @returns {string} HTML string for L.divIcon
 */
export function createStackerHTML({
  building     = null,
  ownEntities  = [],
  enemyEntities = [],
  h3Index      = '',
  ownNavIdx    = 0,
  enemyNavIdx  = 0,
  isConflict   = false,
  hasFleet     = false,
} = {}) {
  const hasBuilding = !!building;
  const hasOwn      = ownEntities.length  > 0;
  const hasEnemy    = enemyEntities.length > 0;
  const hasEntities = hasOwn || hasEnemy;

  if (!hasBuilding && !hasEntities && !hasFleet) return '';

  const parts = [];

  // ── Building (TOP) ────────────────────────────────────────────────────────
  if (hasBuilding) {
    const bldName  = building.name || building.building_name || '';
    const bldType  = building.type_name || '';
    const icon     = building.is_under_construction ? '🏗️' : getBuildingIconEmoji(bldName, bldType);
    const opacity  = building.is_under_construction ? '0.65' : '1';
    const bBorder  = building.is_under_construction ? '#c5a059' : '#9e9e9e';
    const bBg      = building.is_under_construction ? 'rgba(30,20,10,0.82)' : 'rgba(20,30,20,0.82)';
    const foodTag  = !building.is_under_construction && isFoodBonusBuilding(bldName)
      ? '<span style="position:absolute;top:-4px;right:-5px;font-size:7px;">🌾</span>'
      : '';
    const turnsLeft = building.remaining_construction_turns ?? 0;
    const turnsTag  = building.is_under_construction && turnsLeft > 0
      ? `<span style="position:absolute;bottom:-6px;left:50%;transform:translateX(-50%);background:#222;color:#fff;font-size:7px;font-weight:700;border-radius:2px;padding:0 2px;line-height:11px;white-space:nowrap;border:1px solid ${bBorder};">${turnsLeft}t</span>`
      : '';
    const pos = hasEntities ? POS.building : POS.buildingCenter;

    parts.push(`<div class="hs-building" style="position:absolute;left:${pos.left.toFixed(1)}%;top:${pos.top.toFixed(1)}%;transform:translate(-50%,-50%);z-index:2;opacity:${opacity};pointer-events:none;"><div style="background:${bBg};border:1.5px solid ${bBorder};border-radius:4px;width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-size:11px;box-shadow:0 1px 4px rgba(0,0,0,0.5);user-select:none;position:relative;">${icon}${foodTag}${turnsTag}</div></div>`);
  }

  // ── Fleet badge (TOP-RIGHT corner) ────────────────────────────────────────
  if (hasFleet) {
    parts.push(`<div style="position:absolute;right:0%;top:0%;transform:translate(30%,-30%);background:#0d47a1;border:1.5px solid #64b5f6;border-radius:50%;width:14px;height:14px;display:flex;align-items:center;justify-content:center;font-size:9px;box-shadow:0 1px 3px rgba(0,0,0,0.6);z-index:5;pointer-events:none;">⚔️</div>`);
  }

  // ── Entity slots (BOTTOM-LEFT own / BOTTOM-RIGHT enemy) ───────────────────
  if (hasOwn && hasEnemy) {
    parts.push(_slotHTML(ownEntities,   POS.ownSlot,   h3Index, 'left',  ownNavIdx,   isConflict));
    parts.push(_slotHTML(enemyEntities, POS.enemySlot, h3Index, 'right', enemyNavIdx, isConflict));
  } else if (hasBuilding) {
    if (hasOwn)   parts.push(_slotHTML(ownEntities,   POS.ownSlot,   h3Index, 'left',  ownNavIdx,   isConflict));
    if (hasEnemy) parts.push(_slotHTML(enemyEntities, POS.enemySlot, h3Index, 'right', enemyNavIdx, isConflict));
  } else {
    // No building — center or split
    if (hasOwn && !hasEnemy) {
      parts.push(_slotHTML(ownEntities, POS.soloCenter, h3Index, 'left', ownNavIdx, isConflict));
    } else if (hasEnemy && !hasOwn) {
      parts.push(_slotHTML(enemyEntities, POS.soloCenter, h3Index, 'right', enemyNavIdx, isConflict));
    } else {
      parts.push(_slotHTML(ownEntities,   POS.soloLeft,  h3Index, 'left',  ownNavIdx,   isConflict));
      parts.push(_slotHTML(enemyEntities, POS.soloRight, h3Index, 'right', enemyNavIdx, isConflict));
    }
  }

  return `<div class="hex-stacker" style="width:${W}px;height:${H}px;position:relative;pointer-events:none;">${parts.join('')}</div>`;
}

/**
 * Creates a Leaflet DivIcon from stacker data.
 * Reads current nav indices from hexNavState automatically.
 *
 * @param {Object} L    - Leaflet instance
 * @param {Object} data - { building, ownEntities, enemyEntities, h3Index, isConflict, hasFleet }
 * @returns {L.DivIcon}
 */
export function createStackerDivIcon(L, data) {
  const h3Index   = data.h3Index ?? '';
  const ownNavIdx   = getNavIdx(h3Index, 'left');
  const enemyNavIdx = getNavIdx(h3Index, 'right');
  return L.divIcon({
    html:       createStackerHTML({ ...data, ownNavIdx, enemyNavIdx }),
    className:  'hex-stacker-icon',
    iconSize:   [W, H],
    iconAnchor: [W / 2, H / 2],
  });
}
