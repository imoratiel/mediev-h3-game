const bcrypt = require('bcrypt');
const { Logger } = require('../utils/logger');
const PlayerModel = require('../models/PlayerModel.js');
const { generateToken } = require('../middleware/auth');
const displayNameValidator = require('../utils/displayNameValidator');

class LoginService {
    async Login(req,res){
        try {
            const { username, password } = req.body;

            if (!username || !password) {
                Logger.error(new Error('Login attempt without credentials'), {
                    endpoint: '/api/auth/login',
                    method: 'POST'
                });
                return res.status(400).json({ success: false, message: 'Usuario y contraseña requeridos' });
            }

            const result = await PlayerModel.GetPlayerByUsername(username);

            if (result.rows.length === 0) {
                Logger.error(new Error('Login attempt with non-existent user'), {
                    endpoint: '/api/auth/login',
                    method: 'POST',
                    username
                });
                return res.status(401).json({ success: false, message: 'Usuario o contraseña incorrectos' });
            }

            const user = result.rows[0];

            const passwordValid = await bcrypt.compare(password, user.password);
            if (!passwordValid) {
                Logger.error(new Error('Login attempt with incorrect password'), {
                    endpoint: '/api/auth/login',
                    method: 'POST',
                    userId: user.player_id,
                    username: user.username
                });
                return res.status(401).json({ success: false, message: 'Usuario o contraseña incorrectos' });
            }

            // Generate JWT token
            const payload = {
                player_id: user.player_id,
                username: user.username,
                display_name: user.display_name,
                role: user.role || 'player',
                capital_h3: user.capital_h3
            };

            const token = generateToken(payload);

            // Send token as HttpOnly cookie
            res.cookie('access_token', token, {
                httpOnly: true,        // Prevents client-side JS from accessing
                secure: false,         // Set to true in production with HTTPS
                sameSite: 'lax',       // CSRF protection
                maxAge: 24 * 60 * 60 * 1000  // 24 hours
            });

            // Log successful login
            Logger.action(`JWT generado y enviado para usuario ${username} (${user.role})`, user.player_id);
            console.log(`✓ User logged in: ${user.username} (${user.role}) - JWT issued`);

            res.json({
                success: true,
                user: {
                    player_id: user.player_id,
                    username: user.username,
                    display_name: user.display_name,
                    role: user.role || 'player',
                    capital_h3: user.capital_h3,
                    gold: user.gold,
                    is_initialized: user.is_initialized ?? false
                }
            });
        } catch (error) {
            console.error('Login error:', error);
            Logger.error(error, {
                endpoint: '/api/auth/login',
                method: 'POST'
            });
            res.status(500).json({ success: false, message: 'Error interno del servidor' });
        }
    }
    async Logout(req,res){
        const userId = req.user?.player_id;
        const username = req.user?.username;

        // Clear the JWT cookie
        res.clearCookie('access_token', {
            httpOnly: true,
            secure: false,
            sameSite: 'lax'
        });

        // Log successful logout
        if (userId) {
            Logger.action(`Cerró sesión (JWT invalidado)`, userId);
            console.log(`✓ User logged out: ${username}`);
        }

        res.json({ success: true, message: 'Sesión cerrada exitosamente' });
    }
    async AuthMe(req, res) {
        const pool = require('../../db.js');
        try {
            // Fetch is_initialized from DB (not in JWT payload)
            const result = await pool.query(
                `SELECT p.is_initialized, p.gender, p.culture_id, p.display_name, c.name AS culture_name
                 FROM players p
                 LEFT JOIN cultures c ON c.id = p.culture_id
                 WHERE p.player_id = $1`,
                [req.user.player_id]
            );
            const is_initialized = result.rows[0]?.is_initialized ?? false;
            const gender         = result.rows[0]?.gender ?? 'M';
            const culture_id     = result.rows[0]?.culture_id ?? null;
            const culture_name   = result.rows[0]?.culture_name ?? null;
            const display_name   = result.rows[0]?.display_name ?? req.user.display_name;
            res.json({
                success: true,
                user: {
                    player_id:      req.user.player_id,
                    username:       req.user.username,
                    display_name,
                    role:           req.user.role,
                    is_initialized,
                    gender,
                    culture_id,
                    culture_name,
                }
            });
        } catch (error) {
            Logger.error(error, { endpoint: '/api/auth/me', method: 'GET', userId: req.user?.player_id });
            res.status(500).json({ success: false, message: 'Error al verificar sesión' });
        }
    }

    async UpdateProfile(req, res) {
        const pool = require('../../db.js');
        try {
            const player_id = req.user.player_id;
            const { display_name } = req.body;

            const validation = displayNameValidator.validate(display_name);
            if (!validation.valid) {
                return res.status(400).json({ success: false, error: validation.error });
            }
            const sanitized = validation.sanitized;

            const result = await pool.query(
                'UPDATE players SET display_name = $1 WHERE player_id = $2 RETURNING player_id, username, display_name, role, capital_h3, gold',
                [sanitized, player_id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Jugador no encontrado' });
            }

            const updated = result.rows[0];

            // Re-issue JWT with updated display_name
            const newPayload = {
                player_id: updated.player_id,
                username: updated.username,
                display_name: updated.display_name,
                role: updated.role,
                capital_h3: updated.capital_h3
            };
            const newToken = generateToken(newPayload);
            res.cookie('access_token', newToken, {
                httpOnly: true,
                secure: false,
                sameSite: 'lax',
                maxAge: 24 * 60 * 60 * 1000
            });

            Logger.action(`Nombre de personaje actualizado: "${updated.display_name}"`, player_id);

            return res.json({
                success: true,
                user: {
                    player_id: updated.player_id,
                    username: updated.username,
                    display_name: updated.display_name,
                    role: updated.role,
                    capital_h3: updated.capital_h3,
                    gold: updated.gold
                }
            });
        } catch (error) {
            Logger.error(error, { context: 'LoginService.UpdateProfile', player_id: req.user?.player_id });
            return res.status(500).json({ success: false, error: 'Error al actualizar el perfil' });
        }
    }
}

module.exports = new LoginService();