# E-Barangay Connect API

Backend for resident document requests, appointments, announcements, barangay officials and SMS notifications.
Node.js 20+, Express 5, MySQL 8 / MariaDB.

## Setting up on a new machine

Needs Node.js 20+ and a running MySQL 8 or MariaDB server.

```bash
npm install
npm run setup     # asks for database details, writes .env, creates the database and tables,
                  # then asks for the first admin's real details
npm start         # http://localhost:5000  (npm run dev restarts on file changes)
```

`npm run setup` is safe to run again; it skips anything already done. Other commands:

| Command | What it does |
|---|---|
| `npm run create-admin` | Add another admin, or reset an admin's password (interactive) |
| `npm run migrate` | Apply database changes. Also runs automatically on `npm start` |
| `npm test` | Integration tests (see below) |

### The system starts empty

No sample or default records are created. After logging in as the admin, set up the barangay's real
data in this order:

1. **Settings** (`PUT /api/settings`): appointment time slots, residents per slot, open days,
   announcement categories, official positions. Appointment booking stays off until the first three
   are set.
2. **Document types** (`POST /api/documents`): each document the barangay issues, with its fee and
   requirements. Residents cannot submit requests until at least one exists.
3. **Officials** (`POST /api/officials`): accounts for the staff who will process requests.

To give someone else a copy of your actual data (not just the empty system), export the database with
`mysqldump` and import it on their side.

### Tests

`npm test` creates its own throwaway database (`TEST_DB_NAME`, default `e_barangay_test`), fills it with
fixture records, and **drops it when finished**, so your real database is never touched. The database
user in `.env` needs permission to create and drop that database. Tests refuse to run against a database
whose name does not end in `_test`.

## Deploying (Render + Aiven)

Set these environment variables on Render: `NODE_ENV=production`, `DB_HOST`, `DB_PORT`, `DB_USER`,
`DB_PASSWORD`, `DB_NAME`, `DB_SSL=true`, `JWT_SECRET`, `TRUST_PROXY=1`, `SEMAPHORE_API_KEY`,
`SEMAPHORE_SENDER_NAME`. Migrations run automatically when the server starts.

## Conventions

- **Base URL:** `/api`. Bodies are JSON unless a file is uploaded.
- **Auth:** send `Authorization: Bearer <token>` using the token from a login response. Tokens last 7 days.
- **Roles:** `resident`; `official` (barangay staff); `admin` (staff who can also manage officials,
  document types, residents and SMS logs). "Staff" below means official or admin.
- **Errors:** non-2xx responses return `{ "error": "Human readable message" }`.
  - `400` invalid input
  - `401` not logged in or session expired
  - `403` wrong role
  - `404` not found, or not yours
  - `409` conflict (duplicate, slot full, wrong status)
  - `429` too many login attempts
- **References:** requests and appointments also have `reference_no` (`REQ-0001`, `APT-0001`).
  Any `:id` in a request or appointment URL accepts the number or the reference.
- **Dates:** `YYYY-MM-DD`. Timestamps are ISO 8601 in UTC.
- **Files:** send either `multipart/form-data` with a file field, or JSON with a base64 data URL
  (`data:image/png;base64,...`). Max 5 MB (2 MB for profile photos). Accepted types are JPG, PNG, GIF,
  WEBP and PDF, checked from the file content rather than the name. Profile photos must be images.

## Endpoints

### Auth

| Method | Path | Who | Body / notes |
|---|---|---|---|
| POST | `/auth/register` | public | `username`, `email`, `phone_number`, `password` (8+ chars), optional `full_name` |
| POST | `/auth/login` | residents | `username` (username or email), `password` → `{ token, user }` |
| POST | `/auth/admin-login` | staff | same as above |
| GET | `/auth/me` | any | → `{ user }` |

Logout happens on the client: discard the token.

### Profile (the logged-in user)

| Method | Path | Body |
|---|---|---|
| GET | `/profile` | → user |
| PUT | `/profile` | any of `full_name`, `email`, `phone_number`, `address`, `birth_date` |
| PUT | `/profile/password` | `current_password`, `new_password` |
| PUT | `/profile/photo` | multipart field `photo`, or JSON `{ "photo": "<data URL>" }` |
| DELETE | `/profile/photo` | |
| PUT | `/profile/senior-mode` | `{ "enabled": true }` |

User object: `id, username, full_name, email, phone_number, role, position, address, birth_date,
profile_pic (data URL or null), is_senior_mode, is_active, created_at`.

### Settings

Barangay-specific configuration, stored in the database. Every value is empty until an admin sets it.

| Method | Path | Who | Body / notes |
|---|---|---|---|
| GET | `/settings` | public | All settings. Pages use these to fill dropdowns |
| PUT | `/settings` | admin | Any subset of the keys below. Send `null` to clear one |

| Key | Type | Example | Effect |
|---|---|---|---|
| `appointment_time_slots` | list of text | `["08:30 AM - 09:30 AM", "01:30 PM - 02:30 PM"]` | Slots residents can book |
| `appointment_slot_capacity` | number 1–1000 | `10` | Residents per slot |
| `appointment_open_days` | list of 0–6 | `[1, 2, 3, 4, 5]` (0 = Sunday) | Days the hall accepts appointments |
| `announcement_categories` | list of text | `["General News", "Health Notice"]` | When set, announcements must use one. When empty, category is free text |
| `official_positions` | list of text | `["Barangay Captain", "Kagawad"]` | When set, officials must use one. When empty, position is free text |

### Document types

The list starts empty; the admin adds the documents the barangay actually issues.

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/documents` | public | Active types. Staff may add `?include_inactive=true` |
| POST | `/documents` | admin | `name`, `description`, `requirements`, `fee`, `is_active` |
| PUT | `/documents/:id` | admin | any of the above |
| DELETE | `/documents/:id` | admin | Deactivates; existing requests keep their history |

### Document requests

Statuses: `Pending` → `Approved` → `Ready for Pickup` → `Completed`, or `Rejected` (with a reason)
or `Cancelled` (by the resident while Pending). The old values `APPROVED_BOOK_APPOINTMENT` and
`READY_FOR_PICKUP` are still accepted.

| Method | Path | Who | Body / notes |
|---|---|---|---|
| POST | `/requests` | resident | `doc_type_id` **or** `document_type` (name), `purpose`, plus a file (`file` field, or `file_data` + `file_name`). Optional `scheduled_date`, `scheduled_time_slot` |
| GET | `/requests/mine` | resident | The resident's own requests, newest first |
| GET | `/requests/:id` | owner or staff | Request plus `files[]`, each with `data_url` for previews and `download_url` |
| PUT | `/requests/:id/resubmit` | owner | Only when `Rejected`. New file required, optional `purpose`. Goes back to `Pending` |
| PATCH | `/requests/:id/cancel` | owner | Only when `Pending` |
| GET | `/requests` | staff | Filters: `status`, `search` (name, document, purpose or `REQ-0001`), `doc_type_id`, `from`, `to` |
| PATCH or PUT | `/requests/:id/status` | staff | `status`, plus `rejection_reason` when rejecting |
| GET | `/files/:fileId` | owner or staff | Raw file. Add `?download=true` to force a download |

Request object: `request_id, reference_no, user_id, resident_name, resident_email, resident_phone,
doc_type_id, document_type, fee, purpose, status, rejection_reason, scheduled_date, scheduled_time_slot,
file_count, reviewed_by, reviewed_by_name, reviewed_at, created_at, updated_at`.

Example: submitting from the existing form.

```js
const form = new FormData();
form.append('document_type', document.getElementById('documentType').value);
form.append('purpose', document.getElementById('requestPurpose').value);
form.append('file', document.getElementById('fileInput').files[0]);

const res = await fetch('/api/requests', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },   // no Content-Type: the browser sets it
    body: form
});
```

### Appointments

Time slots, capacity and open days come from [Settings](#settings). Until they are set, availability and
forecast return `configured: false` and booking returns `409`. `time_slot` must exactly match one of
the configured slots. Statuses: `Confirmed`, `Completed`, `Cancelled`, `No Show`.

| Method | Path | Who | Body / notes |
|---|---|---|---|
| GET | `/appointments/availability?date=` | public | Every configured slot with `booked`, `available`, `is_full` |
| GET | `/appointments/forecast?days=7` | public | Bookings per open day, for the weekly traffic cards |
| POST | `/appointments` | resident | `purpose`, `date`, `time_slot`, optional `request_id`. `409` if the slot is full, already booked by this resident, or scheduling is not configured |
| GET | `/appointments/mine` | resident | Add `?upcoming=true` for confirmed appointments from today onward |
| PATCH | `/appointments/:id/cancel` | owner | Only when `Confirmed` |
| GET | `/appointments/:id` | owner or staff | |
| GET | `/appointments` | staff | Filters: `date`, `from`, `to`, `status`, `search` |
| PATCH | `/appointments/:id/status` | staff | `status` |

Appointment object: `appointment_id, reference_no, user_id, resident_name, resident_phone, request_id,
request_reference_no, purpose, date, time_slot, status, created_at, updated_at`.

### Announcements

Categories come from the `announcement_categories` setting.

| Method | Path | Who | Body / notes |
|---|---|---|---|
| GET | `/announcements` | public | Newest first. `?category=`, `?limit=` |
| GET | `/announcements/:id` | public | |
| POST | `/announcements` | staff | `title`, `body`, `category` (required once categories are configured) |
| PUT | `/announcements/:id` | staff | any of the above |
| DELETE | `/announcements/:id` | staff | |

### Officials (staff accounts)

Positions come from the `official_positions` setting. While it is empty, any position text is accepted.

| Method | Path | Who | Body / notes |
|---|---|---|---|
| GET | `/officials` | staff | |
| GET | `/officials/:id` | staff | |
| POST | `/officials` | admin | `full_name`, `email`, `phone_number`, `username`, `position`, `password`, optional `role` (`official` by default, or `admin`) |
| PUT | `/officials/:id` | admin | any of `full_name`, `email`, `phone_number`, `position`, `role`, `is_active` |
| PUT | `/officials/:id/password` | admin | `password` |
| DELETE | `/officials/:id` | admin | Cannot delete yourself or the last active admin |

### Admin

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/admin/stats` | staff | Request counts by status, residents, officials, today's and upcoming appointments, 5 latest requests |
| GET | `/admin/residents` | staff | `?search=`; includes `request_count` |
| PATCH | `/admin/residents/:id` | admin | `{ "is_active": false }` blocks the resident from logging in |
| GET | `/admin/sms-logs` | admin | `?status=Sent\|Failed\|Skipped`, `?limit=` |

### Other

`GET /api/health` → `{ "status": "ok" }`

## SMS notifications

Residents receive an SMS through Semaphore when they submit, resubmit or book, and when staff approve,
reject, mark ready, complete a request or cancel their appointment. Each attempt is recorded in
`sms_logs`:

- `Sent`: Semaphore accepted the message.
- `Failed`: Semaphore returned an error. The response is stored.
- `Skipped`: `SEMAPHORE_API_KEY` is not set.

Sending never delays or fails the API response.
