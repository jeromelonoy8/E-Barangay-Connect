const express = require('express');
const db = require('../db');
const v = require('../utils/validate');
const { optionalAuth, requireAdmin, isStaff } = require('../middleware/auth');
const { badRequest, notFound } = require('../utils/errors');

const router = express.Router();

function formatDocumentType(row) {
    return {
        doc_type_id: row.doc_type_id,
        name: row.name,
        description: row.description,
        requirements: row.requirements,
        fee: Number(row.fee),
        is_active: Boolean(row.is_active)
    };
}

function readDocumentFields(body, { partial }) {
    const fee = body.fee;
    if (fee !== undefined && (Number.isNaN(Number(fee)) || Number(fee) < 0)) throw badRequest('Fee must be a number of 0 or more.');
    return {
        name: v.str(body, 'name', { required: !partial, max: 100, label: 'Name' }),
        description: v.str(body, 'description', { max: 2000, label: 'Description' }),
        requirements: v.str(body, 'requirements', { max: 2000, label: 'Requirements' }),
        fee: fee === undefined || fee === '' ? undefined : Number(fee),
        is_active: v.bool(body, 'is_active', { label: 'is_active' })
    };
}

// Residents see active types only; staff can pass ?include_inactive=true.
router.get('/', optionalAuth, async (req, res) => {
    const includeInactive = req.query.include_inactive === 'true' && isStaff(req.user);
    const rows = await db.query(
        `SELECT * FROM document_types ${includeInactive ? '' : 'WHERE is_active = TRUE'} ORDER BY name`
    );
    res.json(rows.map(formatDocumentType));
});

router.post('/', requireAdmin, async (req, res) => {
    const fields = readDocumentFields(req.body || {}, { partial: false });
    const result = await db.query(
        'INSERT INTO document_types (name, description, requirements, fee, is_active) VALUES (?, ?, ?, ?, ?)',
        [fields.name, fields.description || null, fields.requirements || null, fields.fee || 0, fields.is_active !== false]
    );
    const [row] = await db.query('SELECT * FROM document_types WHERE doc_type_id = ?', [result.insertId]);
    res.status(201).json(formatDocumentType(row));
});

router.put('/:id', requireAdmin, async (req, res) => {
    const id = v.positiveInt(req.params.id, 'Document type ID');
    const fields = Object.entries(readDocumentFields(req.body || {}, { partial: true })).filter(([, value]) => value !== undefined);
    if (fields.length === 0) throw badRequest('Nothing to update.');

    const result = await db.query(
        `UPDATE document_types SET ${fields.map(([key]) => `${key} = ?`).join(', ')} WHERE doc_type_id = ?`,
        [...fields.map(([, value]) => value), id]
    );
    if (result.affectedRows === 0) throw notFound('Document type not found.');
    const [row] = await db.query('SELECT * FROM document_types WHERE doc_type_id = ?', [id]);
    res.json(formatDocumentType(row));
});

// Document types are deactivated rather than deleted so existing requests keep their history.
router.delete('/:id', requireAdmin, async (req, res) => {
    const id = v.positiveInt(req.params.id, 'Document type ID');
    const result = await db.query('UPDATE document_types SET is_active = FALSE WHERE doc_type_id = ?', [id]);
    if (result.affectedRows === 0) throw notFound('Document type not found.');
    res.json({ message: 'Document type deactivated.' });
});

module.exports = router;
