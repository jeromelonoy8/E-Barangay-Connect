const db = require('../db');

const TABLE_DEFINITIONS = {
    appointments: `CREATE TABLE IF NOT EXISTS appointments (
        appointment_id INT AUTO_INCREMENT PRIMARY KEY,
        request_id INT NULL,
        user_id INT NOT NULL,
        purpose VARCHAR(255) NULL,
        scheduled_date DATE NOT NULL,
        time_slot VARCHAR(50) NOT NULL,
        status ENUM('Pending', 'Confirmed', 'Rejected', 'Completed', 'Cancelled', 'No Show') NOT NULL DEFAULT 'Pending',
        rejection_reason TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_appointments_slot (scheduled_date, time_slot, status),
        CONSTRAINT fk_appointments_request FOREIGN KEY (request_id) REFERENCES document_requests(request_id) ON DELETE SET NULL,
        CONSTRAINT fk_appointments_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )`,
    settings: `CREATE TABLE IF NOT EXISTS settings (
        setting_key VARCHAR(100) PRIMARY KEY,
        setting_value TEXT NOT NULL,
        updated_by INT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_settings_updated_by FOREIGN KEY (updated_by) REFERENCES users(user_id) ON DELETE SET NULL
    )`
};

const COLUMN_DEFINITIONS = {
    appointments: {
        request_id: 'INT NULL',
        user_id: 'INT NULL',
        purpose: 'VARCHAR(255) NULL',
        scheduled_date: 'DATE NULL',
        time_slot: 'VARCHAR(50) NULL',
        status: "VARCHAR(30) NOT NULL DEFAULT 'Pending'",
        rejection_reason: 'TEXT NULL',
        created_at: 'TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP',
        updated_at: 'TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP'
    },
    settings: {
        setting_key: 'VARCHAR(100) NULL',
        setting_value: 'TEXT NULL',
        updated_by: 'INT NULL',
        updated_at: 'TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
    }
};

let repairInProgress;

async function repairSchema() {
    for (const [table, definition] of Object.entries(TABLE_DEFINITIONS)) {
        await db.query(definition);

        const columns = await db.query(
            `SELECT COLUMN_NAME FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
            [table]
        );
        const existing = new Set(columns.map(column => column.COLUMN_NAME));
        if (table === 'appointments' && !existing.has('appointment_id')) {
            const primaryKeys = await db.query(
                `SELECT COLUMN_NAME FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_KEY = 'PRI'`,
                [table]
            );
            const key = primaryKeys.length ? 'UNIQUE' : 'PRIMARY KEY';
            await db.query(`ALTER TABLE \`appointments\` ADD COLUMN \`appointment_id\` INT NOT NULL AUTO_INCREMENT ${key}`);
        }
        for (const [column, columnDefinition] of Object.entries(COLUMN_DEFINITIONS[table])) {
            if (!existing.has(column)) {
                await db.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${columnDefinition}`);
            }
        }
    }
}

async function ensureAppointmentSchema() {
    if (!repairInProgress) {
        repairInProgress = repairSchema();
    }
    try {
        await repairInProgress;
    } finally {
        repairInProgress = null;
    }
}

module.exports = { ensureAppointmentSchema };
