const mysql = require('mysql2/promise');
const config = require('./config');

const pool = mysql.createPool({
    ...config.db,
    waitForConnections: true,
    connectionLimit: 10,
    // Keep DATE columns as plain 'YYYY-MM-DD' strings so they never shift across time zones.
    dateStrings: ['DATE'],
    timezone: 'Z',
    supportBigNumbers: true
});

// Store and read every TIMESTAMP in UTC regardless of the database server's own time zone.
pool.pool.on('connection', (connection) => {
    connection.query("SET time_zone = '+00:00'");
});

async function query(sql, params) {
    const [rows] = await pool.query(sql, params);
    return rows;
}

async function withTransaction(work) {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const result = await work(connection);
        await connection.commit();
        return result;
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
}

module.exports = { pool, query, withTransaction };
