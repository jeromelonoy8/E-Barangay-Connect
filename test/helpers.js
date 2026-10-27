// Shared setup for integration tests. Each test file creates its own throwaway database
// (TEST_DB_NAME, default e_barangay_test), fills it with fixture records, and drops the
// whole database when it finishes, so no test data is left behind.
process.env.DB_NAME = process.env.TEST_DB_NAME || 'e_barangay_test';
process.env.SEMAPHORE_API_KEY = '';
process.env.JWT_SECRET = 'test-secret';
process.env.AUTH_RATE_LIMIT = '10000';
process.env.AUTO_MIGRATE = 'false';

if (!process.env.DB_NAME.endsWith('_test')) {
    throw new Error(`Refusing to run tests against "${process.env.DB_NAME}": the database name must end in _test.`);
}

const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const config = require('../src/config');
const db = require('../src/db');
const time = require('../src/utils/time');

async function serverQuery(sql) {
    const { database, ...server } = config.db;
    const conn = await mysql.createConnection(server);
    try {
        await conn.query(sql);
    } finally {
        await conn.end();
    }
}

async function createTestDatabase() {
    await serverQuery(`DROP DATABASE IF EXISTS \`${config.db.database}\``);
    await serverQuery(`CREATE DATABASE \`${config.db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
}

async function dropTestDatabase() {
    await db.pool.end();
    await serverQuery(`DROP DATABASE IF EXISTS \`${config.db.database}\``);
}

async function resetDatabase() {
    await createTestDatabase();
    const { migrate } = require('../database/migrate');
    await migrate({ log: () => {} });
}

async function createUser({ username, role = 'resident', password = 'password123', phone, position = null }) {
    const result = await db.query(
        'INSERT INTO users (full_name, username, email, phone_number, password_hash, role, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [`${username} Test`, username, `${username}@example.com`, phone, await bcrypt.hash(password, 4), role, position]
    );
    return result.insertId;
}

function startServer() {
    const app = require('../src/app');
    return new Promise((resolve) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const base = `http://127.0.0.1:${server.address().port}`;
            resolve({ server, base });
        });
    });
}

function client(base) {
    return async function api(method, path, { token, json, form } = {}) {
        const headers = {};
        let body;
        if (token) headers.Authorization = `Bearer ${token}`;
        if (json !== undefined) {
            headers['Content-Type'] = 'application/json';
            body = JSON.stringify(json);
        } else if (form) {
            body = form;
        }
        const res = await fetch(base + path, { method, headers, body });
        const type = res.headers.get('content-type') || '';
        const data = type.includes('application/json') ? await res.json() : Buffer.from(await res.arrayBuffer());
        return { status: res.status, data, headers: res.headers };
    };
}

// Smallest valid PNG (1x1 transparent pixel).
const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64'
);
const PNG_DATA_URL = `data:image/png;base64,${PNG.toString('base64')}`;

function pngForm(fields = {}, fileField = 'file') {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    form.append(fileField, new Blob([PNG], { type: 'image/png' }), 'valid-id.png');
    return form;
}

// Next date (from tomorrow onward) that falls on the given weekday, 0 = Sunday.
function nextWeekday(dayIndex, weeksAhead = 0) {
    let date = time.addDays(time.today(), 1);
    while (time.dayOfWeek(date) !== dayIndex) date = time.addDays(date, 1);
    return time.addDays(date, weeksAhead * 7);
}

module.exports = {
    db, createTestDatabase, dropTestDatabase, resetDatabase, createUser, startServer, client,
    PNG, PNG_DATA_URL, pngForm, nextWeekday
};
