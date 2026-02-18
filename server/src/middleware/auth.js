const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'medieval-h3-game-jwt-secret-CHANGE-IN-PRODUCTION';
const JWT_EXPIRES_IN = '24h';

/**
 * Middleware: Authenticate JWT from HttpOnly cookie
 * Extracts and verifies JWT from 'access_token' cookie
 * Sets req.user with decoded payload: { player_id, username, role }
 */
const authenticateToken = (req, res, next) => {
    const { Logger } = require('../utils/logger');

    try {
        // Extract token from HttpOnly cookie
        const token = req.cookies.access_token;

        if (!token) {
            Logger.error(new Error('Unauthorized access attempt - No token provided'), {
                endpoint: req.originalUrl || req.url,
                method: req.method,
                ip: req.ip || req.connection.remoteAddress
            });

            return res.status(401).json({
                success: false,
                message: 'Autenticación requerida. Por favor, inicia sesión.'
            });
        }

        // Verify JWT signature and decode payload
        const decoded = jwt.verify(token, JWT_SECRET);

        // Attach user data to request object
        req.user = {
            player_id: decoded.player_id,
            username: decoded.username,
            display_name: decoded.display_name,
            role: decoded.role
        };

        next();
    } catch (error) {
        const { Logger } = require('../utils/logger');

        if (error.name === 'JsonWebTokenError') {
            Logger.error(new Error('Invalid JWT token'), {
                endpoint: req.originalUrl || req.url,
                method: req.method,
                error: error.message
            });

            return res.status(401).json({
                success: false,
                message: 'Token inválido. Por favor, inicia sesión nuevamente.'
            });
        }

        if (error.name === 'TokenExpiredError') {
            Logger.error(new Error('Expired JWT token'), {
                endpoint: req.originalUrl || req.url,
                method: req.method,
                expiredAt: error.expiredAt
            });

            return res.status(401).json({
                success: false,
                message: 'Tu sesión ha expirado. Por favor, inicia sesión nuevamente.'
            });
        }

        Logger.error(error, {
            endpoint: req.originalUrl || req.url,
            method: req.method
        });

        return res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
};

/**
 * Middleware: Require Admin role
 * Must be used AFTER authenticateToken
 */
const requireAdmin = (req, res, next) => {
    const { Logger } = require('../utils/logger');

    try {
        if (!req.user) {
            Logger.error(new Error('requireAdmin called before authenticateToken'), {
                endpoint: req.originalUrl || req.url,
                method: req.method
            });

            return res.status(401).json({
                success: false,
                message: 'Autenticación requerida. Por favor, inicia sesión.'
            });
        }

        if (req.user.role !== 'admin') {
            Logger.error(new Error('Non-admin user attempted admin access'), {
                endpoint: req.originalUrl || req.url,
                method: req.method,
                userId: req.user.player_id,
                username: req.user.username,
                role: req.user.role
            });

            return res.status(403).json({
                success: false,
                message: 'Acceso denegado. Se requieren permisos de administrador.'
            });
        }

        next();
    } catch (error) {
        Logger.error(error, {
            endpoint: req.originalUrl || req.url,
            method: req.method,
            userId: req.user?.player_id
        });

        return res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
};

/**
 * Generate JWT token
 * @param {Object} payload - User data { player_id, username, role }
 * @returns {string} Signed JWT token
 */
const generateToken = (payload) => {
    return jwt.sign(payload, JWT_SECRET, {
        expiresIn: JWT_EXPIRES_IN
    });
};

module.exports = {
    authenticateToken,
    requireAdmin,
    generateToken,
    JWT_SECRET,
    JWT_EXPIRES_IN
};
