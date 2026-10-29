const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { db, resetDatabase, dropTestDatabase, createUser, startServer, client, PNG, PNG_DATA_URL, pngForm, nextWeekday } = require('./helpers');

let server;
let api;
const tokens = {};
const docTypes = {};

// Values an admin would enter for their barangay; the system has none built in.
const SETTINGS = {
    appointment_time_slots: ['08:00 AM - 09:00 AM', '09:00 AM - 10:00 AM', '01:00 PM - 02:00 PM'],
    appointment_slot_capacity: 2,
    appointment_open_days: [1, 2, 3, 4, 5, 6],
    appointment_purposes: ['Document Pickup', 'Consultation'],
    announcement_categories: ['Community Event', 'Health Notice'],
    official_positions: ['Barangay Captain', 'Kagawad']
};

async function login(path, username, password = 'password123') {
    const res = await api('POST', path, { json: { username, password } });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    return res.data.token;
}

before(async () => {
    await resetDatabase();
    await createUser({ username: 'admin', role: 'admin', phone: '09000000000', position: 'System Admin' });
    for (const [i, name] of ['juan', 'maria', 'pedro', 'jose', 'ana', 'luz'].entries()) {
        await createUser({ username: name, phone: `0917000000${i}` });
    }
    ({ server, base: api } = await startServer());
    api = client(api);

    tokens.admin = await login('/api/auth/admin-login', 'admin');
    for (const name of ['juan', 'maria', 'pedro', 'jose', 'ana', 'luz']) {
        tokens[name] = await login('/api/auth/login', name);
    }
});

after(async () => {
    server.close();
    await dropTestDatabase();
});

describe('static files', () => {
    test('frontend pages are served', async () => {
        assert.equal((await api('GET', '/')).status, 200);
        assert.equal((await api('GET', '/dashboard.html')).status, 200);
        assert.equal((await api('GET', '/styles.css')).status, 200);
        assert.equal((await api('GET', '/api-client.js')).status, 200);
    });

    test('server code, SQL, config and subfolders are not served', async () => {
        for (const path of ['/server.js', '/package.json', '/package-lock.json', '/.env', '/.env.example', '/API.md', '/src/app.js', '/database/setup.js', '/node_modules/express/package.json']) {
            assert.equal((await api('GET', path)).status, 404, path);
        }
    });

    test('unknown API routes return JSON 404', async () => {
        const res = await api('GET', '/api/nope');
        assert.equal(res.status, 404);
        assert.ok(res.data.error);
    });
});

describe('auth', () => {
    test('registration validates input', async () => {
        const bad = await api('POST', '/api/auth/register', { json: { username: 'new1', email: 'new1@example.com', phone_number: '12345', password: 'password123' } });
        assert.equal(bad.status, 400);
        const short = await api('POST', '/api/auth/register', { json: { username: 'new1', email: 'new1@example.com', phone_number: '09171111111', password: 'short' } });
        assert.equal(short.status, 400);
    });

    test('registration normalizes the phone number and rejects duplicates', async () => {
        const ok = await api('POST', '/api/auth/register', { json: { username: 'NewRes', email: 'NewRes@Example.com', phone_number: '+63 917 222 3333', password: 'password123' } });
        assert.equal(ok.status, 201);
        const [row] = await db.query('SELECT username, email, phone_number FROM users WHERE user_id = ?', [ok.data.userId]);
        assert.deepEqual({ ...row }, { username: 'newres', email: 'newres@example.com', phone_number: '09172223333' });

        const dup = await api('POST', '/api/auth/register', { json: { username: 'other', email: 'x@example.com', phone_number: '09172223333', password: 'password123' } });
        assert.equal(dup.status, 409);
        assert.match(dup.data.error, /contact number/);
    });

    test('residents and staff use separate login endpoints', async () => {
        assert.equal((await api('POST', '/api/auth/admin-login', { json: { username: 'juan', password: 'password123' } })).status, 403);
        assert.equal((await api('POST', '/api/auth/login', { json: { username: 'admin', password: 'password123' } })).status, 403);
        assert.equal((await api('POST', '/api/auth/login', { json: { username: 'juan', password: 'wrong-pass' } })).status, 401);
    });

    test('login works with email and returns the user without the password hash', async () => {
        const res = await api('POST', '/api/auth/login', { json: { username: 'juan@example.com', password: 'password123' } });
        assert.equal(res.status, 200);
        assert.equal(res.data.user.username, 'juan');
        assert.equal(res.data.user.password_hash, undefined);
    });

    test('protected endpoints need a valid token and the right role', async () => {
        assert.equal((await api('GET', '/api/auth/me')).status, 401);
        assert.equal((await api('GET', '/api/auth/me', { token: 'garbage' })).status, 401);
        assert.equal((await api('GET', '/api/requests', { token: tokens.juan })).status, 403);
        assert.equal((await api('GET', '/api/auth/me', { token: tokens.juan })).data.user.username, 'juan');
    });
});

describe('settings', () => {
    test('a fresh system has no settings and appointments report not configured', async () => {
        const settings = await api('GET', '/api/settings');
        assert.deepEqual(settings.data, {
            appointment_time_slots: [],
            appointment_slot_capacity: null,
            appointment_open_days: [],
            appointment_purposes: [],
            announcement_categories: [],
            official_positions: []
        });

        const availability = await api('GET', `/api/appointments/availability?date=${nextWeekday(1, 1)}`);
        assert.equal(availability.data.configured, false);
        assert.equal(availability.data.slots.length, 0);

        const book = await api('POST', '/api/appointments', { token: tokens.juan, json: { purpose: 'x', date: nextWeekday(1, 1), time_slot: 'any' } });
        assert.equal(book.status, 409);
        assert.match(book.data.error, /not been set up/);
    });

    test('only admins can change settings, and values are validated', async () => {
        assert.equal((await api('PUT', '/api/settings', { token: tokens.juan, json: { appointment_slot_capacity: 5 } })).status, 403);
        assert.equal((await api('PUT', '/api/settings', { token: tokens.admin, json: { unknown_key: 1 } })).status, 400);
        assert.equal((await api('PUT', '/api/settings', { token: tokens.admin, json: { appointment_open_days: [1, 9] } })).status, 400);
        assert.equal((await api('PUT', '/api/settings', { token: tokens.admin, json: { appointment_time_slots: ['A', 'a'] } })).status, 400);
        assert.equal((await api('PUT', '/api/settings', { token: tokens.admin, json: { appointment_slot_capacity: 0 } })).status, 400);
    });

    test('admin saves the barangay settings', async () => {
        const res = await api('PUT', '/api/settings', { token: tokens.admin, json: SETTINGS });
        assert.equal(res.status, 200);
        assert.deepEqual(res.data.settings, SETTINGS);

        const cleared = await api('PUT', '/api/settings', { token: tokens.admin, json: { official_positions: null } });
        assert.deepEqual(cleared.data.settings.official_positions, []);
        await api('PUT', '/api/settings', { token: tokens.admin, json: { official_positions: SETTINGS.official_positions } });
    });
});

describe('document types', () => {
    test('a fresh system has none; admin adds, edits and deactivates them', async () => {
        assert.deepEqual((await api('GET', '/api/documents')).data, []);

        assert.equal((await api('POST', '/api/documents', { token: tokens.juan, json: { name: 'X' } })).status, 403);
        for (const [key, name, fee] of [['clearance', 'Barangay Clearance', 50], ['indigency', 'Certificate of Indigency', 0], ['cedula', 'Cedula', 25]]) {
            const created = await api('POST', '/api/documents', { token: tokens.admin, json: { name, fee, requirements: 'Valid ID' } });
            assert.equal(created.status, 201);
            docTypes[key] = created.data.doc_type_id;
        }

        const updated = await api('PUT', `/api/documents/${docTypes.cedula}`, { token: tokens.admin, json: { fee: 30 } });
        assert.equal(updated.data.fee, 30);

        await api('DELETE', `/api/documents/${docTypes.cedula}`, { token: tokens.admin });
        assert.equal((await api('GET', '/api/documents')).data.length, 2);
        assert.equal((await api('GET', '/api/documents?include_inactive=true', { token: tokens.admin })).data.length, 3);
    });
});

describe('document requests', () => {
    let requestId;

    test('resident submits a request with a multipart file', async () => {
        const res = await api('POST', '/api/requests', {
            token: tokens.juan,
            form: pngForm({ document_type: 'Barangay Clearance', purpose: 'Employment' })
        });
        assert.equal(res.status, 201, JSON.stringify(res.data));
        requestId = res.data.requestId;
        assert.equal(res.data.request.reference_no, `REQ-${String(requestId).padStart(4, '0')}`);
        assert.equal(res.data.request.status, 'Pending');
        assert.equal(res.data.request.file_count, 1);
    });

    test('resident submits a request with a base64 file in JSON', async () => {
        const res = await api('POST', '/api/requests', {
            token: tokens.maria,
            json: { doc_type_id: docTypes.indigency, purpose: 'Medical assistance', file_data: PNG_DATA_URL, file_name: 'id.png' }
        });
        assert.equal(res.status, 201);
    });

    test('requests without a valid attachment are rejected', async () => {
        const missing = await api('POST', '/api/requests', { token: tokens.juan, json: { doc_type_id: 1, purpose: 'x' } });
        assert.equal(missing.status, 400);

        const html = `data:image/png;base64,${Buffer.from('<script>alert(1)</script> padding').toString('base64')}`;
        const fake = await api('POST', '/api/requests', { token: tokens.juan, json: { doc_type_id: 1, purpose: 'x', file_data: html } });
        assert.equal(fake.status, 400);

        const badType = await api('POST', '/api/requests', { token: tokens.juan, json: { document_type: 'Fake Doc', purpose: 'x', file_data: PNG_DATA_URL } });
        assert.equal(badType.status, 400);
    });

    test('staff cannot submit resident requests', async () => {
        const res = await api('POST', '/api/requests', { token: tokens.admin, json: { doc_type_id: 1, purpose: 'x', file_data: PNG_DATA_URL } });
        assert.equal(res.status, 403);
    });

    test('residents see only their own requests', async () => {
        const mine = await api('GET', '/api/requests/mine', { token: tokens.juan });
        assert.equal(mine.data.length, 1);

        const own = await api('GET', `/api/requests/${requestId}`, { token: tokens.juan });
        assert.equal(own.status, 200);
        assert.equal(own.data.files.length, 1);
        assert.match(own.data.files[0].data_url, /^data:image\/png;base64,/);

        assert.equal((await api('GET', `/api/requests/${requestId}`, { token: tokens.maria })).status, 404);
    });

    test('attachments download for the owner and staff only', async () => {
        const detail = await api('GET', `/api/requests/${requestId}`, { token: tokens.admin });
        const url = detail.data.files[0].download_url;

        const file = await api('GET', url, { token: tokens.juan });
        assert.equal(file.status, 200);
        assert.equal(file.headers.get('content-type'), 'image/png');
        assert.ok(file.data.equals(PNG));

        assert.equal((await api('GET', url, { token: tokens.admin })).status, 200);
        assert.equal((await api('GET', url, { token: tokens.maria })).status, 404);
        assert.equal((await api('GET', url)).status, 401);
    });

    test('staff list supports status filter and reference search', async () => {
        const all = await api('GET', '/api/requests', { token: tokens.admin });
        assert.equal(all.data.length, 2);

        const byRef = await api('GET', `/api/requests?search=REQ-000${requestId}`, { token: tokens.admin });
        assert.deepEqual(byRef.data.map(r => r.request_id), [requestId]);

        const byName = await api('GET', '/api/requests?search=maria', { token: tokens.admin });
        assert.equal(byName.data.length, 1);

        const pending = await api('GET', '/api/requests?status=Pending', { token: tokens.admin });
        assert.equal(pending.data.length, 2);
    });

    test('rejecting needs a reason; the resident can then resubmit', async () => {
        const noReason = await api('PATCH', `/api/requests/${requestId}/status`, { token: tokens.admin, json: { status: 'Rejected' } });
        assert.equal(noReason.status, 400);

        const rejected = await api('PUT', `/api/requests/REQ-000${requestId}/status`, { token: tokens.admin, json: { status: 'Rejected', rejection_reason: 'ID is blurry' } });
        assert.equal(rejected.status, 200);
        assert.equal(rejected.data.request.rejection_reason, 'ID is blurry');
        assert.equal(rejected.data.request.reviewed_by_name, 'admin Test');

        const resubmitted = await api('PUT', `/api/requests/${requestId}/resubmit`, { token: tokens.juan, form: pngForm({ purpose: 'Employment abroad' }) });
        assert.equal(resubmitted.status, 200, JSON.stringify(resubmitted.data));
        assert.equal(resubmitted.data.request.status, 'Pending');
        assert.equal(resubmitted.data.request.rejection_reason, null);
        assert.equal(resubmitted.data.request.purpose, 'Employment abroad');
        assert.equal(resubmitted.data.request.file_count, 2);

        const again = await api('PUT', `/api/requests/${requestId}/resubmit`, { token: tokens.juan, form: pngForm() });
        assert.equal(again.status, 409);
    });

    test('legacy status names are accepted and invalid ones refused', async () => {
        const res = await api('PATCH', `/api/requests/${requestId}/status`, { token: tokens.admin, json: { status: 'READY_FOR_PICKUP' } });
        assert.equal(res.status, 200);
        assert.equal(res.data.request.status, 'Ready for Pickup');

        const bad = await api('PATCH', `/api/requests/${requestId}/status`, { token: tokens.admin, json: { status: 'Teleported' } });
        assert.equal(bad.status, 400);
    });

    test('residents can cancel only pending requests', async () => {
        assert.equal((await api('PATCH', `/api/requests/${requestId}/cancel`, { token: tokens.juan })).status, 409);

        const [maria] = (await api('GET', '/api/requests/mine', { token: tokens.maria })).data;
        const cancelled = await api('PATCH', `/api/requests/${maria.request_id}/cancel`, { token: tokens.maria });
        assert.equal(cancelled.data.request.status, 'Cancelled');

        const staffChange = await api('PATCH', `/api/requests/${maria.request_id}/status`, { token: tokens.admin, json: { status: 'Approved' } });
        assert.equal(staffChange.status, 409);
    });

    test('notifications are logged as skipped when no SMS key is set', async () => {
        await new Promise(resolve => setTimeout(resolve, 300));
        const logs = await api('GET', '/api/admin/sms-logs', { token: tokens.admin });
        assert.equal(logs.status, 200);
        assert.ok(logs.data.length >= 4);
        assert.ok(logs.data.every(l => l.status === 'Skipped'));
        assert.equal((await api('GET', '/api/admin/sms-logs', { token: tokens.juan })).status, 403);
    });
});

describe('appointments', () => {
    const monday = nextWeekday(1, 1);
    const slot = SETTINGS.appointment_time_slots[0];

    test('availability lists every configured slot with its occupancy', async () => {
        const res = await api('GET', `/api/appointments/availability?date=${monday}`);
        assert.equal(res.status, 200);
        assert.equal(res.data.configured, true);
        assert.equal(res.data.is_open, true);
        assert.deepEqual(res.data.slots.map(s => s.time_slot), SETTINGS.appointment_time_slots);
        assert.ok(res.data.slots.every(s => s.booked === 0 && s.available === 2));
    });

    test('booking validates the date and time slot', async () => {
        const book = (json) => api('POST', '/api/appointments', { token: tokens.juan, json: { purpose: 'Document Pickup', time_slot: slot, ...json } });
        assert.equal((await book({ date: '2020-01-06' })).status, 400);
        assert.equal((await book({ date: nextWeekday(0) })).status, 400);
        assert.equal((await book({ date: monday, time_slot: '11:00 PM' })).status, 400);
        assert.equal((await book({ date: monday, purpose: 'Not on the list' })).status, 400);
    });

    test('a slot fills up at capacity and a resident cannot double-book', async () => {
        const first = await api('POST', '/api/appointments', { token: tokens.juan, json: { purpose: 'Document Pickup', date: monday, time_slot: slot } });
        assert.equal(first.status, 201, JSON.stringify(first.data));
        assert.match(first.data.appointment.reference_no, /^APT-\d{4}$/);

        const dup = await api('POST', '/api/appointments', { token: tokens.juan, json: { purpose: 'Consultation', date: monday, time_slot: slot } });
        assert.equal(dup.status, 409);

        assert.equal((await api('POST', '/api/appointments', { token: tokens.maria, json: { purpose: 'Consultation', date: monday, time_slot: slot } })).status, 201);
        const full = await api('POST', '/api/appointments', { token: tokens.pedro, json: { purpose: 'Consultation', date: monday, time_slot: slot } });
        assert.equal(full.status, 409);

        const availability = await api('GET', `/api/appointments/availability?date=${monday}`);
        assert.equal(availability.data.slots[0].is_full, true);
    });

    test('simultaneous bookings never exceed the slot capacity', async () => {
        const tuesday = nextWeekday(2, 1);
        const results = await Promise.all(['pedro', 'jose', 'ana', 'luz'].map(name =>
            api('POST', '/api/appointments', { token: tokens[name], json: { purpose: 'Document Pickup', date: tuesday, time_slot: slot } })
        ));
        assert.equal(results.filter(r => r.status === 201).length, 2);
        assert.ok(results.every(r => r.status === 201 || r.status === 409));
        const [{ n }] = await db.query("SELECT COUNT(*) AS n FROM appointments WHERE scheduled_date = ? AND status = 'Confirmed'", [tuesday]);
        assert.equal(Number(n), 2);
    });

    test('cancelling frees the place again', async () => {
        const [mine] = (await api('GET', '/api/appointments/mine?upcoming=true', { token: tokens.juan })).data;
        assert.equal(mine.date, monday);
        const cancelled = await api('PATCH', `/api/appointments/${mine.appointment_id}/cancel`, { token: tokens.juan });
        assert.equal(cancelled.data.appointment.status, 'Cancelled');

        const pedro = await api('POST', '/api/appointments', { token: tokens.pedro, json: { purpose: 'Consultation', date: monday, time_slot: slot } });
        assert.equal(pedro.status, 201);
    });

    test('staff see all appointments and can update their status', async () => {
        const list = await api('GET', `/api/appointments?date=${monday}&status=Confirmed`, { token: tokens.admin });
        assert.equal(list.data.length, 2);

        const done = await api('PATCH', `/api/appointments/${list.data[0].appointment_id}/status`, { token: tokens.admin, json: { status: 'Completed' } });
        assert.equal(done.data.appointment.status, 'Completed');

        assert.equal((await api('GET', `/api/appointments/${list.data[0].appointment_id}`, { token: tokens.luz })).status, 404);
    });

    test('forecast covers open days only', async () => {
        const res = await api('GET', '/api/appointments/forecast?days=14');
        assert.equal(res.status, 200);
        assert.ok(res.data.days.length >= 11);
        assert.ok(res.data.days.every(d => d.day !== 'Sunday'));
        assert.ok(res.data.days.some(d => d.booked > 0));
    });
});

describe('announcements', () => {
    test('staff manage announcements; everyone can read them', async () => {
        assert.equal((await api('POST', '/api/announcements', { token: tokens.juan, json: { title: 'x', body: 'y' } })).status, 403);
        assert.equal((await api('POST', '/api/announcements', { token: tokens.admin, json: { title: 'x', body: 'y', category: 'Gossip' } })).status, 400);

        const created = await api('POST', '/api/announcements', { token: tokens.admin, json: { title: 'Clean-up Drive', category: 'Community Event', body: 'Saturday 7 AM' } });
        assert.equal(created.status, 201);
        assert.equal(created.data.author_name, 'admin Test');
        const id = created.data.announcement_id;

        const edited = await api('PUT', `/api/announcements/${id}`, { token: tokens.admin, json: { title: 'Clean-up Drive (moved)' } });
        assert.equal(edited.data.title, 'Clean-up Drive (moved)');

        const list = await api('GET', '/api/announcements');
        assert.equal(list.data.length, 1);
        assert.equal((await api('GET', '/api/announcements?category=Health%20Notice')).data.length, 0);

        assert.equal((await api('DELETE', `/api/announcements/${id}`, { token: tokens.admin })).status, 200);
        assert.equal((await api('GET', `/api/announcements/${id}`)).status, 404);
    });
});

describe('officials', () => {
    let officialId;

    test('admin registers an official who can then log in to the admin portal', async () => {
        const badPosition = await api('POST', '/api/officials', {
            token: tokens.admin,
            json: { full_name: 'X', email: 'x@example.com', phone_number: '09181230000', username: 'xx1', position: 'Emperor', password: 'temporary123' }
        });
        assert.equal(badPosition.status, 400);

        const res = await api('POST', '/api/officials', {
            token: tokens.admin,
            json: { full_name: 'Kap Santos', email: 'kap@example.com', phone_number: '09181234567', username: 'kapsantos', position: 'Barangay Captain', password: 'temporary123' }
        });
        assert.equal(res.status, 201, JSON.stringify(res.data));
        officialId = res.data.official.id;
        assert.equal(res.data.official.role, 'official');

        tokens.official = await login('/api/auth/admin-login', 'kapsantos', 'temporary123');
    });

    test('officials handle requests but cannot manage other officials', async () => {
        const req = (await api('GET', '/api/requests', { token: tokens.official })).data.find(r => r.status !== 'Cancelled');
        const res = await api('PATCH', `/api/requests/${req.request_id}/status`, { token: tokens.official, json: { status: 'Completed' } });
        assert.equal(res.status, 200);
        assert.equal(res.data.request.reviewed_by_name, 'Kap Santos');

        assert.equal((await api('POST', '/api/officials', { token: tokens.official, json: {} })).status, 403);
        assert.equal((await api('GET', '/api/officials', { token: tokens.official })).data.length, 2);
    });

    test('the last active admin cannot be demoted or deleted', async () => {
        const [admin] = await db.query("SELECT user_id FROM users WHERE username = 'admin'");
        const demote = await api('PUT', `/api/officials/${admin.user_id}`, { token: tokens.admin, json: { role: 'official' } });
        assert.equal(demote.status, 409);
        assert.equal((await api('DELETE', `/api/officials/${admin.user_id}`, { token: tokens.admin })).status, 409);
    });

    test('admin can reset passwords and deactivate officials', async () => {
        assert.equal((await api('PUT', `/api/officials/${officialId}/password`, { token: tokens.admin, json: { password: 'brandnew123' } })).status, 200);
        await login('/api/auth/admin-login', 'kapsantos', 'brandnew123');

        await api('PUT', `/api/officials/${officialId}`, { token: tokens.admin, json: { is_active: false } });
        assert.equal((await api('GET', '/api/requests', { token: tokens.official })).status, 401);
        assert.equal((await api('POST', '/api/auth/admin-login', { json: { username: 'kapsantos', password: 'brandnew123' } })).status, 403);
    });
});

describe('profile', () => {
    test('residents update details, photo, senior mode and password', async () => {
        const updated = await api('PUT', '/api/profile', { token: tokens.luz, json: { full_name: 'Luz Reyes', address: 'Purok 3', birth_date: '1950-02-14' } });
        assert.equal(updated.status, 200);
        assert.equal(updated.data.user.full_name, 'Luz Reyes');
        assert.equal(updated.data.user.birth_date, '1950-02-14');

        assert.equal((await api('PUT', '/api/profile', { token: tokens.luz, json: { birth_date: '14/02/1950' } })).status, 400);
        assert.equal((await api('PUT', '/api/profile', { token: tokens.luz, json: { email: 'juan@example.com' } })).status, 409);

        const photo = await api('PUT', '/api/profile/photo', { token: tokens.luz, form: pngForm({}, 'photo') });
        assert.equal(photo.status, 200);
        assert.match(photo.data.user.profile_pic, /^data:image\/png;base64,/);
        const pdf = `data:application/pdf;base64,${Buffer.from('%PDF-1.4 fake pdf body').toString('base64')}`;
        assert.equal((await api('PUT', '/api/profile/photo', { token: tokens.luz, json: { photo: pdf } })).status, 400);
        assert.equal((await api('DELETE', '/api/profile/photo', { token: tokens.luz })).data.user.profile_pic, null);

        const senior = await api('PUT', '/api/profile/senior-mode', { token: tokens.luz, json: { enabled: true } });
        assert.equal(senior.data.user.is_senior_mode, true);

        assert.equal((await api('PUT', '/api/profile/password', { token: tokens.luz, json: { current_password: 'nope', new_password: 'newpassword1' } })).status, 400);
        assert.equal((await api('PUT', '/api/profile/password', { token: tokens.luz, json: { current_password: 'password123', new_password: 'newpassword1' } })).status, 200);
        await login('/api/auth/login', 'luz', 'newpassword1');
    });
});

describe('admin dashboard', () => {
    test('stats summarise requests, people and appointments', async () => {
        const res = await api('GET', '/api/admin/stats', { token: tokens.admin });
        assert.equal(res.status, 200);
        assert.equal(res.data.requests.total, 2);
        assert.equal(res.data.requests.by_status.Completed, 1);
        assert.equal(res.data.requests.by_status.Cancelled, 1);
        assert.equal(res.data.residents, 7);
        assert.ok(res.data.appointments.upcoming >= 3);
        assert.equal(res.data.recent_requests.length, 2);
    });

    test('residents list and deactivation', async () => {
        const list = await api('GET', '/api/admin/residents?search=jose', { token: tokens.admin });
        assert.equal(list.data.length, 1);
        const jose = list.data[0];

        assert.equal((await api('PATCH', `/api/admin/residents/${jose.id}`, { token: tokens.admin, json: { is_active: false } })).status, 200);
        assert.equal((await api('GET', '/api/auth/me', { token: tokens.jose })).status, 401);
    });
});
