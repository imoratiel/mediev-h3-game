'use strict';

/**
 * SuspicionDetector.js
 *
 * Analiza las entradas recientes de audit.log y genera alertas en la tabla
 * suspicious_events cuando detecta patrones anómalos.
 *
 * Reglas implementadas:
 *  FAST_ACTIONS      — > 6 acciones WRITE de un mismo jugador en 30s
 *  HIGH_4XX_RATE     — > 15 respuestas 4xx de un jugador en 60s
 *  REPEATED_PAYLOAD  — misma acción + mismo meta.h3 3× en 10s (loop exacto)
 *  INHUMAN_TIMING    — intervalo < 150ms entre dos WRITE del mismo jugador
 *  LOGIN_BRUTE_WIN   — ≥ 4 status 401 seguidos de un 200 para misma IP
 *
 * Se ejecuta cada SCAN_INTERVAL_MS mediante setInterval.
 * Deduplicación: no inserta una nueva alerta si ya hay una sin revisar
 * para el mismo (player_id, rule) en los últimos 10 minutos.
 */

const fs   = require('fs');
const pool = require('../../db.js');
const { AUDIT_LOG_FILE } = require('../utils/logger');
const { Logger } = require('../utils/logger');

const SCAN_INTERVAL_MS = 30_000; // cada 30s
const WINDOW_FAST      = 30_000; // ventana para FAST_ACTIONS
const WINDOW_4XX       = 60_000; // ventana para HIGH_4XX_RATE
const WINDOW_REPEAT    = 10_000; // ventana para REPEATED_PAYLOAD
const DEDUP_WINDOW_MS  = 10 * 60_000; // 10 min sin duplicar la misma alerta

let _intervalId = null;

// ── Lector de ventana de audit.log ───────────────────────────────────────────

function readRecentEntries(windowMs) {
    if (!fs.existsSync(AUDIT_LOG_FILE)) return [];
    const cutoff = Date.now() - windowMs;
    const entries = [];
    try {
        const content = fs.readFileSync(AUDIT_LOG_FILE, 'utf8');
        for (const line of content.split('\n')) {
            if (!line.trim()) continue;
            try {
                const e = JSON.parse(line);
                if (new Date(e.ts).getTime() >= cutoff) entries.push(e);
            } catch { /* línea malformada, ignorar */ }
        }
    } catch { /* archivo en uso, ignorar */ }
    return entries;
}

// ── Inserción de alerta con deduplicación ─────────────────────────────────────

async function insertAlert({ player_id, username, rule, severity, details }) {
    try {
        const dedup = await pool.query(
            `SELECT id FROM suspicious_events
             WHERE player_id = $1 AND rule = $2 AND reviewed_at IS NULL
               AND created_at > NOW() - INTERVAL '10 minutes'`,
            [player_id, rule]
        );
        if (dedup.rows.length > 0) return; // ya existe sin revisar, no duplicar

        await pool.query(
            `INSERT INTO suspicious_events (player_id, username, rule, severity, details)
             VALUES ($1, $2, $3, $4, $5)`,
            [player_id, username || '', rule, severity, JSON.stringify(details)]
        );
        Logger.engine(`[SuspicionDetector] Alerta ${severity.toUpperCase()} — ${rule} pid:${player_id}`);
    } catch (err) {
        Logger.error(err, { context: 'SuspicionDetector.insertAlert', rule, player_id });
    }
}

// ── Reglas ────────────────────────────────────────────────────────────────────

async function checkFastActions(entries) {
    const byPlayer = {};
    for (const e of entries) {
        if (!e.pid) continue;
        if (!byPlayer[e.pid]) byPlayer[e.pid] = { count: 0, un: e.un, times: [] };
        byPlayer[e.pid].count++;
        byPlayer[e.pid].times.push(e.ts);
    }
    for (const [pid, data] of Object.entries(byPlayer)) {
        if (data.count > 6) {
            await insertAlert({
                player_id: parseInt(pid), username: data.un,
                rule: 'FAST_ACTIONS', severity: 'high',
                details: { count: data.count, window_s: 30, first: data.times[0], last: data.times.at(-1) },
            });
        }
    }
}

async function checkHigh4xxRate(entries) {
    const all = readRecentEntries(WINDOW_4XX);
    const byPlayer = {};
    for (const e of all) {
        if (!e.pid || !e.status) continue;
        if (e.status < 400 || e.status >= 500) continue;
        if (!byPlayer[e.pid]) byPlayer[e.pid] = { count: 0, un: e.un };
        byPlayer[e.pid].count++;
    }
    for (const [pid, data] of Object.entries(byPlayer)) {
        if (data.count > 15) {
            await insertAlert({
                player_id: parseInt(pid), username: data.un,
                rule: 'HIGH_4XX_RATE', severity: 'medium',
                details: { count: data.count, window_s: 60 },
            });
        }
    }
}

async function checkRepeatedPayload(entries) {
    const all = readRecentEntries(WINDOW_REPEAT);
    // Clave: pid:action:h3
    const seen = {};
    for (const e of all) {
        if (!e.pid) continue;
        const key = `${e.pid}:${e.action}:${e.meta?.h3 || ''}`;
        if (!seen[key]) seen[key] = { count: 0, un: e.un, action: e.action, h3: e.meta?.h3 };
        seen[key].count++;
    }
    for (const [key, data] of Object.entries(seen)) {
        if (data.count >= 3 && data.h3) {
            const pid = parseInt(key.split(':')[0]);
            await insertAlert({
                player_id: pid, username: data.un,
                rule: 'REPEATED_PAYLOAD', severity: 'high',
                details: { count: data.count, action: data.action, h3: data.h3, window_s: 10 },
            });
        }
    }
}

async function checkInhumanTiming(entries) {
    const byPlayer = {};
    for (const e of entries) {
        if (!e.pid) continue;
        if (!byPlayer[e.pid]) byPlayer[e.pid] = { un: e.un, times: [] };
        byPlayer[e.pid].times.push(new Date(e.ts).getTime());
    }
    for (const [pid, data] of Object.entries(byPlayer)) {
        const sorted = data.times.sort((a, b) => a - b);
        for (let i = 1; i < sorted.length; i++) {
            const gap = sorted[i] - sorted[i - 1];
            if (gap < 150) {
                await insertAlert({
                    player_id: parseInt(pid), username: data.un,
                    rule: 'INHUMAN_TIMING', severity: 'high',
                    details: { gap_ms: gap, ts_a: new Date(sorted[i-1]).toISOString(), ts_b: new Date(sorted[i]).toISOString() },
                });
                break; // una alerta por jugador por ciclo
            }
        }
    }
}

async function checkLoginBruteWin() {
    // Esta regla opera sobre el audit.log de autenticaciones (status 401/200)
    const all = readRecentEntries(5 * 60_000); // últimos 5 minutos
    const authEntries = all.filter(e => e.endpoint?.includes('/auth/login'));
    const byIp = {};
    for (const e of authEntries) {
        const ip = e.ip || 'unknown';
        if (!byIp[ip]) byIp[ip] = [];
        byIp[ip].push(e);
    }
    for (const [ip, evts] of Object.entries(byIp)) {
        const sorted = evts.sort((a, b) => new Date(a.ts) - new Date(b.ts));
        let failStreak = 0;
        for (const e of sorted) {
            if (e.status === 401) {
                failStreak++;
            } else if (e.status === 200 && failStreak >= 4) {
                await insertAlert({
                    player_id: e.pid || null, username: e.un || '',
                    rule: 'LOGIN_BRUTE_WIN', severity: 'high',
                    details: { ip, fail_count: failStreak, success_ts: e.ts },
                });
                failStreak = 0;
            } else {
                failStreak = 0;
            }
        }
    }
}

// ── Ciclo principal ───────────────────────────────────────────────────────────

async function runScan() {
    const entries = readRecentEntries(WINDOW_FAST);
    if (entries.length === 0) return;
    await Promise.all([
        checkFastActions(entries),
        checkHigh4xxRate(entries),
        checkRepeatedPayload(entries),
        checkInhumanTiming(entries),
        checkLoginBruteWin(),
    ]);
}

function start() {
    if (_intervalId) return;
    _intervalId = setInterval(() => {
        runScan().catch(err => Logger.error(err, { context: 'SuspicionDetector.runScan' }));
    }, SCAN_INTERVAL_MS);
    Logger.engine('[SuspicionDetector] Iniciado — escaneando cada 30s');
}

function stop() {
    if (_intervalId) { clearInterval(_intervalId); _intervalId = null; }
}

module.exports = { start, stop, runScan };
