'use strict';

/**
 * auditLogger.js
 *
 * Middleware que registra acciones de escritura de jugadores en audit.log (JSON Lines).
 * - Solo actúa en métodos de escritura (POST, PUT, PATCH, DELETE) de rutas autenticadas.
 * - Se activa/desactiva desde el panel de admin sin reiniciar el servidor.
 * - El flag persiste en game_config (group='system', key='player_audit_enabled').
 */

const { logAudit, getAuditLogSizeKb } = require('../utils/logger');
const pool = require('../../db.js');

// Categorías de acción derivadas del endpoint
const ACTION_MAP = [
    { pattern: /\/military\/conquer/,    action: 'CONQUER'    },
    { pattern: /\/military\/attack/,     action: 'ATTACK'     },
    { pattern: /\/military\/recruit/,    action: 'RECRUIT'    },
    { pattern: /\/military\/move-army/,  action: 'ARMY_MOVE'  },
    { pattern: /\/military\/merge/,      action: 'ARMY_MERGE' },
    { pattern: /\/military\/dismiss/,    action: 'DISMISS'    },
    { pattern: /\/military\/reinforce/,  action: 'REINFORCE'  },
    { pattern: /\/game\/claim/,          action: 'CLAIM'      },
    { pattern: /\/territory\//,          action: 'CONSTRUCT'  },
    { pattern: /\/economy\//,            action: 'ECONOMY'    },
    { pattern: /\/workers\/buy/,         action: 'HIRE_WORKER'},
    { pattern: /\/characters\//,         action: 'CHARACTER'  },
    { pattern: /\/relations\//,          action: 'DIPLOMACY'  },
    { pattern: /\/naval\//,              action: 'NAVAL'      },
    { pattern: /\/market\//,             action: 'MARKET'     },
];

function resolveAction(endpoint) {
    for (const { pattern, action } of ACTION_MAP) {
        if (pattern.test(endpoint)) return action;
    }
    return 'OTHER';
}

// ── Estado en memoria ─────────────────────────────────────────────────────────
let _enabled = false;

async function loadAuditFlag() {
    try {
        const res = await pool.query(
            `SELECT value FROM game_config WHERE "group" = 'system' AND "key" = 'player_audit_enabled'`
        );
        _enabled = res.rows[0]?.value === 'true';
    } catch {
        _enabled = false;
    }
}

async function setAuditEnabled(enabled) {
    _enabled = !!enabled;
    await pool.query(
        `INSERT INTO game_config ("group", "key", "value")
         VALUES ('system', 'player_audit_enabled', $1)
         ON CONFLICT ("group", "key") DO UPDATE SET value = $1`,
        [_enabled ? 'true' : 'false']
    );
}

function getAuditStatus() {
    return {
        enabled:      _enabled,
        log_size_kb:  getAuditLogSizeKb(),
    };
}

// ── Middleware ────────────────────────────────────────────────────────────────
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function auditMiddleware(req, res, next) {
    if (!_enabled || !WRITE_METHODS.has(req.method) || !req.user) return next();

    const started = Date.now();
    const originalJson = res.json.bind(res);

    res.json = function (body) {
        const ms     = Date.now() - started;
        const status = res.statusCode;
        if (status < 500) {
            const entry = {
                ts:       new Date().toISOString(),
                pid:      req.user.player_id,
                un:       req.user.username || '',
                ip:       req.ip || req.headers['x-forwarded-for'] || '',
                action:   resolveAction(req.path),
                endpoint: `${req.method} ${req.path}`,
                status,
                ms,
                meta:     buildMeta(req),
            };
            logAudit(entry);
        }
        return originalJson(body);
    };

    next();
}

function buildMeta(req) {
    const body = req.body || {};
    const meta = {};
    if (body.h3_index)     meta.h3  = body.h3_index;
    if (body.army_id)      meta.army = body.army_id;
    if (body.unit_type_id) meta.unit = body.unit_type_id;
    if (body.quantity)     meta.qty  = body.quantity;
    if (req.params?.h3_index) meta.h3 = req.params.h3_index;
    if (req.params?.id)    meta.id   = req.params.id;
    return meta;
}

module.exports = { auditMiddleware, setAuditEnabled, getAuditStatus, loadAuditFlag };
