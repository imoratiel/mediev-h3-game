const requireAuth = (req, res, next) => {
    if (!req.session || !req.session.user) {
        return res.status(401).json({
            success: false,
            message: 'Autenticación requerida. Por favor, inicia sesión.'
        });
    }
    next();
};

const requireAdmin = async (req, res, next) => {
    try {
        if (!req.session || !req.session.user) {
            return res.status(401).json({
                success: false,
                message: 'Autenticación requerida. Por favor, inicia sesión.'
            });
        }

        if (req.session.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Acceso denegado. Se requieren permisos de administrador.'
            });
        }

        next();
    } catch (error) {
        console.error('Error in admin middleware:', error);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
};

module.exports = {
    requireAuth,
    requireAdmin
};
