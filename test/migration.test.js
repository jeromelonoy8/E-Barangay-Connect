// Upgrading a database created by the original schema.sql, with data in the shape the
// previous server left behind, must keep that data and make it usable by the new API.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { db, createTestDatabase, dropTestDatabase, startServer, client, PNG_DATA_URL } = require('./helpers');
const { migrate, helpers } = require('../database/migrate');
const baseline = require('../database/migrations/001_baseline');

let server;
let api;

before(async () => {
    await createTestDatabase();

    // State of the database before this backend: baseline schema plus the two columns the
    // old server.js wrote to, rows created by the old system, and no schema_migrations table.
    const conn = await db.pool.getConnection();
    try {
        await baseline.up(helpers(conn));
    } finally {
        conn.release();
    }
    await db.query('ALTER TABLE document_requests ADD COLUMN file_url LONGTEXT NULL, ADD COLUMN rejection_reason TEXT NULL');

    await db.query("INSERT INTO document_types (name, description, fee) VALUES ('Legacy Clearance', 'Old row', 50.00), ('Legacy Certificate', NULL, 0.00)");
    await db.query(`INSERT INTO users (full_name, username, email, phone_number, password_hash, role) VALUES
        ('Barangay Admin', 'admin', 'admin@barangay.gov.ph', '09000000000', 'adminpassword', 'admin'),
        ('Old Resident', 'oldres', 'old@example.com', '09170000000', 'x', 'resident')`);
    await db.query(`INSERT INTO document_requests (user_id, doc_type_id, status, file_url, rejection_reason) VALUES
        (2, 1, 'Ready for Pickup', ?, NULL),
        (2, 2, 'Rejected', NULL, 'Blurry ID')`, [PNG_DATA_URL]);
    await db.query("INSERT INTO appointments (request_id, user_id, scheduled_date, time_slot, status) VALUES (1, 2, '2026-01-05', '08:30 AM - 09:30 AM', 'Booked')");

    await migrate({ log: () => {} });
    ({ server, base: api } = await startServer());
    api = client(api);
});

after(async () => {
    server.close();
    await dropTestDatabase();
});

test('existing request statuses and rejection reasons survive', async () => {
    const rows = await db.query('SELECT request_id, status, rejection_reason FROM document_requests ORDER BY request_id');
    assert.deepEqual(rows.map(r => [r.status, r.rejection_reason]), [['Ready for Pickup', null], ['Rejected', 'Blurry ID']]);
});

test('legacy base64 attachments are copied into uploaded_files', async () => {
    const files = await db.query('SELECT request_id, mime_type, file_size FROM uploaded_files');
    assert.equal(files.length, 1);
    assert.equal(files[0].request_id, 1);
    assert.equal(files[0].mime_type, 'image/png');
    assert.ok(files[0].file_size > 0);
});

test('old "Booked" appointments become "Confirmed"', async () => {
    const [row] = await db.query('SELECT status FROM appointments');
    assert.equal(row.status, 'Confirmed');
});

test('existing document types are kept exactly and no rows are added anywhere', async () => {
    const types = await db.query('SELECT name, fee, is_active FROM document_types ORDER BY doc_type_id');
    assert.deepEqual(types.map(t => [t.name, t.fee, Boolean(t.is_active)]), [['Legacy Clearance', '50.00', true], ['Legacy Certificate', '0.00', true]]);

    for (const table of ['settings', 'announcements', 'sms_logs']) {
        const [{ n }] = await db.query(`SELECT COUNT(*) AS n FROM ${table}`);
        assert.equal(Number(n), 0, table);
    }
    const [{ n: users }] = await db.query('SELECT COUNT(*) AS n FROM users');
    assert.equal(Number(users), 2);
});

test('a plain-text legacy password logs in once and is upgraded to bcrypt', async () => {
    const res = await api('POST', '/api/auth/admin-login', { json: { username: 'admin', password: 'adminpassword' } });
    assert.equal(res.status, 200);
    const [row] = await db.query("SELECT password_hash FROM users WHERE username = 'admin'");
    assert.match(row.password_hash, /^\$2[aby]\$/);

    // The stored hash itself must not work as a password.
    const withHash = await api('POST', '/api/auth/admin-login', { json: { username: 'admin', password: row.password_hash } });
    assert.equal(withHash.status, 401);
});

test('running migrations again changes nothing', async () => {
    await migrate({ log: () => {} });
    const [{ n }] = await db.query('SELECT COUNT(*) AS n FROM uploaded_files');
    assert.equal(Number(n), 1);
});
