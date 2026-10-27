const crypto = require('crypto');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const env = process.env;
const isProduction = env.NODE_ENV === 'production';

function required(name) {
    if (!env[name]) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return env[name];
}

// A missing JWT secret in development falls back to a per-process random secret,
// which means tokens stop working whenever the server restarts.
let jwtSecret = env.JWT_SECRET;
if (!jwtSecret) {
    if (isProduction) required('JWT_SECRET');
    jwtSecret = crypto.randomBytes(32).toString('hex');
    console.warn('[CONFIG] JWT_SECRET is not set. Using a temporary secret; logins reset on restart.');
}

function parseTrustProxy(value) {
    if (value === undefined || value === '') return 'loopback';
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (/^\d+$/.test(value)) return parseInt(value, 10);
    return value;
}

module.exports = {
    isProduction,
    port: parseInt(env.PORT || '5000', 10),
    corsOrigin: env.CORS_ORIGIN ? env.CORS_ORIGIN.split(',').map(o => o.trim()) : '*',
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    timezone: env.APP_TIMEZONE || 'Asia/Manila',
    // Login/registration attempts allowed per IP address every 15 minutes.
    authRateLimit: parseInt(env.AUTH_RATE_LIMIT || '20', 10),

    db: {
        host: required('DB_HOST'),
        port: parseInt(env.DB_PORT || '3306', 10),
        user: required('DB_USER'),
        password: env.DB_PASSWORD || '',
        database: required('DB_NAME'),
        // Aiven and most hosted MySQL providers require TLS; local servers usually do not.
        ssl: env.DB_SSL === 'true' ? { rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED === 'true' } : undefined
    },

    jwt: {
        secret: jwtSecret,
        expiresIn: env.JWT_EXPIRES_IN || '7d'
    },

    sms: {
        apiKey: env.SEMAPHORE_API_KEY || '',
        senderName: env.SEMAPHORE_SENDER_NAME || 'SEMAPHORE'
    },

    uploads: {
        maxFileBytes: 5 * 1024 * 1024,
        maxProfilePicBytes: 2 * 1024 * 1024
    },

    // Workflow states the API logic depends on. Barangay-specific lists (time slots,
    // categories, positions...) live in the database instead; see services/settings.js.
    requestStatuses: ['Pending', 'Approved', 'Ready for Pickup', 'Completed', 'Rejected', 'Cancelled'],
    appointmentStatuses: ['Confirmed', 'Completed', 'Cancelled', 'No Show']
};
