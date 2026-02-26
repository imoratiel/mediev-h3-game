/**
 * HexStacker.js
 *
 * Generates combined Leaflet divIcon HTML for map hexagons.
 * Shows three layers of information (Owner, Building, Troops) in a
 * triangular layout so they don't overlap each other.
 *
 * Triangle layout (relative to icon center):
 *   TOP           (0,    -R*0.5)  → Troops count badge
 *   BOTTOM-LEFT   (-R*0.4, R*0.3) → Building icon
 *   BOTTOM-RIGHT  (+R*0.4, R*0.3) → Owner color dot
 *
 * When no building is present, troops shift to center.
 */

// ─── Container geometry ────────────────────────────────────────────────────
const W  = 64;   // icon width  (px)
const H  = 56;   // icon height (px)
const CX = W / 2; // 32
const CY = H / 2; // 28
const R  = 26;    // abstract hex radius for triangle maths

// Percentage positions for each slot (element centered via translate(-50%,-50%))
const POS = {
  // TOP — troops with building present
  troopsTop: {
    left: (CX / W) * 100,                     // 50 %
    top:  ((CY - R * 0.5) / H) * 100,         // ~26.8 %
  },
  // CENTER — troops when no building
  troopsCenter: {
    left: 50,
    top:  50,
  },
  // BOTTOM-LEFT — building icon
  building: {
    left: ((CX - R * 0.4) / W) * 100,         // ~33.75 %
    top:  ((CY + R * 0.3) / H) * 100,         // ~63.9 %
  },
  // BOTTOM-RIGHT — owner dot
  owner: {
    left: ((CX + R * 0.4) / W) * 100,         // ~66.25 %
    top:  ((CY + R * 0.3) / H) * 100,         // ~63.9 %
  },
};

// ─── Icon helpers ──────────────────────────────────────────────────────────

const BUILDING_ICON_MAP = [
  [['granja', 'farm'],                           '🌾'],
  [['cuartel', 'barrack', 'militar', 'military'], '⚔️'],
  [['iglesia', 'church', 'catedral', 'templo'],  '⛪'],
  [['mercado', 'market'],                        '🏪'],
  [['fortaleza', 'fortress', 'castillo'],        '🏯'],
  [['astillero', 'shipyard'],                    '⛵'],
  [['mina', 'mine'],                             '⛏️'],
  [['aserradero', 'lumber', 'madera'],           '🌲'],
  [['torre', 'tower'],                           '🗼'],
];

/**
 * Returns an emoji icon for a building by name.
 * @param {string} name - building name or type name
 * @returns {string} emoji
 */
export function getBuildingIconEmoji(name = '') {
  const n = name.toLowerCase();
  for (const [keywords, icon] of BUILDING_ICON_MAP) {
    if (keywords.some(k => n.includes(k))) return icon;
  }
  return '🏛️';
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

// ─── Core HTML builder ─────────────────────────────────────────────────────

/**
 * Builds the inner HTML for a hex stacker divIcon.
 *
 * @param {Object} opts
 * @param {Object|null} opts.owner    - { color: "#rrggbb" } or null
 * @param {Object|null} opts.building - { name, is_under_construction } or null
 * @param {Object|null} opts.units    - { total_troops, has_enemy, is_conflict } or null
 * @returns {string} HTML string for L.divIcon
 */
export function createStackerHTML({ owner = null, building = null, units = null } = {}) {
  const hasBuilding = !!building;
  const hasUnits    = !!(units && units.total_troops > 0);
  const hasOwner    = !!(owner && owner.color);

  if (!hasBuilding && !hasUnits && !hasOwner) return '';

  const parts = [];

  // ── Troops ──────────────────────────────────────────────────────────────
  if (hasUnits) {
    const pos    = hasBuilding ? POS.troopsTop : POS.troopsCenter;
    const glyph  = units.total_troops > 1 ? '⚔️' : '🗡️';
    const bg     = units.has_enemy ? '#b71c1c' : '#1565C0';
    const border = units.has_enemy ? '#ef5350' : '#42a5f5';
    const shadow = units.is_conflict
      ? '0 0 8px 2px rgba(255,23,68,0.8)'
      : '0 2px 5px rgba(0,0,0,0.5)';
    const badge  = formatCount(units.total_troops);

    parts.push(`
      <div class="hs-troops" style="
        position:absolute;
        left:${pos.left.toFixed(1)}%;
        top:${pos.top.toFixed(1)}%;
        transform:translate(-50%,-50%);
        z-index:3;
        pointer-events:auto;
        transition:left 0.3s ease,top 0.3s ease;
      ">
        <div style="
          background:${bg};
          border:2px solid ${border};
          border-radius:50%;
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
      </div>`);
  }

  // ── Building ─────────────────────────────────────────────────────────────
  if (hasBuilding) {
    const bldName = building.name || building.building_name || '';
    const icon    = building.is_under_construction ? '🏗️' : getBuildingIconEmoji(bldName);
    const opacity = building.is_under_construction ? '0.65' : '1';
    const bBorder = building.is_under_construction ? '#c5a059' : '#9e9e9e';
    const bBg     = building.is_under_construction ? 'rgba(30,20,10,0.82)' : 'rgba(20,30,20,0.82)';
    const foodTag = !building.is_under_construction && isFoodBonusBuilding(bldName)
      ? '<span style="position:absolute;top:-4px;right:-5px;font-size:7px;">🌾</span>'
      : '';

    parts.push(`
      <div class="hs-building" style="
        position:absolute;
        left:${POS.building.left.toFixed(1)}%;
        top:${POS.building.top.toFixed(1)}%;
        transform:translate(-50%,-50%);
        z-index:2;
        opacity:${opacity};
        pointer-events:none;
        transition:opacity 0.2s;
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
        ">${icon}${foodTag}</div>
      </div>`);
  }

  // ── Owner dot ────────────────────────────────────────────────────────────
  if (hasOwner) {
    parts.push(`
      <div class="hs-owner" style="
        position:absolute;
        left:${POS.owner.left.toFixed(1)}%;
        top:${POS.owner.top.toFixed(1)}%;
        transform:translate(-50%,-50%);
        z-index:2;
        pointer-events:none;
      ">
        <div style="
          width:12px;height:12px;
          border-radius:50%;
          background:${owner.color};
          border:1.5px solid rgba(255,255,255,0.75);
          box-shadow:0 1px 3px rgba(0,0,0,0.55);
          user-select:none;
        "></div>
      </div>`);
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
 * @param {Object} data - { owner, building, units }
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
