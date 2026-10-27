const express = require('express');
const config = require('../config');
const db = require('../db');
const v = require('../utils/validate');
const { reference } = require('../utils/format');
const { requireAuth, requireStaff, requireResident, isStaff } = require('../middleware/auth');
const { multipartFile, readUploadedFile } = require('../middleware/upload');
const { sendSms } = require('../services/sms');
const { badRequest, notFound, conflict } = require('../utils/errors');

const router = express.Router();

// Older clients sent these values; they map onto the current status names.
const STATUS_ALIASES = {
    APPROVED_BOOK_APPOINTMENT: 'Approved',
    READY_FOR_PICKUP: 'Ready for Pickup',
    Ready: 'Ready for Pickup'
};
const STAFF_STATUSES = config.requestStatuses.filter(s => s !== 'Cancelled');

const SELECT_REQUEST = `
    SELECT r.request_id, r.user_id, r.doc_type_id, r.purpose, r.status, r.rejection_reason,
           r.scheduled_date, r.scheduled_time_slot, r.created_at, r.updated_at, r.reviewed_at,
           r.reviewed_by, reviewer.full_name AS reviewed_by_name,
           u.full_name AS resident_name, u.username AS resident_username,
           u.email AS resident_email, u.phone_number AS resident_phone,
           d.name AS document_type, d.fee,
           (SELECT COUNT(*) FROM uploaded_files f WHERE f.request_id = r.request_id) AS file_count
    FROM document_requests r
    JOIN users u ON u.user_id = r.user_id
    JOIN document_types d ON d.doc_type_id = r.doc_type_id
    LEFT JOIN users reviewer ON reviewer.user_id = r.reviewed_by`;

function formatRequest(row) {
    return {
        request_id: row.request_id,
        reference_no: reference('REQ', row.request_id),
        user_id: row.user_id,
        resident_name: row.resident_name || row.resident_username,
        resident_email: row.resident_email,
        resident_phone: row.resident_phone,
        doc_type_id: row.doc_type_id,
        document_type: row.document_type,
        fee: Number(row.fee),
        purpose: row.purpose,
        status: row.status,
        rejection_reason: row.rejection_reason,
        scheduled_date: row.scheduled_date,
        scheduled_time_slot: row.scheduled_time_slot,
        file_count: Number(row.file_count),
        reviewed_by: row.reviewed_by,
        reviewed_by_name: row.reviewed_by_name,
        reviewed_at: row.reviewed_at,
        created_at: row.created_at,
        updated_at: row.updated_at
    };
}

async function findRequest(id) {
    const rows = await db.query(`${SELECT_REQUEST} WHERE r.request_id = ?`, [id]);
    if (!rows[0]) throw notFound('Request not found.');
    return rows[0];
}

function assertCanView(user, row) {
    if (!isStaff(user) && row.user_id !== user.user_id) throw notFound('Request not found.');
}

async function listFiles(requestId, { withData }) {
    const rows = await db.query(
        `SELECT file_id, file_name, mime_type, file_size, uploaded_at ${withData ? ', file_data' : ''}
         FROM uploaded_files WHERE request_id = ? ORDER BY uploaded_at, file_id`,
        [requestId]
    );
    return rows.map(f => ({
        file_id: f.file_id,
        file_name: f.file_name,
        mime_type: f.mime_type,
        file_size: f.file_size,
        uploaded_at: f.uploaded_at,
        download_url: `/api/files/${f.file_id}`,
        // Inline copy so pages can preview the file without a second authenticated request.
        data_url: withData && f.file_data ? `data:${f.mime_type};base64,${f.file_data.toString('base64')}` : null
    }));
}

async function saveFile(conn, requestId, userId, file) {
    await conn.query(
        'INSERT INTO uploaded_files (request_id, file_name, mime_type, file_size, file_data, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)',
        [requestId, file.name, file.mime, file.size, file.buffer, userId]
    );
}

async function resolveDocumentType(body) {
    if (body.doc_type_id !== undefined && body.doc_type_id !== '') {
        const id = v.positiveInt(body.doc_type_id, 'Document type');
        const rows = await db.query('SELECT * FROM document_types WHERE doc_type_id = ? AND is_active = TRUE', [id]);
        if (!rows[0]) throw badRequest('Selected document type is not available.');
        return rows[0];
    }
    const name = v.str(body, 'document_type', { max: 100, label: 'Document type' });
    if (!name) throw badRequest('Document type is required (doc_type_id or document_type).');
    const rows = await db.query('SELECT * FROM document_types WHERE name = ? AND is_active = TRUE', [name]);
    if (!rows[0]) throw badRequest(`"${name}" is not an available document type.`);
    return rows[0];
}

function statusMessage(ref, status, reason) {
    switch (status) {
        case 'Approved':
            return `E-BARANGAY CONNECT: Your document request ${ref} has been APPROVED! Please log in to your portal account to check details.`;
        case 'Ready for Pickup':
            return `E-BARANGAY CONNECT: Your document request ${ref} is READY FOR PICKUP at the Barangay Hall.`;
        case 'Completed':
            return `E-BARANGAY CONNECT: Your document request ${ref} has been released. Thank you!`;
        case 'Rejected':
            return `E-BARANGAY CONNECT: Your document request ${ref} was REJECTED. Reason: ${reason} Please log in to resubmit requirements.`;
        default:
            return `E-BARANGAY CONNECT: Your request ${ref} status is now "${status}".`;
    }
}

// --- Resident -------------------------------------------------------------

// Submit a new request. Send multipart/form-data with a "file" field, or JSON with
// "file_data" (a base64 data URL) and "file_name".
router.post('/', requireResident, multipartFile.single('file'), async (req, res) => {
    const body = req.body || {};
    const docType = await resolveDocumentType(body);
    const purpose = v.str(body, 'purpose', { required: true, max: 500, label: 'Purpose' });
    const scheduledDate = v.date(body, 'scheduled_date', { label: 'Scheduled date' });
    const scheduledSlot = v.str(body, 'scheduled_time_slot', { max: 50, label: 'Time slot' });
    const file = readUploadedFile(req, { label: 'Attachment' });
    if (!file) throw badRequest('Please attach a valid ID or supporting document.');

    const requestId = await db.withTransaction(async (conn) => {
        const [result] = await conn.query(
            'INSERT INTO document_requests (user_id, doc_type_id, purpose, scheduled_date, scheduled_time_slot) VALUES (?, ?, ?, ?, ?)',
            [req.user.user_id, docType.doc_type_id, purpose, scheduledDate || null, scheduledSlot || null]
        );
        await saveFile(conn, result.insertId, req.user.user_id, file);
        return result.insertId;
    });

    const ref = reference('REQ', requestId);
    sendSms(req.user.user_id, `E-BARANGAY CONNECT: Your request ${ref} for ${docType.name} has been submitted and is pending review.`);
    res.status(201).json({
        message: 'Document request submitted successfully',
        requestId,
        request: formatRequest(await findRequest(requestId))
    });
});

router.get('/mine', requireResident, async (req, res) => {
    const rows = await db.query(`${SELECT_REQUEST} WHERE r.user_id = ? ORDER BY r.created_at DESC, r.request_id DESC`, [req.user.user_id]);
    res.json(rows.map(formatRequest));
});

// Re-upload requirements for a rejected request; it goes back to Pending.
router.put('/:id/resubmit', requireResident, multipartFile.single('file'), async (req, res) => {
    const id = v.referenceId(req.params.id, 'Request ID');
    const row = await findRequest(id);
    if (row.user_id !== req.user.user_id) throw notFound('Request not found.');
    if (row.status !== 'Rejected') throw conflict('Only rejected requests can be resubmitted.');

    const purpose = v.str(req.body || {}, 'purpose', { max: 500, label: 'Purpose' });
    const file = readUploadedFile(req, { label: 'Attachment' });
    if (!file) throw badRequest('Please attach the corrected document.');

    await db.withTransaction(async (conn) => {
        await saveFile(conn, id, req.user.user_id, file);
        await conn.query(
            `UPDATE document_requests SET status = 'Pending', rejection_reason = NULL, reviewed_by = NULL, reviewed_at = NULL
             ${purpose ? ', purpose = ?' : ''} WHERE request_id = ?`,
            purpose ? [purpose, id] : [id]
        );
    });

    sendSms(req.user.user_id, `E-BARANGAY CONNECT: Your request ${reference('REQ', id)} has been resubmitted and is pending review.`);
    res.json({ message: 'Request resubmitted successfully.', request: formatRequest(await findRequest(id)) });
});

router.patch('/:id/cancel', requireResident, async (req, res) => {
    const id = v.referenceId(req.params.id, 'Request ID');
    const row = await findRequest(id);
    if (row.user_id !== req.user.user_id) throw notFound('Request not found.');
    if (row.status !== 'Pending') throw conflict('Only pending requests can be cancelled.');

    await db.query("UPDATE document_requests SET status = 'Cancelled' WHERE request_id = ?", [id]);
    res.json({ message: 'Request cancelled.', request: formatRequest(await findRequest(id)) });
});

// --- Staff ------------------------------------------------------------------

// Filters: ?status=Pending&search=juan&doc_type_id=1&from=2026-10-01&to=2026-10-31
router.get('/', requireStaff, async (req, res) => {
    const where = [];
    const params = [];

    if (req.query.status && req.query.status !== 'All') {
        where.push('r.status = ?');
        params.push(STATUS_ALIASES[req.query.status] || req.query.status);
    }
    if (req.query.doc_type_id) {
        where.push('r.doc_type_id = ?');
        params.push(v.positiveInt(req.query.doc_type_id, 'doc_type_id'));
    }
    if (req.query.from) {
        where.push('r.created_at >= ?');
        params.push(v.date(req.query, 'from', { label: 'from' }));
    }
    if (req.query.to) {
        where.push('r.created_at < DATE_ADD(?, INTERVAL 1 DAY)');
        params.push(v.date(req.query, 'to', { label: 'to' }));
    }
    if (req.query.search) {
        const term = String(req.query.search).trim();
        const idMatch = term.match(/^(?:REQ-)?0*(\d+)$/i);
        const like = `%${term}%`;
        where.push(`(u.full_name LIKE ? OR u.username LIKE ? OR d.name LIKE ? OR r.purpose LIKE ?${idMatch ? ' OR r.request_id = ?' : ''})`);
        params.push(like, like, like, like);
        if (idMatch) params.push(Number(idMatch[1]));
    }

    const rows = await db.query(
        `${SELECT_REQUEST} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.created_at DESC, r.request_id DESC`,
        params
    );
    res.json(rows.map(formatRequest));
});

const updateStatus = async (req, res) => {
    const id = v.referenceId(req.params.id, 'Request ID');
    const body = req.body || {};
    const rawStatus = v.str(body, 'status', { required: true, max: 30, label: 'Status' });
    const status = STATUS_ALIASES[rawStatus] || rawStatus;
    if (!STAFF_STATUSES.includes(status)) throw badRequest(`Status must be one of: ${STAFF_STATUSES.join(', ')}.`);

    const reason = v.str(body, 'rejection_reason', { max: 1000, label: 'Rejection reason' });
    if (status === 'Rejected' && !reason) throw badRequest('A rejection reason is required so the resident knows what to correct.');

    const row = await findRequest(id);
    if (row.status === 'Cancelled') throw conflict('This request was cancelled by the resident.');

    await db.query(
        'UPDATE document_requests SET status = ?, rejection_reason = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE request_id = ?',
        [status, status === 'Rejected' ? reason : null, req.user.user_id, id]
    );

    if (status !== row.status) {
        sendSms(row.user_id, statusMessage(reference('REQ', id), status, reason));
    }
    res.json({ message: `Request ${reference('REQ', id)} status updated to ${status}`, request: formatRequest(await findRequest(id)) });
};

router.patch('/:id/status', requireStaff, updateStatus);
router.put('/:id/status', requireStaff, updateStatus);

// --- Shared ----------------------------------------------------------------

// Full details including attachments (with inline data URLs for previews).
router.get('/:id', requireAuth, async (req, res) => {
    const id = v.referenceId(req.params.id, 'Request ID');
    const row = await findRequest(id);
    assertCanView(req.user, row);
    res.json({ ...formatRequest(row), files: await listFiles(id, { withData: true }) });
});

// Download a single attachment. Owners and staff only.
const filesRouter = express.Router();
filesRouter.get('/:id', requireAuth, async (req, res) => {
    const id = v.positiveInt(req.params.id, 'File ID');
    const rows = await db.query(
        `SELECT f.*, r.user_id AS owner_id FROM uploaded_files f
         JOIN document_requests r ON r.request_id = f.request_id WHERE f.file_id = ?`,
        [id]
    );
    const file = rows[0];
    if (!file || (!isStaff(req.user) && file.owner_id !== req.user.user_id)) throw notFound('File not found.');
    if (!file.file_data) throw notFound('File content is not stored on this server.');

    res.set({
        'Content-Type': file.mime_type || 'application/octet-stream',
        'Content-Length': file.file_data.length,
        'Content-Disposition': `${req.query.download === 'true' ? 'attachment' : 'inline'}; filename="${file.file_name.replace(/"/g, '')}"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store'
    });
    res.send(file.file_data);
});

module.exports = { requestsRouter: router, filesRouter };
