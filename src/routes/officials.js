const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');
const v = require('../utils/validate');
const { formatUser } = require('../utils/format');
const { requireStaff, requireAdmin } = require('../middleware/auth');
const { getSettings } = require('../services/settings');
const { badRequest, notFound, conflict } = require('../utils/errors');

const router = express.Router();

// Officials are staff accounts. Role "admin" can also manage other officials and settings.
const STAFF_ROLE_VALUES = ['official', 'admin'];

// Once the barangay has set its list of positions, only those are accepted.
async function readPosition(body, { required }) {
    const { official_positions: positions } = await getSettings();
    return positions.length
        ? v.oneOf(body, 'position', positions, { required, label: 'Position' })
        : v.str(body, 'position', { required, max: 100, label: 'Position' });
}

async function findOfficial(id) {
    const rows = await db.query("SELECT * FROM users WHERE user_id = ? AND role IN ('official', 'admin')", [id]);
    if (!rows[0]) throw notFound('Official not found.');
    return rows[0];
}

async function activeAdminCount() {
    const [row] = await db.query("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = TRUE");
    return Number(row.n);
}

router.get('/', requireStaff, async (req, res) => {
    const rows = await db.query("SELECT * FROM users WHERE role IN ('official', 'admin') ORDER BY role = 'admin' DESC, full_name");
    res.json(rows.map(formatUser));
});

router.get('/:id', requireStaff, async (req, res) => {
    res.json(formatUser(await findOfficial(v.positiveInt(req.params.id, 'Official ID'))));
});

router.post('/', requireAdmin, async (req, res) => {
    const body = req.body || {};
    const fullName = v.str(body, 'full_name', { required: true, max: 100, label: 'Full name' });
    const email = v.email(body, 'email', { required: true });
    const phone = v.phone(body, 'phone_number', { required: true });
    const username = v.username(body, 'username', { required: true });
    const position = await readPosition(body, { required: true });
    const role = v.oneOf(body, 'role', STAFF_ROLE_VALUES, { label: 'Role' }) || 'official';
    const password = v.password(body, 'password', { required: true, label: 'Temporary password' });

    const result = await db.query(
        'INSERT INTO users (full_name, username, email, phone_number, password_hash, role, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [fullName, username, email, phone, await bcrypt.hash(password, 10), role, position]
    );
    res.status(201).json({ message: 'Official registered successfully.', official: formatUser(await findOfficial(result.insertId)) });
});

router.put('/:id', requireAdmin, async (req, res) => {
    const id = v.positiveInt(req.params.id, 'Official ID');
    const body = req.body || {};
    const existing = await findOfficial(id);

    const updates = {
        full_name: v.str(body, 'full_name', { max: 100, label: 'Full name' }),
        email: v.email(body, 'email'),
        phone_number: v.phone(body, 'phone_number'),
        position: await readPosition(body, { required: false }),
        role: v.oneOf(body, 'role', STAFF_ROLE_VALUES, { label: 'Role' }),
        is_active: v.bool(body, 'is_active', { label: 'is_active' })
    };

    const losesAdmin = existing.role === 'admin' && existing.is_active &&
        ((updates.role && updates.role !== 'admin') || updates.is_active === false);
    if (losesAdmin && (await activeAdminCount()) <= 1) {
        throw conflict('This is the only active admin account. Promote another admin first.');
    }

    const fields = Object.entries(updates).filter(([, value]) => value !== undefined);
    if (fields.length === 0) throw badRequest('Nothing to update.');

    await db.query(
        `UPDATE users SET ${fields.map(([key]) => `${key} = ?`).join(', ')} WHERE user_id = ?`,
        [...fields.map(([, value]) => value), id]
    );
    res.json({ message: 'Official updated.', official: formatUser(await findOfficial(id)) });
});

router.put('/:id/password', requireAdmin, async (req, res) => {
    const id = v.positiveInt(req.params.id, 'Official ID');
    const password = v.password(req.body || {}, 'password', { required: true, label: 'New password' });
    await findOfficial(id);
    await db.query('UPDATE users SET password_hash = ? WHERE user_id = ?', [await bcrypt.hash(password, 10), id]);
    res.json({ message: 'Password reset successfully.' });
});

router.delete('/:id', requireAdmin, async (req, res) => {
    const id = v.positiveInt(req.params.id, 'Official ID');
    if (id === req.user.user_id) throw conflict('You cannot delete your own account.');
    const existing = await findOfficial(id);
    if (existing.role === 'admin' && existing.is_active && (await activeAdminCount()) <= 1) {
        throw conflict('This is the only active admin account.');
    }
    await db.query('DELETE FROM users WHERE user_id = ?', [id]);
    res.json({ message: 'Official removed.' });
});

module.exports = router;
