const config = require('./src/config');
const app = require('./src/app');
const { pool } = require('./src/db');
const { migrate } = require('./database/migrate');
const seed = require('./src/seed');

async function start() {
    try {
        await pool.query('SELECT 1');
        console.log('Connected to MySQL Database successfully.');

        if (config.autoMigrate) await migrate();

        // Run seed script safely
        if (typeof seed === 'function') {
            await seed();
        }
    } catch (err) {
        console.error('Database startup failed:', err.message);
        process.exit(1);
    }

    app.listen(config.port, () => {
        console.log(`E-Barangay Connect server running on port ${config.port}`);
    });
}

start();