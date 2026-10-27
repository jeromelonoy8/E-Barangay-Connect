const express = require('express');
const bcrypt = require('bcrypt');
const { rateLimit } = require('express-rate-limit');
const config = require('../config');
const db = require('../db');
const v = require('../utils/validate');
const { formatUser } = require('../utils/format');
const { signToken, requireAuth, STAFF_ROLES } = require('../middleware/auth');
const { unauthorized, forbidden } = require('../utils/errors');

const router = express.Router();

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.authRateLimit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please wait a few minutes and try again.' }
});

const BCRYPT_PATTERN = /^\$2[aby]\$\d{2}\$/;

async function verifyPassword(user, password) {
    if (typeof password !== 'string' || !password) return false;

    if (BCRYPT_PATTERN.test(user.password_hash)) {
        return bcrypt.compare(password, user.password_hash);
    }

    // Legacy rows (e.g. the admin seeded by schema.sql) hold a plain-text password.
    // Accept it once, then replace it with a bcrypt hash.
    if (password === user.password_hash) {
        const hash = await bcrypt.hash(password, 10);
        await db.query('UPDATE users SET password_hash = ? WHERE user_id = ?', [hash, user.user_id]);
        return true;
    }
    return false;
}

async function authenticate(identifier, password) {
    if (typeof identifier !== 'string' || !identifier.trim()) return null;
    const value = identifier.trim().toLowerCase();
    const rows = await db.query('SELECT * FROM users WHERE LOWER(username) = ? OR LOWER(email) = ?', [value, value]);
    const user = rows[0];
    if (!user || !(await verifyPassword(user, password))) return null;
    return user;
}

function loginResponse(res, message, user) {
    res.json({ message, token: signToken(user), user: formatUser(user) });
}

// Resident self-registration
router.post('/register', authLimiter, async (req, res) => {
    const body = req.body || {};
    const username = v.username(body, 'username', { required: true });
    const email = v.email(body, 'email', { required: true });
    const phone = v.phone(body, 'phone_number', { required: true });
    const password = v.password(body, 'password', { required: true });
    const fullName = v.str(body, 'full_name', { max: 100, label: 'Full name' }) || username;

    const hash = await bcrypt.hash(password, 10);
    const result = await db.query(
        "INSERT INTO users (full_name, username, email, phone_number, password_hash, role) VALUES (?, ?, ?, ?, ?, 'resident')",
        [fullName, username, email, phone, hash]
    );
    res.status(201).json({ message: 'Resident account created successfully!', userId: result.insertId });
});

// Resident login (username or email)
router.post('/login', authLimiter, async (req, res) => {
    const { username, password } = req.body || {};
    const user = await authenticate(username, password);
    if (!user) throw unauthorized('Invalid resident credentials.');
    if (user.role !== 'resident') throw forbidden('Access denied. Please use the Admin Portal.');
    if (!user.is_active) throw forbidden('This account has been deactivated. Please contact the barangay office.');
    loginResponse(res, 'Resident login successful', user);
});

// Barangay official / admin login
router.post('/admin-login', authLimiter, async (req, res) => {
    const { username, password } = req.body || {};
    const user = await authenticate(username, password);
    if (!user) throw unauthorized('Invalid admin credentials.');
    if (!STAFF_ROLES.includes(user.role)) throw forbidden('Access denied: Account is not authorized as an Admin.');
    if (!user.is_active) throw forbidden('This account has been deactivated.');
    loginResponse(res, 'Admin authentication successful', user);
});

router.get('/me', requireAuth, (req, res) => {
    res.json({ user: formatUser(req.user) });
});

module.exports = router;
