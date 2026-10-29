const config = require('./src/config');
const app = require('./src/app');
const { pool } = require('./src/db');
const { migrate } = require('./database/migrate');

async function start() {
    try {
        await pool.query('SELECT 1');
        console.log('Connected to MySQL Database successfully.');
        // Keeps the hosted database schema in step with the code on every deploy.
        if (config.autoMigrate) await migrate();
    } catch (err) {
        console.error('Database startup failed:', err.message);
        process.exit(1);
    }

    app.listen(config.port, () => {
        console.log(`E-Barangay Connect server running on port ${config.port}`);
    });
}

start();
