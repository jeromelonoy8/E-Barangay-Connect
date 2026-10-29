const express = require('express');
const db = require('../db');
const time = require('../utils/time');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Barangay-wide activity for the dashboards. Totals only, no personal details, so any
// logged-in resident or official may see it.
router.get('/overview', requireAuth, async (req, res) => {
    const today = time.today();
    const [year, month] = today.split('-').map(Number);
    const first = `${today.slice(0, 7)}-01`;
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const last = time.addDays(first, daysInMonth - 1);

    const [bookingRows, [bookingTotals], documentRows, [requestTotals]] = await Promise.all([
        db.query(
            `SELECT scheduled_date, COUNT(*) AS bookings
             FROM appointments
             WHERE scheduled_date BETWEEN ? AND ? AND status <> 'Cancelled'
             GROUP BY scheduled_date`,
            [first, last]
        ),
        db.query(
            `SELECT COUNT(*) AS bookings, COUNT(DISTINCT user_id) AS residents
             FROM appointments
             WHERE scheduled_date BETWEEN ? AND ? AND status <> 'Cancelled'`,
            [first, last]
        ),
        db.query(
            `SELECT d.doc_type_id, d.name AS document_type, COUNT(*) AS requests
             FROM document_requests r
             JOIN document_types d ON d.doc_type_id = r.doc_type_id
             WHERE r.status <> 'Cancelled'
             GROUP BY d.doc_type_id, d.name
             ORDER BY requests DESC, d.name`
        ),
        db.query(
            `SELECT COUNT(*) AS requests FROM document_requests
             WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY) AND status <> 'Cancelled'`,
            [first, last]
        )
    ]);

    const perDay = Object.fromEntries(bookingRows.map(r => [r.scheduled_date, Number(r.bookings)]));
    const byDay = [];
    for (let i = 0; i < daysInMonth; i++) {
        const date = time.addDays(first, i);
        byDay.push({ date, day: i + 1, bookings: perDay[date] || 0 });
    }

    res.json({
        month: today.slice(0, 7),
        month_label: new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
        today,
        bookings: {
            total: Number(bookingTotals.bookings),
            residents: Number(bookingTotals.residents),
            by_day: byDay
        },
        requests_this_month: Number(requestTotals.requests),
        top_documents: documentRows.map(r => ({ doc_type_id: r.doc_type_id, document_type: r.document_type, requests: Number(r.requests) }))
    });
});

module.exports = router;
