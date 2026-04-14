/**
 * AIProxyService.js
 *
 * Capa de abstracción entre AIManagerService y los proveedores de IA externos.
 * Gestiona el presupuesto de tokens, el cambio de proveedor y el fallback procedural.
 *
 * Flujo:
 *   1. checkAvailability()  → lee global_settings (caché 30s) + verifica presupuesto
 *   2. requestDecision()    → construye prompt → llama proveedor → parsea acción → registra uso
 *   3. En cualquier error   → fallback procedural automático con log ⚠️
 *
 * Variables de entorno requeridas (solo si provider != 'procedural'):
 *   GEMINI_API_KEY  — clave API de Google Gemini
 *   OPENAI_API_KEY  — clave API de OpenAI
 *   GROQ_API_KEY    — clave API de Groq (llama-3.1-8b-instant, free tier generoso)
 */

'use strict';

const pool       = require('../../db.js');
const { Logger } = require('../utils/logger');

// ── Costes por 1M de tokens (USD) ────────────────────────────────────────────
const MODEL_COSTS = {
    'gemini-2.0-flash':      { input: 0.10,  output: 0.40 },
    'gpt-4o-mini':           { input: 0.150, output: 0.60 },
    'llama-3.1-8b-instant':  { input: 0.05,  output: 0.08 },
};

const VALID_PROVIDERS = ['procedural', 'gemini', 'openai', 'groq'];

class AIProxyService {

    constructor() {
        this._settingsCache = null;
        this._cacheExpiry   = 0;
        this._CACHE_TTL_MS  = 30_000; // 30 segundos
        // Last API error per provider — cleared on success, persisted in memory across calls
        this._lastApiError  = null; // { provider, message, timestamp }

        // ── Rate limiter en memoria (protege contra ráfagas con múltiples bots) ──
        // Groq free tier: 30 RPM. Gemini: 15 RPM. OpenAI varía.
        // Por defecto 25 RPM (conservador para Groq, suficiente para los demás).
        this._MAX_RPM         = parseInt(process.env.AI_MAX_RPM || '25', 10);
        this._callsThisWindow = 0;
        this._windowStart     = Date.now();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PÚBLICO: Disponibilidad y decisión
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Verifica si el proveedor de IA está activo y dentro del presupuesto.
     * Usa caché para no consultar la BD en cada turno.
     * @returns {Promise<{ available: boolean, provider: string, reason?: string }>}
     */
    async checkAvailability() {
        const settings = await this._getSettings();

        if (settings.ai_enabled !== 'true') {
            return { available: false, provider: 'procedural', reason: 'disabled' };
        }

        if (!settings.ai_provider || settings.ai_provider === 'procedural') {
            return { available: false, provider: 'procedural', reason: 'procedural_mode' };
        }

        // Verificar presupuesto total de tokens
        const budgetResult = await pool.query(
            'SELECT COALESCE(SUM(total_tokens), 0)::int AS total FROM ai_usage_stats'
        );
        const totalTokens = parseInt(budgetResult.rows[0].total) || 0;
        const maxBudget   = parseInt(settings.max_token_budget) || 100_000;

        if (totalTokens >= maxBudget) {
            Logger.engine(
                `⚠️ [AI PROXY] Presupuesto agotado (${totalTokens.toLocaleString()}/${maxBudget.toLocaleString()} tokens). Activando modo Procedural.`
            );
            return {
                available: false, provider: 'procedural', reason: 'budget_exceeded',
                totalTokens, maxBudget,
            };
        }

        return { available: true, provider: settings.ai_provider, totalTokens, maxBudget };
    }

    /**
     * Solicita una decisión de acción para un bot.
     * Si el proveedor falla o la respuesta es inválida, devuelve modo 'procedural'.
     *
     * @param {number} botId    - player_id del agente IA
     * @param {string} profile  - 'farmer' | 'expansionist' | 'balanced'
     * @param {Object} context  - Estado del reino (snapshot de _*Analysis)
     * @param {number} turn
     * @returns {Promise<{ mode: 'procedural'|'ai', action?: Object }>}
     */
    async requestDecision(botId, profile, context, turn) {
        const { available, provider } = await this.checkAvailability();

        if (!available) {
            return { mode: 'procedural' };
        }

        // Protección contra ráfagas: si se ha superado el límite de RPM configurado,
        // este bot usa lógica procedural en el turno actual sin gastar cuota.
        if (!this._checkRateLimit()) {
            Logger.engine(
                `⚠️ [AI PROXY] Rate limit local (${this._MAX_RPM} RPM). Bot ${botId} usa Procedural este turno.`
            );
            return { mode: 'procedural' };
        }

        try {
            const prompt = this._buildPrompt(profile, context, turn);
            let response;

            if (provider === 'gemini') {
                response = await this._callGemini(prompt);
            } else if (provider === 'openai') {
                response = await this._callOpenAI(prompt);
            } else if (provider === 'groq') {
                response = await this._callGroq(prompt, botId);
            } else {
                return { mode: 'procedural' };
            }

            await this._logUsage(botId, provider, response.inputTokens, response.outputTokens);

            const action = this._parseAction(response.text);
            if (!action) {
                this._setApiError(provider, 'Respuesta inválida del modelo (no se recibió JSON de acción)');
                Logger.engine(`⚠️ [AI PROXY] Respuesta inválida de ${provider} para bot ${botId}. Usando Procedural.`);
                return { mode: 'procedural' };
            }

            // Llamada exitosa — limpiar error previo
            this._clearApiError();
            Logger.engine(`[AI PROXY] Bot ${botId} (${profile}) → ${action.action} via ${provider} [${response.inputTokens + response.outputTokens} tokens]`);
            return { mode: 'ai', action };

        } catch (err) {
            this._setApiError(provider, err.message);
            Logger.engine(`⚠️ [AI PROXY] Error en ${provider} (bot ${botId}, turno ${turn}): ${err.message}. Usando Procedural.`);
            return { mode: 'procedural' };
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PÚBLICO: Gestión de configuración y estadísticas
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Lee todas las global_settings como objeto key→value.
     * @returns {Promise<Object>}
     */
    async getSettings() {
        return this._getSettings();
    }

    /**
     * Actualiza o inserta un valor en global_settings.
     * Invalida la caché local.
     * @param {string} key
     * @param {string} value
     */
    async setSetting(key, value) {
        await pool.query(
            `INSERT INTO global_settings (key, value, updated_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
            [key, String(value)]
        );
        this._invalidateCache();
    }

    /**
     * Devuelve el resumen de uso de tokens por bot y modelo.
     * @returns {Promise<{ rows: Array, totals: Object }>}
     */
    async getUsageSummary() {
        const rows = await pool.query(`
            SELECT
                p.player_id,
                p.display_name,
                p.ai_profile,
                s.model_name,
                s.calls_count,
                s.total_tokens,
                s.estimated_cost::float AS estimated_cost,
                s.last_call_at
            FROM ai_usage_stats s
            JOIN players p ON p.player_id = s.bot_id
            ORDER BY s.total_tokens DESC
        `);

        const totals = await pool.query(`
            SELECT
                COALESCE(SUM(calls_count), 0)::int       AS total_calls,
                COALESCE(SUM(total_tokens), 0)::int      AS total_tokens,
                COALESCE(SUM(estimated_cost), 0)::float  AS total_cost
            FROM ai_usage_stats
        `);

        return {
            rows:   rows.rows,
            totals: totals.rows[0],
        };
    }

    /**
     * Elimina todos los registros de ai_usage_stats.
     * Útil para reiniciar el contador de presupuesto.
     */
    async resetUsageStats() {
        await pool.query('DELETE FROM ai_usage_stats');
        Logger.action('[AI PROXY] Estadísticas de uso de IA reiniciadas.');
    }

    /**
     * Devuelve el último error de API registrado en memoria (si existe).
     * @returns {{ provider: string, message: string, timestamp: string }|null}
     */
    getLastError() {
        return this._lastApiError;
    }

    /**
     * Comprueba la conexión con el proveedor configurado enviando un prompt mínimo.
     * No registra tokens como uso real (el test es solo de diagnóstico).
     * @returns {Promise<{ success: boolean, provider: string, message: string }>}
     */
    async testConnection() {
        const settings = await this._getSettings();
        const provider = settings.ai_provider;

        if (!provider || provider === 'procedural') {
            return { success: true, provider: 'procedural', message: 'Modo Procedural activo — no se requiere API key.' };
        }

        // Verificar que la clave existe antes de llamar
        if (provider === 'gemini' && !process.env.GEMINI_API_KEY) {
            const msg = 'GEMINI_API_KEY no está configurada en .env';
            this._setApiError(provider, msg);
            return { success: false, provider, message: msg };
        }
        if (provider === 'openai' && !process.env.OPENAI_API_KEY) {
            const msg = 'OPENAI_API_KEY no está configurada en .env';
            this._setApiError(provider, msg);
            return { success: false, provider, message: msg };
        }
        if (provider === 'groq' && !process.env.GROQ_API_KEY) {
            const msg = 'GROQ_API_KEY no está configurada en .env';
            this._setApiError(provider, msg);
            return { success: false, provider, message: msg };
        }

        const testPrompt = 'Responde SOLO con este JSON exacto, sin añadir nada más: {"action":"idle","params":{}}';
        try {
            let response;
            if (provider === 'gemini') {
                response = await this._callGemini(testPrompt);
            } else if (provider === 'openai') {
                response = await this._callOpenAI(testPrompt);
            } else if (provider === 'groq') {
                response = await this._callGroq(testPrompt);
            } else {
                return { success: false, provider, message: `Proveedor desconocido: ${provider}` };
            }

            const action = this._parseAction(response.text);
            if (!action) {
                const msg = `La clave es válida pero el modelo devolvió una respuesta inesperada: "${response.text?.slice(0, 80)}"`;
                this._setApiError(provider, msg);
                return { success: false, provider, message: msg };
            }

            this._clearApiError();
            return {
                success:  true,
                provider,
                message: `Conexión correcta con ${provider} (${response.inputTokens + response.outputTokens} tokens consumidos en test)`,
            };
        } catch (err) {
            this._setApiError(provider, err.message);
            return { success: false, provider, message: err.message };
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVADO: Caché de configuración
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Comprueba si quedan llamadas disponibles en la ventana de 1 minuto actual.
     * Si la ventana ha expirado, la reinicia. Devuelve false cuando se supera el límite.
     * @returns {boolean}
     */
    _checkRateLimit() {
        const now = Date.now();
        if (now - this._windowStart >= 60_000) {
            // Nueva ventana de 60 segundos
            this._callsThisWindow = 0;
            this._windowStart     = now;
        }
        if (this._callsThisWindow >= this._MAX_RPM) return false;
        this._callsThisWindow++;
        return true;
    }

    _setApiError(provider, message) {
        this._lastApiError = { provider, message, timestamp: new Date().toISOString() };
    }

    _clearApiError() {
        this._lastApiError = null;
    }

    async _getSettings() {
        if (this._settingsCache && Date.now() < this._cacheExpiry) {
            return this._settingsCache;
        }
        const result   = await pool.query('SELECT key, value FROM global_settings');
        const settings = {};
        for (const row of result.rows) settings[row.key] = row.value;
        this._settingsCache = settings;
        this._cacheExpiry   = Date.now() + this._CACHE_TTL_MS;
        return settings;
    }

    _invalidateCache() {
        this._settingsCache = null;
        this._cacheExpiry   = 0;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVADO: Construcción del prompt y parseo de respuesta
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Construye un prompt compacto en español para el LLM.
     * El modelo solo debe devolver UN objeto JSON con la acción elegida.
     */
    _buildPrompt(profile, context, turn) {
        const profileDesc = {
            farmer:      'agricultor pacífico que prioriza producción de alimentos y evita conflictos',
            expansionist:'conquistador agresivo que prioriza expansión territorial y ejércitos grandes',
            balanced:    'estratega equilibrado que balancea economía, defensa y expansión moderada',
        }[profile] || profile;

        const fiefCount    = context.territories?.length ?? 0;
        const emptyFiefs   = (context.territories || []).filter(t => !t.existing_building_id).length;
        const foodRatio    = (context.foodGoldRatio ?? 0).toFixed(2);
        const garrisonInfo = context.garrisonTarget != null
            ? `${context.totalTroops ?? 0}/${context.garrisonTarget}`
            : `${context.totalTroops ?? 0}/N/A`;

        return `Turno ${turn}. Eres consejero de un reino medieval. Perfil del rey: ${profileDesc}.
Estado: oro=${context.gold}, feudos=${fiefCount}, tropas=${garrisonInfo}, ratio_alimento/oro=${foodRatio}, feudos_sin_edificio=${emptyFiefs}.
Elige UNA acción:
- build: construir edificio (economic=mercado, religious=iglesia, military=cuartel)
- recruit: reclutar tropas (quantity: entero 1-100)
- idle: no hacer nada
Responde SOLO con JSON válido:
{"action":"ACCION","params":{}}
Ejemplos: {"action":"build","params":{"building_type":"economic"}} | {"action":"recruit","params":{"quantity":40}} | {"action":"idle","params":{}}`;
    }

    /**
     * Extrae y valida el JSON de acción de la respuesta del LLM.
     * @param {string} text
     * @returns {Object|null}
     */
    _parseAction(text) {
        try {
            const str = (text || '').trim();

            let parsed;
            try {
                // Groq con response_format json_object devuelve JSON puro — parse directo
                parsed = JSON.parse(str);
            } catch {
                // Gemini/OpenAI pueden envolver el JSON en prosa — extraer entre { y último }
                const start = str.indexOf('{');
                const end   = str.lastIndexOf('}');
                if (start === -1 || end <= start) return null;
                parsed = JSON.parse(str.slice(start, end + 1));
            }

            if (!['build', 'recruit', 'idle'].includes(parsed.action)) return null;
            return { action: parsed.action, params: parsed.params || {} };
        } catch {
            return null;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVADO: Llamadas a proveedores de IA
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Llama a Gemini 1.5 Flash (proveedor preferido por coste).
     * @returns {Promise<{ text, inputTokens, outputTokens, model }>}
     */
    async _callGemini(prompt) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error('GEMINI_API_KEY no configurada en .env');

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
            {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents:         [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.3, maxOutputTokens: 128 },
                }),
            }
        );

        // Retry automático en 429 (rate limit de Google): espera 3 s e intenta una vez más
        if (response.status === 429) {
            Logger.engine('⚠️ [AI PROXY] Gemini 429 — esperando 3 s antes de reintentar...');
            await new Promise(r => setTimeout(r, 3_000));
            const retry = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
                {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents:         [{ parts: [{ text: prompt }] }],
                        generationConfig: { temperature: 0.3, maxOutputTokens: 128 },
                    }),
                }
            );
            if (!retry.ok) {
                const err = await retry.text();
                throw new Error(`Gemini ${retry.status}: ${err.slice(0, 200)}`);
            }
            const retryData = await retry.json();
            return {
                text:         retryData.candidates?.[0]?.content?.parts?.[0]?.text || '',
                inputTokens:  retryData.usageMetadata?.promptTokenCount     || 0,
                outputTokens: retryData.usageMetadata?.candidatesTokenCount || 0,
                model:        'gemini-2.0-flash',
            };
        }

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Gemini ${response.status}: ${err.slice(0, 200)}`);
        }

        const data        = await response.json();
        const text        = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const inputTokens = data.usageMetadata?.promptTokenCount     || 0;
        const outTokens   = data.usageMetadata?.candidatesTokenCount || 0;

        return { text, inputTokens, outputTokens: outTokens, model: 'gemini-2.0-flash' };
    }

    /**
     * Llama a GPT-4o-mini de OpenAI.
     * @returns {Promise<{ text, inputTokens, outputTokens, model }>}
     */
    async _callOpenAI(prompt) {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) throw new Error('OPENAI_API_KEY no configurada en .env');

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method:  'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model:       'gpt-4o-mini',
                messages:    [{ role: 'user', content: prompt }],
                temperature: 0.3,
                max_tokens:  128,
            }),
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`OpenAI ${response.status}: ${err.slice(0, 200)}`);
        }

        const data        = await response.json();
        const text        = data.choices?.[0]?.message?.content || '';
        const inputTokens = data.usage?.prompt_tokens    || 0;
        const outTokens   = data.usage?.completion_tokens || 0;

        return { text, inputTokens, outputTokens: outTokens, model: 'gpt-4o-mini' };
    }

    /**
     * Llama a Groq con llama-3.1-8b-instant.
     * Groq expone una API compatible con OpenAI — el código es casi idéntico.
     * Free tier: ~30 RPM, ~500k tokens/día.
     * @returns {Promise<{ text, inputTokens, outputTokens, model }>}
     */
    async _callGroq(prompt, botId = null) {
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) throw new Error('GROQ_API_KEY no configurada en .env');

        const log = (msg) => botId != null ? Logger.bot(botId, msg) : Logger.engine(msg);

        log(`[GROQ] → PROMPT: ${prompt.slice(0, 300)}${prompt.length > 300 ? '…' : ''}`);

        const body = JSON.stringify({
            model:           'llama-3.1-8b-instant',
            messages:        [{ role: 'user', content: prompt }],
            temperature:     0.3,
            max_tokens:      128,
            response_format: { type: 'json_object' },
        });

        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method:  'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body,
        });

        if (response.status === 429) {
            log('⚠️ [GROQ] 429 rate limit — esperando 3 s antes de reintentar...');
            await new Promise(r => setTimeout(r, 3_000));
            const retry = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method:  'POST',
                headers: {
                    'Content-Type':  'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body,
            });
            if (!retry.ok) {
                const err = await retry.text();
                log(`[GROQ] ✗ Retry falló ${retry.status}: ${err.slice(0, 200)}`);
                throw new Error(`Groq ${retry.status}: ${err.slice(0, 200)}`);
            }
            const retryData = await retry.json();
            const retryText = retryData.choices?.[0]?.message?.content || '';
            log(`[GROQ] ← RETRY: ${retryText} | tokens: in=${retryData.usage?.prompt_tokens} out=${retryData.usage?.completion_tokens}`);
            return {
                text:         retryText,
                inputTokens:  retryData.usage?.prompt_tokens     || 0,
                outputTokens: retryData.usage?.completion_tokens || 0,
                model:        'llama-3.1-8b-instant',
            };
        }

        if (!response.ok) {
            const err = await response.text();
            log(`[GROQ] ✗ Error ${response.status}: ${err.slice(0, 200)}`);
            throw new Error(`Groq ${response.status}: ${err.slice(0, 200)}`);
        }

        const data        = await response.json();
        const text        = data.choices?.[0]?.message?.content || '';
        const inputTokens = data.usage?.prompt_tokens     || 0;
        const outTokens   = data.usage?.completion_tokens || 0;

        log(`[GROQ] ← RESPUESTA: ${text} | tokens: in=${inputTokens} out=${outTokens}`);

        return { text, inputTokens, outputTokens: outTokens, model: 'llama-3.1-8b-instant' };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVADO: Registro de uso
    // ─────────────────────────────────────────────────────────────────────────

    async _logUsage(botId, provider, inputTokens, outputTokens) {
        const totalTokens = (inputTokens || 0) + (outputTokens || 0);
        const modelName   = provider === 'gemini' ? 'gemini-2.0-flash'
                          : provider === 'openai'  ? 'gpt-4o-mini'
                          : provider === 'groq'    ? 'llama-3.1-8b-instant'
                          : provider;

        const costs         = MODEL_COSTS[modelName];
        const estimatedCost = costs
            ? ((inputTokens  || 0) / 1_000_000 * costs.input) +
              ((outputTokens || 0) / 1_000_000 * costs.output)
            : 0;

        await pool.query(`
            INSERT INTO ai_usage_stats (bot_id, model_name, calls_count, total_tokens, estimated_cost, last_call_at)
            VALUES ($1, $2, 1, $3, $4, NOW())
            ON CONFLICT (bot_id, model_name) DO UPDATE SET
                calls_count    = ai_usage_stats.calls_count    + 1,
                total_tokens   = ai_usage_stats.total_tokens   + $3,
                estimated_cost = ai_usage_stats.estimated_cost + $4,
                last_call_at   = NOW()
        `, [botId, modelName, totalTokens, estimatedCost.toFixed(8)]);
    }
}

module.exports = new AIProxyService();
module.exports.VALID_PROVIDERS = VALID_PROVIDERS;
