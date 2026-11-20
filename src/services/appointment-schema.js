const db = require('../db');

const TABLE_DEFINITIONS = {
    appointments: `CREATE TABLE IF NOT EXISTS appointments (
        appointment_id INT AUTO_INCREMENT PRIMARY KEY,
        request_id INT NULL,
        user_id INT NOT NULL,
        purpose VARCHAR(255) NULL,
        scheduled_date DATE NOT NULL,
        time_slot VARCHAR(50) NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'Pending',
        rejection_reason TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_appointments_slot (scheduled_date, time_slot, status)
    )`,
    settings: `CREATE TABLE IF NOT EXISTS settings (
        setting_key VARCHAR(100) PRIMARY KEY,
        setting_value TEXT NOT NULL,
        updated_by INT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
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
        const tables = await db.query(
            `SELECT TABLE_NAME FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
            [table]
        );
        if (!tables.length) await db.query(definition);

        const columns = await db.query(
            `SELECT COLUMN_NAME, IS_NULLABLE, DATA_TYPE, COLUMN_TYPE, CHARACTER_MAXIMUM_LENGTH
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
            [table]
        );
        const existing = new Map(columns.map(column => [column.COLUMN_NAME, column]));
        if (table === 'appointments' && existing.has('status')) {
            const status = existing.get('status');
            const allowedStatuses = ["'Pending'", "'Confirmed'", "'Rejected'", "'Completed'", "'Cancelled'", "'No Show'"];
            const oldStatusEnum = status.DATA_TYPE === 'enum' &&
                (status.COLUMN_TYPE.includes("'Booked'") || allowedStatuses.some(value => !status.COLUMN_TYPE.includes(value)));
            const shortStatusText = status.DATA_TYPE === 'varchar' && status.CHARACTER_MAXIMUM_LENGTH < 30;
            if (oldStatusEnum || shortStatusText) {
                await db.query("ALTER TABLE appointments MODIFY status VARCHAR(30) NOT NULL DEFAULT 'Pending'");
                await db.query("UPDATE appointments SET status = 'Confirmed' WHERE status = 'Booked'");
            }
        }
        if (table === 'appointments' && existing.has('request_id') && existing.get('request_id').IS_NULLABLE !== 'YES') {
            const requestIdType = existing.get('request_id').COLUMN_TYPE.toLowerCase().includes('unsigned')
                ? 'INT UNSIGNED'
                : 'INT';
            await db.query(`ALTER TABLE appointments MODIFY request_id ${requestIdType} NULL`);
        }
        if (table === 'appointments' && existing.has('time_slot') && existing.get('time_slot').IS_NULLABLE !== 'YES') {
            await db.query('ALTER TABLE appointments MODIFY time_slot VARCHAR(50) NULL');
        }
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
