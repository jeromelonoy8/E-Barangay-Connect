// Applies pending migrations from database/migrations in filename order.
// Usage: npm run migrate
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/db');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function helpers(conn) {
    const schema = async () => (await conn.query('SELECT DATABASE() AS db'))[0][0].db;

    async function tableExists(table) {
        const [rows] = await conn.query(
            'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
            [await schema(), table]
        );
        return rows.length > 0;
    }

    async function columnExists(table, column) {
        const [rows] = await conn.query(
            'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
            [await schema(), table, column]
        );
        return rows.length > 0;
    }

    async function indexExists(table, index) {
        const [rows] = await conn.query(
            'SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?',
            [await schema(), table, index]
        );
        return rows.length > 0;
    }

    async function addColumn(table, column, definition) {
        if (!(await columnExists(table, column))) {
            await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
        }
    }

    async function addIndex(table, index, columns) {
        if (!(await indexExists(table, index))) {
            await conn.query(`ALTER TABLE \`${table}\` ADD INDEX \`${index}\` (${columns})`);
        }
    }

    async function foreignKeyName(table, column) {
        const [rows] = await conn.query(
            `SELECT CONSTRAINT_NAME AS name FROM information_schema.KEY_COLUMN_USAGE
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
            [await schema(), table, column]
        );
        return rows[0] ? rows[0].name : null;
    }

    return { query: (sql, params) => conn.query(sql, params), tableExists, columnExists, indexExists, addColumn, addIndex, foreignKeyName };
}

async function migrate({ log = console.log } = {}) {
    const conn = await pool.getConnection();
    try {
        await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
            name VARCHAR(255) PRIMARY KEY,
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        const [appliedRows] = await conn.query('SELECT name FROM schema_migrations');
        const applied = new Set(appliedRows.map(r => r.name));
        const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.js')).sort();

        let count = 0;
        for (const file of files) {
            if (applied.has(file)) continue;
            log(`[MIGRATE] Applying ${file}...`);
            const migration = require(path.join(MIGRATIONS_DIR, file));
            // MySQL commits DDL immediately, so every migration step is written to be safe to re-run.
            await migration.up(helpers(conn));
            await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
            count++;
        }
        log(count ? `[MIGRATE] Applied ${count} migration(s).` : '[MIGRATE] Database is up to date.');
    } finally {
        conn.release();
    }
}

module.exports = { migrate, helpers };

if (require.main === module) {
    migrate()
        .then(() => pool.end())
        .catch(async (err) => {
            console.error('[MIGRATE] Failed:', err.message);
            await pool.end();
            process.exit(1);
        });
}
