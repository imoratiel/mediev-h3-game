/**
 * Lightweight in-memory cache with TTL support.
 *
 * Two modes:
 *  - Static (ttlMs = 0): populated once at startup, never expires.
 *  - TTL    (ttlMs > 0): entry expires after given milliseconds; evicted lazily on get().
 *
 * Per-player cache keys follow the pattern "<namespace>:<player_id>".
 * Call invalidatePrefix("economy:42") after writes that affect that player's data.
 */
class CacheService {
    constructor() {
        /** @type {Map<string, { value: any, expiresAt: number|null }>} */
        this._store = new Map();
    }

    /**
     * Store a value.
     * @param {string} key
     * @param {*}      value
     * @param {number} ttlMs  0 = never expires (static)
     */
    set(key, value, ttlMs = 0) {
        this._store.set(key, {
            value,
            expiresAt: ttlMs > 0 ? Date.now() + ttlMs : null,
        });
    }

    /**
     * Retrieve a value. Returns undefined if missing or expired.
     * @param {string} key
     * @returns {*}
     */
    get(key) {
        const entry = this._store.get(key);
        if (!entry) return undefined;
        if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
            this._store.delete(key);
            return undefined;
        }
        return entry.value;
    }

    /** @param {string} key */
    has(key) {
        return this.get(key) !== undefined;
    }

    /** @param {string} key */
    delete(key) {
        this._store.delete(key);
    }

    /**
     * Remove all entries whose key starts with prefix.
     * Use to invalidate per-player namespaces, e.g. invalidatePrefix("economy:42").
     * @param {string} prefix
     */
    invalidatePrefix(prefix) {
        for (const key of this._store.keys()) {
            if (key.startsWith(prefix)) this._store.delete(key);
        }
    }

    /**
     * Build a namespaced key for per-player caches.
     * @param {string} namespace
     * @param {number|string} playerId
     * @returns {string}
     */
    static playerKey(namespace, playerId) {
        return `${namespace}:${playerId}`;
    }

    /** Flush all entries (e.g. called after a game turn processes). */
    clear() {
        this._store.clear();
    }

    get size() {
        return this._store.size;
    }
}

module.exports = new CacheService();
