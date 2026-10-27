const express = require('express');
const bcrypt = require('bcrypt');
const config = require('../config');
const db = require('../db');
const v = require('../utils/validate');
const { formatUser } = require('../utils/format');
const { requireAuth } = require('../middleware/auth');
const { multipartFile, readUploadedFile, IMAGE_TYPES } = require('../middleware/upload');
const { badRequest } = require('../utils/errors');

const router = express.Router();
router.use(requireAuth);

async function currentUser(userId) {
    const rows = await db.query('SELECT * FROM users WHERE user_id = ?', [userId]);
    return formatUser(rows[0]);
}

router.get('/', (req, res) => {
    res.json(formatUser(req.user));
});

router.put('/', async (req, res) => {
    const body = req.body || {};
    const updates = {
        full_name: v.str(body, 'full_name', { max: 100, label: 'Full name' }),
        email: v.email(body, 'email'),
        phone_number: v.phone(body, 'phone_number'),
        address: v.str(body, 'address', { max: 255, label: 'Address' }),
        birth_date: v.date(body, 'birth_date', { label: 'Birth date' })
    };

    const fields = Object.entries(updates).filter(([, value]) => value !== undefined);
    if (fields.length === 0) throw badRequest('Nothing to update.');

    await db.query(
        `UPDATE users SET ${fields.map(([key]) => `${key} = ?`).join(', ')} WHERE user_id = ?`,
        [...fields.map(([, value]) => value), req.user.user_id]
    );
    res.json({ message: 'Profile updated successfully.', user: await currentUser(req.user.user_id) });
});

router.put('/password', async (req, res) => {
    const body = req.body || {};
    const current = body.current_password;
    const next = v.password(body, 'new_password', { required: true, label: 'New password' });

    if (typeof current !== 'string' || !(await bcrypt.compare(current, req.user.password_hash).catch(() => false))) {
        throw badRequest('Current password is incorrect.');
    }

    await db.query('UPDATE users SET password_hash = ? WHERE user_id = ?', [await bcrypt.hash(next, 10), req.user.user_id]);
    res.json({ message: 'Password changed successfully.' });
});

// Accepts multipart field "photo" or a JSON body { "photo": "data:image/...;base64,..." }.
router.put('/photo', multipartFile.single('photo'), async (req, res) => {
    const file = readUploadedFile(req, {
        dataField: 'photo',
        allowed: IMAGE_TYPES,
        maxBytes: config.uploads.maxProfilePicBytes,
        label: 'Profile photo'
    });
    if (!file) throw badRequest('Profile photo is required.');

    const dataUrl = `data:${file.mime};base64,${file.buffer.toString('base64')}`;
    await db.query('UPDATE users SET profile_pic = ? WHERE user_id = ?', [dataUrl, req.user.user_id]);
    res.json({ message: 'Profile photo updated.', user: await currentUser(req.user.user_id) });
});

router.delete('/photo', async (req, res) => {
    await db.query('UPDATE users SET profile_pic = NULL WHERE user_id = ?', [req.user.user_id]);
    res.json({ message: 'Profile photo removed.', user: await currentUser(req.user.user_id) });
});

router.put('/senior-mode', async (req, res) => {
    const enabled = v.bool(req.body || {}, 'enabled', { required: true, label: 'enabled' });
    await db.query('UPDATE users SET is_senior_mode = ? WHERE user_id = ?', [enabled, req.user.user_id]);
    res.json({ message: `Senior mode ${enabled ? 'enabled' : 'disabled'}.`, user: await currentUser(req.user.user_id) });
});

module.exports = router;
