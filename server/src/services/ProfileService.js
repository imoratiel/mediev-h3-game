const path = require('path');
const fs   = require('fs');
const multer = require('multer');
const sharp  = require('sharp');
const pool   = require('../../db');
const { Logger } = require('../utils/logger');

const AVATARS_DIR = process.env.AVATARS_DIR || path.join(__dirname, '../../uploads/avatars');
const MAX_BYTES   = 2 * 1024 * 1024; // 2 MB input limit

// Ensure directory exists at startup
if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR, { recursive: true });

// Multer: memory only, size cap, MIME pre-filter
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => {
        const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
        if (!allowed.has(file.mimetype)) {
            return cb(Object.assign(new Error('Tipo de archivo no permitido. Usa JPG, PNG, WebP o GIF.'), { status: 400 }));
        }
        cb(null, true);
    },
}).single('avatar');

// Validate real file magic bytes (not just MIME header)
function hasImageMagic(buf) {
    if (!buf || buf.length < 12) return false;
    // JPEG: FF D8 FF
    if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return true;
    // PNG: 89 50 4E 47
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return true;
    // WebP: RIFF????WEBP
    if (buf.slice(0, 4).toString('ascii') === 'RIFF' &&
        buf.slice(8, 12).toString('ascii') === 'WEBP') return true;
    // GIF87a / GIF89a
    if (buf.slice(0, 3).toString('ascii') === 'GIF') return true;
    return false;
}

// Simple in-memory rate limiter: max 5 uploads per 10 min per player
const _rl = new Map();
function checkRateLimit(playerId) {
    const now  = Date.now();
    const win  = 10 * 60 * 1000;
    const hits = (_rl.get(playerId) || []).filter(t => now - t < win);
    if (hits.length >= 5) return false;
    _rl.set(playerId, [...hits, now]);
    return true;
}

class ProfileService {
    /**
     * POST /api/profile/avatar
     * Accepts multipart/form-data field "avatar".
     * Validates, re-encodes to WebP 256×256, saves to AVATARS_DIR.
     */
    UploadAvatar(req, res) {
        upload(req, res, async (err) => {
            try {
                const playerId = req.user.player_id;

                if (!checkRateLimit(playerId)) {
                    return res.status(429).json({ success: false, message: 'Demasiados intentos. Espera unos minutos.' });
                }

                if (err) {
                    const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 400);
                    const msg = err.code === 'LIMIT_FILE_SIZE'
                        ? 'El archivo supera el límite de 500 KB.'
                        : err.message || 'Error al subir el archivo.';
                    return res.status(status).json({ success: false, message: msg });
                }

                if (!req.file) {
                    return res.status(400).json({ success: false, message: 'No se recibió ningún archivo.' });
                }

                // Verify magic bytes
                if (!hasImageMagic(req.file.buffer)) {
                    return res.status(400).json({ success: false, message: 'El archivo no es una imagen válida.' });
                }

                // Detect animated GIF
                const isGif = req.file.buffer.slice(0, 3).toString('ascii') === 'GIF';
                if (isGif) {
                    // GIF bomb protection: reject if too many frames
                    const meta = await sharp(req.file.buffer, { animated: true }).metadata();
                    const frames = meta.pages || 1;
                    if (frames > 60) {
                        return res.status(400).json({
                            success: false,
                            message: `El GIF tiene ${frames} fotogramas. El límite es 60.`,
                        });
                    }
                }

                // Re-encode to WebP — animated if GIF, static otherwise.
                // strips EXIF and any hidden payload in all cases.
                const processed = await sharp(req.file.buffer, isGif ? { animated: true } : {})
                    .resize(256, 256, { fit: 'cover', position: 'centre' })
                    .webp({ quality: 80, loop: 0 })
                    .toBuffer();

                const filename = `player_${playerId}.webp`;
                fs.writeFileSync(path.join(AVATARS_DIR, filename), processed);

                // Bump version so clients cache-bust
                const result = await pool.query(
                    'UPDATE players SET avatar_version = avatar_version + 1 WHERE player_id = $1 RETURNING avatar_version',
                    [playerId]
                );
                const avatar_version = result.rows[0]?.avatar_version ?? 1;

                Logger.action(`Avatar actualizado (v${avatar_version})`, playerId);
                res.json({ success: true, avatar_version });

            } catch (e) {
                Logger.error(e, { endpoint: 'POST /api/profile/avatar', userId: req.user?.player_id });
                res.status(500).json({ success: false, message: 'Error interno al procesar el avatar.' });
            }
        });
    }
}

module.exports = new ProfileService();
