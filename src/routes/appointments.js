const express = require('express');
const config = require('../config');
const db = require('../db');
const v = require('../utils/validate');
const time = require('../utils/time');
const { reference } = require('../utils/format');
const { requireAuth, requireStaff, requireResident } = require('../middleware/auth');
const { sendSms } = require('../services/sms');
const { appointmentSchedule } = require('../services/settings');
const { badRequest, notFound, conflict } = require('../utils/errors');

const router = express.Router();

const NOT_CONFIGURED = 'Appointment scheduling has not been set up by the barangay office yet.';

const SELECT_APPOINTMENT = `
    SELECT a.appointment_id, a.user_id, a.request_id, a.purpose, a.scheduled_date, a.time_slot,
           a.status, a.created_at, a.updated_at,
           u.full_name AS resident_name, u.username AS resident_username, u.phone_number AS resident_phone
    FROM appointments a
    JOIN users u ON u.user_id = a.user_id`;

function formatAppointment(row) {
    return {
        appointment_id: row.appointment_id,
        reference_no: reference('APT', row.appointment_id),
        user_id: row.user_id,
        resident_name: row.resident_name || row.resident_username,
        resident_phone: row.resident_phone,
        request_id: row.request_id,
        request_reference_no: row.request_id ? reference('REQ', row.request_id) : null,
        purpose: row.purpose,
        date: row.scheduled_date,
        time_slot: row.time_slot,
        status: row.status,
        created_at: row.created_at,
        updated_at: row.updated_at
    };
}

async function findAppointment(id) {
    const rows = await db.query(`${SELECT_APPOINTMENT} WHERE a.appointment_id = ?`, [id]);
    if (!rows[0]) throw notFound('Appointment not found.');
    return rows[0];
}

function assertBookableDate(schedule, date) {
    if (date < time.today()) throw badRequest('Appointments cannot be booked in the past.');
    if (!schedule.openDays.includes(time.dayOfWeek(date))) throw badRequest('The barangay hall is closed on that day.');
}

async function slotCounts(date) {
    const rows = await db.query(
        "SELECT time_slot, COUNT(*) AS booked FROM appointments WHERE scheduled_date = ? AND status = 'Confirmed' GROUP BY time_slot",
        [date]
    );
    return Object.fromEntries(rows.map(r => [r.time_slot, Number(r.booked)]));
}

// --- Public availability ---------------------------------------------------

// Real-time occupancy of every slot on a date: ?date=YYYY-MM-DD
router.get('/availability', async (req, res) => {
    const date = v.date(req.query, 'date', { required: true, label: 'date' });
    const schedule = await appointmentSchedule();
    const isOpen = schedule.configured && schedule.openDays.includes(time.dayOfWeek(date)) && date >= time.today();
    const counts = await slotCounts(date);
    const capacity = schedule.capacity || 0;

    res.json({
        date,
        configured: schedule.configured,
        is_open: isOpen,
        capacity_per_slot: capacity,
        total_booked: Object.values(counts).reduce((sum, n) => sum + n, 0),
        slots: schedule.timeSlots.map(slot => {
            const booked = counts[slot] || 0;
            return { time_slot: slot, booked, available: Math.max(capacity - booked, 0), is_full: booked >= capacity };
        })
    });
});

// Bookings per open day for the next week (or ?days=N up to 31), starting today.
router.get('/forecast', async (req, res) => {
    const days = Math.min(Math.max(parseInt(req.query.days || '7', 10) || 7, 1), 31);
    const schedule = await appointmentSchedule();
    if (!schedule.configured) {
        return res.json({ configured: false, time_slots: schedule.timeSlots, capacity_per_slot: schedule.capacity || 0, days: [] });
    }
    const start = time.today();
    const end = time.addDays(start, days - 1);

    const rows = await db.query(
        "SELECT scheduled_date, COUNT(*) AS booked FROM appointments WHERE status = 'Confirmed' AND scheduled_date BETWEEN ? AND ? GROUP BY scheduled_date",
        [start, end]
    );
    const counts = Object.fromEntries(rows.map(r => [r.scheduled_date, Number(r.booked)]));
    const dailyCapacity = schedule.capacity * schedule.timeSlots.length;

    const forecast = [];
    for (let i = 0; i < days; i++) {
        const date = time.addDays(start, i);
        const dow = time.dayOfWeek(date);
        if (!schedule.openDays.includes(dow)) continue;
        const booked = counts[date] || 0;
        forecast.push({ date, day: time.DAY_NAMES[dow], booked, capacity: dailyCapacity, utilization: Math.round((booked / dailyCapacity) * 100) });
    }
    res.json({ configured: true, time_slots: schedule.timeSlots, capacity_per_slot: schedule.capacity, days: forecast });
});

// --- Resident -----------------------------------------------------------------

router.post('/', requireResident, async (req, res) => {
    const schedule = await appointmentSchedule();
    if (!schedule.configured) throw conflict(NOT_CONFIGURED);

    const body = req.body || {};
    const purpose = v.str(body, 'purpose', { required: true, max: 255, label: 'Purpose' });
    const date = v.date(body, 'date', { required: true, label: 'Date' });
    const slot = v.oneOf(body, 'time_slot', schedule.timeSlots, { required: true, label: 'Time slot' });
    assertBookableDate(schedule, date);

    let requestId = null;
    if (body.request_id !== undefined && body.request_id !== null && body.request_id !== '') {
        requestId = v.referenceId(body.request_id, 'Request ID');
        const owned = await db.query('SELECT 1 FROM document_requests WHERE request_id = ? AND user_id = ?', [requestId, req.user.user_id]);
        if (owned.length === 0) throw badRequest('That document request does not belong to you.');
    }

    let appointmentId;
    try {
        appointmentId = await db.withTransaction(async (conn) => {
            // Locks the slot's rows (and the gap after them) so two residents cannot both take the last place.
            const [slotRows] = await conn.query(
                "SELECT user_id FROM appointments WHERE scheduled_date = ? AND time_slot = ? AND status = 'Confirmed' FOR UPDATE",
                [date, slot]
            );
            if (slotRows.some(r => r.user_id === req.user.user_id)) throw conflict('You already have an appointment in this time slot.');
            if (slotRows.length >= schedule.capacity) throw conflict('This time slot is already full. Please choose another one.');

            const [result] = await conn.query(
                'INSERT INTO appointments (request_id, user_id, purpose, scheduled_date, time_slot) VALUES (?, ?, ?, ?, ?)',
                [requestId, req.user.user_id, purpose, date, slot]
            );
            return result.insertId;
        });
    } catch (err) {
        if (err.code === 'ER_LOCK_DEADLOCK' || err.code === 'ER_LOCK_WAIT_TIMEOUT') {
            throw conflict('That time slot is being booked by someone else right now. Please try again.');
        }
        throw err;
    }

    const ref = reference('APT', appointmentId);
    sendSms(req.user.user_id, `E-BARANGAY CONNECT: Your appointment ${ref} is confirmed for ${date}, ${slot} at the Barangay Hall.`);
    res.status(201).json({ message: 'Appointment successfully scheduled.', appointment: formatAppointment(await findAppointment(appointmentId)) });
});

// ?upcoming=true limits the list to confirmed appointments from today onward.
router.get('/mine', requireResident, async (req, res) => {
    const upcoming = req.query.upcoming === 'true';
    const rows = await db.query(
        `${SELECT_APPOINTMENT} WHERE a.user_id = ? ${upcoming ? "AND a.status = 'Confirmed' AND a.scheduled_date >= ?" : ''}
         ORDER BY a.scheduled_date ${upcoming ? 'ASC' : 'DESC'}, a.time_slot`,
        upcoming ? [req.user.user_id, time.today()] : [req.user.user_id]
    );
    res.json(rows.map(formatAppointment));
});

router.patch('/:id/cancel', requireResident, async (req, res) => {
    const id = v.referenceId(req.params.id, 'Appointment ID');
    const row = await findAppointment(id);
    if (row.user_id !== req.user.user_id) throw notFound('Appointment not found.');
    if (row.status !== 'Confirmed') throw conflict(`This appointment is already ${row.status.toLowerCase()}.`);

    await db.query("UPDATE appointments SET status = 'Cancelled' WHERE appointment_id = ?", [id]);
    res.json({ message: 'Appointment cancelled.', appointment: formatAppointment(await findAppointment(id)) });
});

// --- Staff --------------------------------------------------------------------

// Filters: ?date=YYYY-MM-DD, ?from=&to=, ?status=Confirmed, ?search=name
router.get('/', requireStaff, async (req, res) => {
    const where = [];
    const params = [];
    if (req.query.date) {
        where.push('a.scheduled_date = ?');
        params.push(v.date(req.query, 'date', { label: 'date' }));
    }
    if (req.query.from) {
        where.push('a.scheduled_date >= ?');
        params.push(v.date(req.query, 'from', { label: 'from' }));
    }
    if (req.query.to) {
        where.push('a.scheduled_date <= ?');
        params.push(v.date(req.query, 'to', { label: 'to' }));
    }
    if (req.query.status && req.query.status !== 'All') {
        where.push('a.status = ?');
        params.push(req.query.status);
    }
    if (req.query.search) {
        const like = `%${String(req.query.search).trim()}%`;
        where.push('(u.full_name LIKE ? OR u.username LIKE ? OR a.purpose LIKE ?)');
        params.push(like, like, like);
    }

    const rows = await db.query(
        `${SELECT_APPOINTMENT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.scheduled_date, a.time_slot, a.appointment_id`,
        params
    );
    res.json(rows.map(formatAppointment));
});

router.patch('/:id/status', requireStaff, async (req, res) => {
    const id = v.referenceId(req.params.id, 'Appointment ID');
    const status = v.oneOf(req.body || {}, 'status', config.appointmentStatuses, { required: true, label: 'Status' });
    const row = await findAppointment(id);

    await db.query('UPDATE appointments SET status = ? WHERE appointment_id = ?', [status, id]);
    if (status === 'Cancelled' && row.status !== 'Cancelled') {
        sendSms(row.user_id, `E-BARANGAY CONNECT: Your appointment ${reference('APT', id)} on ${row.scheduled_date}, ${row.time_slot} was cancelled by the barangay office. Please book a new schedule.`);
    }
    res.json({ message: `Appointment ${reference('APT', id)} marked as ${status}.`, appointment: formatAppointment(await findAppointment(id)) });
});

// --- Shared -------------------------------------------------------------------

router.get('/:id', requireAuth, async (req, res) => {
    const id = v.referenceId(req.params.id, 'Appointment ID');
    const row = await findAppointment(id);
    if (req.user.role === 'resident' && row.user_id !== req.user.user_id) throw notFound('Appointment not found.');
    res.json(formatAppointment(row));
});

module.exports = router;
