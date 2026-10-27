// Brings the original schema up to what the API needs: officials, profiles, request review
// fields, stored attachments, standalone appointments, announcements, settings and SMS log
// details. Existing rows are converted where needed; no new rows are inserted.

const REQUEST_STATUSES = "'Pending', 'Approved', 'Ready for Pickup', 'Completed', 'Rejected', 'Cancelled'";
const APPOINTMENT_STATUSES = "'Confirmed', 'Completed', 'Cancelled', 'No Show'";

async function convertEnum(h, table, column, mappings, allowed, fallback) {
    await h.query(`ALTER TABLE \`${table}\` MODIFY \`${column}\` VARCHAR(30) NULL`);
    for (const [from, to] of mappings) {
        await h.query(`UPDATE \`${table}\` SET \`${column}\` = ? WHERE \`${column}\` = ?`, [to, from]);
    }
    await h.query(`UPDATE \`${table}\` SET \`${column}\` = ? WHERE \`${column}\` IS NULL OR \`${column}\` NOT IN (${allowed})`, [fallback]);
    await h.query(`ALTER TABLE \`${table}\` MODIFY \`${column}\` ENUM(${allowed}) NOT NULL DEFAULT '${fallback}'`);
}

async function migrateUsers(h) {
    await h.query("ALTER TABLE users MODIFY role ENUM('resident', 'official', 'admin') NOT NULL DEFAULT 'resident'");
    await h.addColumn('users', 'position', 'VARCHAR(100) NULL AFTER role');
    await h.addColumn('users', 'address', 'VARCHAR(255) NULL');
    await h.addColumn('users', 'birth_date', 'DATE NULL');
    await h.addColumn('users', 'profile_pic', 'MEDIUMTEXT NULL');
    await h.addColumn('users', 'is_active', 'BOOLEAN NOT NULL DEFAULT TRUE');
    await h.addColumn('users', 'updated_at', 'TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP');
}

async function migrateDocumentTypes(h) {
    await h.addColumn('document_types', 'requirements', 'TEXT NULL');
    await h.addColumn('document_types', 'is_active', 'BOOLEAN NOT NULL DEFAULT TRUE');
}

async function migrateDocumentRequests(h) {
    await h.addColumn('document_requests', 'purpose', 'VARCHAR(500) NULL AFTER doc_type_id');
    await h.addColumn('document_requests', 'rejection_reason', 'TEXT NULL');
    await h.addColumn('document_requests', 'reviewed_by', 'INT NULL');
    await h.addColumn('document_requests', 'reviewed_at', 'TIMESTAMP NULL DEFAULT NULL');
    await h.addColumn('document_requests', 'updated_at', 'TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP');

    await convertEnum(h, 'document_requests', 'status', [
        ['APPROVED_BOOK_APPOINTMENT', 'Approved'],
        ['READY_FOR_PICKUP', 'Ready for Pickup'],
        ['Ready', 'Ready for Pickup']
    ], REQUEST_STATUSES, 'Pending');

    if (!(await h.foreignKeyName('document_requests', 'reviewed_by'))) {
        await h.query('ALTER TABLE document_requests ADD CONSTRAINT fk_requests_reviewed_by FOREIGN KEY (reviewed_by) REFERENCES users(user_id) ON DELETE SET NULL');
    }

    // Deleting a document type used to cascade-delete every request for it.
    const docTypeFk = await h.foreignKeyName('document_requests', 'doc_type_id');
    if (docTypeFk && docTypeFk !== 'fk_requests_doc_type') {
        await h.query(`ALTER TABLE document_requests DROP FOREIGN KEY \`${docTypeFk}\``);
    }
    if (docTypeFk !== 'fk_requests_doc_type') {
        await h.query('ALTER TABLE document_requests ADD CONSTRAINT fk_requests_doc_type FOREIGN KEY (doc_type_id) REFERENCES document_types(doc_type_id) ON DELETE RESTRICT');
    }

    await h.addIndex('document_requests', 'idx_requests_status', 'status');
}

async function migrateUploadedFiles(h) {
    await h.query('ALTER TABLE uploaded_files MODIFY file_path VARCHAR(255) NULL');
    await h.addColumn('uploaded_files', 'file_name', "VARCHAR(255) NOT NULL DEFAULT 'attachment'");
    await h.addColumn('uploaded_files', 'mime_type', 'VARCHAR(100) NULL');
    await h.addColumn('uploaded_files', 'file_size', 'INT NULL');
    await h.addColumn('uploaded_files', 'file_data', 'LONGBLOB NULL');
    await h.addColumn('uploaded_files', 'uploaded_by', 'INT NULL');

    if (!(await h.foreignKeyName('uploaded_files', 'uploaded_by'))) {
        await h.query('ALTER TABLE uploaded_files ADD CONSTRAINT fk_files_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES users(user_id) ON DELETE SET NULL');
    }

    // The earlier server stored attachments as base64 data URLs in document_requests.file_url.
    // Copy them into uploaded_files so they show up through the new API. The old column is kept.
    if (!(await h.columnExists('document_requests', 'file_url'))) return;

    const [legacy] = await h.query(`SELECT r.request_id, r.user_id FROM document_requests r
        WHERE r.file_url IS NOT NULL AND r.file_url <> ''
        AND NOT EXISTS (SELECT 1 FROM uploaded_files f WHERE f.request_id = r.request_id)`);

    for (const { request_id: requestId, user_id: userId } of legacy) {
        const [[row]] = await h.query('SELECT file_url FROM document_requests WHERE request_id = ?', [requestId]);
        const match = /^data:([\w/+.-]+);base64,(.+)$/s.exec(row.file_url);
        if (match) {
            const buffer = Buffer.from(match[2], 'base64');
            await h.query(
                'INSERT INTO uploaded_files (request_id, file_name, mime_type, file_size, file_data, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)',
                [requestId, 'attachment', match[1], buffer.length, buffer, userId]
            );
        } else {
            await h.query(
                'INSERT INTO uploaded_files (request_id, file_path, file_name, uploaded_by) VALUES (?, ?, ?, ?)',
                [requestId, row.file_url.slice(0, 255), 'attachment', userId]
            );
        }
    }
}

async function migrateAppointments(h) {
    // Appointments can now be booked on their own, not only for a document request.
    await h.query('ALTER TABLE appointments MODIFY request_id INT NULL');
    await h.addColumn('appointments', 'purpose', 'VARCHAR(255) NULL AFTER user_id');
    await h.addColumn('appointments', 'updated_at', 'TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP');
    await convertEnum(h, 'appointments', 'status', [['Booked', 'Confirmed']], APPOINTMENT_STATUSES, 'Confirmed');
    await h.addIndex('appointments', 'idx_appointments_slot', 'scheduled_date, time_slot, status');
}

async function migrateSmsLogs(h) {
    await h.addColumn('sms_logs', 'phone_number', 'VARCHAR(20) NULL AFTER user_id');
    await h.addColumn('sms_logs', 'provider_response', 'TEXT NULL');
    await h.query("ALTER TABLE sms_logs MODIFY status ENUM('Sent', 'Failed', 'Skipped') NOT NULL DEFAULT 'Sent'");
}

async function createAnnouncements(h) {
    await h.query(`CREATE TABLE IF NOT EXISTS announcements (
        announcement_id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        category VARCHAR(50) NULL,
        body TEXT NOT NULL,
        author_id INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_announcements_created (created_at),
        CONSTRAINT fk_announcements_author FOREIGN KEY (author_id) REFERENCES users(user_id) ON DELETE SET NULL
    )`);
}

// Barangay-managed configuration (time slots, categories, positions...); see src/services/settings.js.
async function createSettings(h) {
    await h.query(`CREATE TABLE IF NOT EXISTS settings (
        setting_key VARCHAR(100) PRIMARY KEY,
        setting_value TEXT NOT NULL,
        updated_by INT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_settings_updated_by FOREIGN KEY (updated_by) REFERENCES users(user_id) ON DELETE SET NULL
    )`);
}

module.exports.up = async (h) => {
    await migrateUsers(h);
    await migrateDocumentTypes(h);
    await migrateDocumentRequests(h);
    await migrateUploadedFiles(h);
    await migrateAppointments(h);
    await migrateSmsLogs(h);
    await createAnnouncements(h);
    await createSettings(h);
};
