const express = require('express');
const config = require('../config');
const db = require('../db');
const v = require('../utils/validate');
const time = require('../utils/time');
const { formatUser, reference } = require('../utils/format');
const { requireStaff, requireAdmin } = require('../middleware/auth');
const { notFound } = require('../utils/errors');

const router = express.Router();

// Numbers for the admin dashboard cards.
router.get('/stats', requireStaff, async (req, res) => {
    const today = time.today();
    const [statusRows, [residents], [officials], [appointments], [announcements], recent] = await Promise.all([
        db.query('SELECT status, COUNT(*) AS n FROM document_requests GROUP BY status'),
        db.query("SELECT COUNT(*) AS n FROM users WHERE role = 'resident'"),
        db.query("SELECT COUNT(*) AS n FROM users WHERE role IN ('official', 'admin') AND is_active = TRUE"),
        db.query(
            `SELECT SUM(scheduled_date = ?) AS today, SUM(scheduled_date >= ?) AS upcoming
             FROM appointments WHERE status = 'Confirmed'`,
            [today, today]
        ),
        db.query('SELECT COUNT(*) AS n FROM announcements'),
        db.query(
            `SELECT r.request_id, r.status, r.created_at, d.name AS document_type, COALESCE(u.full_name, u.username) AS resident_name
             FROM document_requests r
             JOIN users u ON u.user_id = r.user_id
             JOIN document_types d ON d.doc_type_id = r.doc_type_id
             ORDER BY r.created_at DESC, r.request_id DESC LIMIT 5`
        )
    ]);

    const byStatus = Object.fromEntries(config.requestStatuses.map(s => [s, 0]));
    for (const row of statusRows) byStatus[row.status] = Number(row.n);

    res.json({
        requests: {
            total: Object.values(byStatus).reduce((sum, n) => sum + n, 0),
            by_status: byStatus
        },
        residents: Number(residents.n),
        officials: Number(officials.n),
        appointments: { today: Number(appointments.today || 0), upcoming: Number(appointments.upcoming || 0) },
        announcements: Number(announcements.n),
        recent_requests: recent.map(r => ({ ...r, reference_no: reference('REQ', r.request_id) }))
    });
});

// Registered residents with request counts. ?search=
router.get('/residents', requireStaff, async (req, res) => {
    const params = [];
    let search = '';
    if (req.query.search) {
        const like = `%${String(req.query.search).trim()}%`;
        search = 'AND (u.full_name LIKE ? OR u.username LIKE ? OR u.email LIKE ? OR u.phone_number LIKE ?)';
        params.push(like, like, like, like);
    }
    const rows = await db.query(
        `SELECT u.*, (SELECT COUNT(*) FROM document_requests r WHERE r.user_id = u.user_id) AS request_count
         FROM users u WHERE u.role = 'resident' ${search} ORDER BY u.created_at DESC`,
        params
    );
    // Profile photos are left out of the list to keep the response small.
    res.json(rows.map(r => ({ ...formatUser({ ...r, profile_pic: null }), request_count: Number(r.request_count) })));
});

// Deactivate or reactivate a resident account: { "is_active": false }
router.patch('/residents/:id', requireAdmin, async (req, res) => {
    const id = v.positiveInt(req.params.id, 'Resident ID');
    const isActive = v.bool(req.body || {}, 'is_active', { required: true, label: 'is_active' });
    const result = await db.query("UPDATE users SET is_active = ? WHERE user_id = ? AND role = 'resident'", [isActive, id]);
    if (result.affectedRows === 0) throw notFound('Resident not found.');
    res.json({ message: `Resident account ${isActive ? 'activated' : 'deactivated'}.` });
});

// ?status=Failed&limit=100
router.get('/sms-logs', requireAdmin, async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit || '100', 10) || 100, 1), 1000);
    const params = [];
    let where = '';
    if (req.query.status) {
        where = 'WHERE s.status = ?';
        params.push(req.query.status);
    }
    const rows = await db.query(
        `SELECT s.log_id, s.user_id, COALESCE(u.full_name, u.username) AS recipient_name, s.phone_number, s.message, s.status, s.sent_at
         FROM sms_logs s LEFT JOIN users u ON u.user_id = s.user_id ${where}
         ORDER BY s.sent_at DESC, s.log_id DESC LIMIT ${limit}`,
        params
    );
    res.json(rows);
});

module.exports = router;
