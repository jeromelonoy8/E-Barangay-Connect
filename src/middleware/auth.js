const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const { unauthorized, forbidden } = require('../utils/errors');

const STAFF_ROLES = ['official', 'admin'];

function signToken(user) {
    return jwt.sign({ sub: user.user_id, role: user.role }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
}

async function loadUserFromRequest(req) {
    const header = req.get('authorization') || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) return null;

    let payload;
    try {
        payload = jwt.verify(token, config.jwt.secret);
    } catch (err) {
        throw unauthorized('Your session has expired. Please log in again.');
    }

    // Re-read the user on every request so role changes and deactivations apply immediately.
    const rows = await db.query('SELECT * FROM users WHERE user_id = ?', [payload.sub]);
    const user = rows[0];
    if (!user || !user.is_active) throw unauthorized('Your account is no longer active.');
    return user;
}

async function requireAuth(req, res, next) {
    const user = await loadUserFromRequest(req);
    if (!user) throw unauthorized();
    req.user = user;
    next();
}

// Attaches req.user when a valid token is present, but lets anonymous requests through.
async function optionalAuth(req, res, next) {
    req.user = await loadUserFromRequest(req);
    next();
}

function requireRole(...roles) {
    return async (req, res, next) => {
        await requireAuth(req, res, () => {});
        if (!roles.includes(req.user.role)) throw forbidden();
        next();
    };
}

const requireStaff = requireRole(...STAFF_ROLES);
const requireAdmin = requireRole('admin');
const requireResident = requireRole('resident');

const isStaff = (user) => Boolean(user) && STAFF_ROLES.includes(user.role);

module.exports = { signToken, requireAuth, optionalAuth, requireStaff, requireAdmin, requireResident, isStaff, STAFF_ROLES };
