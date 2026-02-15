const { Logger } = require('../utils/logger');
const PlayerModel = require('../models/PlayerModel.js');
const { generateToken } = require('../middleware/auth');

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

            if (password !== user.password) {
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
                    role: user.role || 'player',
                    capital_h3: user.capital_h3,
                    gold: user.gold
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
    async AuthMe(req,res){
        // authenticateToken middleware already verified the JWT and set req.user
        res.json({
            success: true,
            user: {
                player_id: req.user.player_id,
                username: req.user.username,
                role: req.user.role
            }
        });
    }
}

module.exports = new LoginService();