const express = require('express');
const db = require('../db');
const v = require('../utils/validate');
const { requireStaff } = require('../middleware/auth');
const { getSettings } = require('../services/settings');
const { badRequest, notFound } = require('../utils/errors');

const router = express.Router();

const SELECT_ANNOUNCEMENT = `
    SELECT a.*, u.full_name AS author_name
    FROM announcements a
    LEFT JOIN users u ON u.user_id = a.author_id`;

function formatAnnouncement(row) {
    return {
        announcement_id: row.announcement_id,
        title: row.title,
        category: row.category,
        body: row.body,
        author_id: row.author_id,
        author_name: row.author_name,
        created_at: row.created_at,
        updated_at: row.updated_at
    };
}

async function findAnnouncement(id) {
    const rows = await db.query(`${SELECT_ANNOUNCEMENT} WHERE a.announcement_id = ?`, [id]);
    if (!rows[0]) throw notFound('Announcement not found.');
    return rows[0];
}

// Once the barangay has set its announcement categories, only those are accepted.
async function readFields(body, { partial }) {
    const { announcement_categories: categories } = await getSettings();
    return {
        title: v.str(body, 'title', { required: !partial, max: 200, label: 'Title' }),
        category: categories.length
            ? v.oneOf(body, 'category', categories, { required: !partial, label: 'Category' })
            : v.str(body, 'category', { max: 50, label: 'Category' }),
        body: v.str(body, 'body', { required: !partial, max: 10000, label: 'Body' })
    };
}

// Public, so residents and the landing page can show them. ?category=&limit=
router.get('/', async (req, res) => {
    const params = [];
    let where = '';
    if (req.query.category) {
        where = 'WHERE a.category = ?';
        params.push(req.query.category);
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit || '100', 10) || 100, 1), 500);
    const rows = await db.query(`${SELECT_ANNOUNCEMENT} ${where} ORDER BY a.created_at DESC, a.announcement_id DESC LIMIT ${limit}`, params);
    res.json(rows.map(formatAnnouncement));
});

router.get('/:id', async (req, res) => {
    res.json(formatAnnouncement(await findAnnouncement(v.positiveInt(req.params.id, 'Announcement ID'))));
});

router.post('/', requireStaff, async (req, res) => {
    const fields = await readFields(req.body || {}, { partial: false });
    const result = await db.query(
        'INSERT INTO announcements (title, category, body, author_id) VALUES (?, ?, ?, ?)',
        [fields.title, fields.category || null, fields.body, req.user.user_id]
    );
    res.status(201).json(formatAnnouncement(await findAnnouncement(result.insertId)));
});

router.put('/:id', requireStaff, async (req, res) => {
    const id = v.positiveInt(req.params.id, 'Announcement ID');
    const fields = Object.entries(await readFields(req.body || {}, { partial: true })).filter(([, value]) => value !== undefined);
    if (fields.length === 0) throw badRequest('Nothing to update.');

    await findAnnouncement(id);
    await db.query(
        `UPDATE announcements SET ${fields.map(([key]) => `${key} = ?`).join(', ')} WHERE announcement_id = ?`,
        [...fields.map(([, value]) => value), id]
    );
    res.json(formatAnnouncement(await findAnnouncement(id)));
});

router.delete('/:id', requireStaff, async (req, res) => {
    const id = v.positiveInt(req.params.id, 'Announcement ID');
    const result = await db.query('DELETE FROM announcements WHERE announcement_id = ?', [id]);
    if (result.affectedRows === 0) throw notFound('Announcement not found.');
    res.json({ message: 'Announcement deleted.' });
});

module.exports = router;
