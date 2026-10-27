// One-time setup for a new machine: writes .env, creates the database, builds the tables
// and creates the first admin account. Safe to run again; finished steps are skipped.
// Usage: npm run setup
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createPrompter, askValid } = require('./prompt');

const ENV_PATH = path.join(__dirname, '..', '.env');

function envLine(key, value) {
    const text = String(value);
    if (!/[\s#"'=]/.test(text)) return `${key}=${text}`;
    return text.includes("'") ? `${key}="${text}"` : `${key}='${text}'`;
}

async function writeEnvFile(prompter) {
    console.log('\nDatabase connection (MySQL 8 or MariaDB). The database itself is created for you.');
    const host = await prompter.ask('Database host', { defaultValue: '127.0.0.1' });
    const port = await askValid(prompter, 'Database port', (a) => {
        if (!/^\d+$/.test(a)) throw new Error('Port must be a number.');
        return a;
    }, { defaultValue: '3306' });
    const user = await askValid(prompter, 'Database user', (a) => {
        if (!a) throw new Error('Database user is required.');
        return a;
    });
    const password = await prompter.ask('Database password (leave blank if none)', { secret: true });
    const name = await askValid(prompter, 'Database name', (a) => {
        if (!/^\w+$/.test(a)) throw new Error('Use letters, numbers and underscores only.');
        return a;
    }, { defaultValue: 'e_barangay_db' });
    const ssl = await prompter.ask('Does the database require SSL/TLS? Hosted ones like Aiven do (y/N)');
    const appPort = await prompter.ask('API server port', { defaultValue: '5000' });
    const smsKey = await prompter.ask('Semaphore SMS API key (leave blank to log SMS instead of sending)', { secret: true });

    const lines = [
        '# Created by npm run setup. See .env.example for every option.',
        envLine('DB_HOST', host),
        envLine('DB_PORT', port),
        envLine('DB_USER', user),
        envLine('DB_PASSWORD', password),
        envLine('DB_NAME', name),
        ...(/^y(es)?$/i.test(ssl) ? ['DB_SSL=true'] : []),
        envLine('PORT', appPort),
        '',
        envLine('JWT_SECRET', crypto.randomBytes(48).toString('hex')),
        'JWT_EXPIRES_IN=7d',
        '',
        envLine('SEMAPHORE_API_KEY', smsKey),
        'SEMAPHORE_SENDER_NAME=SEMAPHORE',
        ''
    ];
    fs.writeFileSync(ENV_PATH, lines.join('\n'));
    console.log('✓ Saved .env');
}

async function createDatabase() {
    const mysql = require('mysql2/promise');
    const config = require('../src/config');
    const { database, ...server } = config.db;

    const conn = await mysql.createConnection(server);
    try {
        await conn.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        console.log(`✓ Database "${database}" is ready`);
    } finally {
        await conn.end();
    }
}

async function main() {
    const prompter = createPrompter();
    let pool;
    try {
        console.log('E-Barangay Connect setup');

        if (fs.existsSync(ENV_PATH)) {
            console.log('✓ Using the existing .env (delete it and run setup again to start over)');
        } else {
            await writeEnvFile(prompter);
        }

        try {
            await createDatabase();
        } catch (err) {
            throw new Error(`Could not connect to or create the database: ${err.message}\n` +
                'Check the settings in .env. If this user may not create databases, create it yourself and run setup again.');
        }

        ({ pool } = require('../src/db'));
        const { migrate } = require('./migrate');
        await migrate();
        console.log('✓ Tables are up to date');

        const [[{ admins }]] = await pool.query("SELECT COUNT(*) AS admins FROM users WHERE role = 'admin' AND is_active = TRUE");
        if (Number(admins) > 0) {
            console.log('✓ An admin account already exists (use npm run create-admin to add another)');
        } else {
            console.log('\nCreate the first admin account. Use the real details of the person who will manage the system.');
            const { promptAdmin } = require('./create-admin');
            await promptAdmin(prompter, pool);
        }

        console.log(`
Setup complete. Start the server with: npm start

The system starts with no data. Log in as the admin (POST /api/auth/admin-login), then set up:
  1. Settings:        PUT  /api/settings   (time slots, slot capacity, open days, categories, positions)
  2. Document types:  POST /api/documents  (name, fee, requirements)
  3. Officials:       POST /api/officials
See API.md for details.`);
    } catch (err) {
        console.error(`\n✗ Setup failed: ${err.message}`);
        process.exitCode = 1;
    } finally {
        prompter.close();
        if (pool) await pool.end();
    }
}

main();
