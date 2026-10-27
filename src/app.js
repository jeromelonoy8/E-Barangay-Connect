const path = require('path');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const config = require('./config');
const { HttpError } = require('./utils/errors');
const { requestsRouter, filesRouter } = require('./routes/requests');

const app = express();
app.set('trust proxy', config.trustProxy);
app.disable('x-powered-by');

app.use(cors({ origin: config.corsOrigin }));
// Large enough for a 5 MB attachment sent as a base64 data URL.
app.use(express.json({ limit: '8mb' }));

// ---------------- API ----------------

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/profile', require('./routes/profile'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/requests', requestsRouter);
app.use('/api/files', filesRouter);
app.use('/api/appointments', require('./routes/appointments'));
app.use('/api/announcements', require('./routes/announcements'));
app.use('/api/officials', require('./routes/officials'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/settings', require('./routes/settings'));

app.use('/api', (req, res) => {
    res.status(404).json({ error: `No API endpoint for ${req.method} ${req.originalUrl}` });
});

// ---------------- Frontend pages ----------------

// Only the HTML/CSS/image files in the project root are public. Server code, SQL files,
// package files and anything in subfolders are never served.
const ROOT = path.join(__dirname, '..');
const PUBLIC_EXTENSIONS = new Set(['.html', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico']);
const serveStatic = express.static(ROOT, { index: 'index.html', dotfiles: 'ignore' });

app.use((req, res, next) => {
    const isRootFile = /^\/[^/]*$/.test(req.path);
    const ext = path.extname(req.path).toLowerCase();
    if (isRootFile && (req.path === '/' || PUBLIC_EXTENSIONS.has(ext))) return serveStatic(req, res, next);
    next();
});

app.use((req, res) => {
    res.status(404).send('Not found');
});

// ---------------- Errors ----------------

const DUPLICATE_MESSAGES = {
    username: 'That username is already taken.',
    email: 'That email address is already registered.',
    phone_number: 'That contact number is already registered.'
};

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    if (err instanceof HttpError) {
        return res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
    }
    if (err instanceof multer.MulterError) {
        const message = err.code === 'LIMIT_FILE_SIZE' ? 'File must be 5 MB or smaller.' : `Upload error: ${err.message}`;
        return res.status(400).json({ error: message });
    }
    if (err.type === 'entity.too.large') {
        return res.status(413).json({ error: 'Request is too large.' });
    }
    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({ error: 'Request body is not valid JSON.' });
    }
    if (err.code === 'ER_DUP_ENTRY') {
        const key = Object.keys(DUPLICATE_MESSAGES).find(k => err.message.includes(k));
        return res.status(409).json({ error: key ? DUPLICATE_MESSAGES[key] : 'That record already exists.' });
    }
    if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_ROW_IS_REFERENCED') {
        return res.status(409).json({ error: 'This record is still in use and cannot be deleted.' });
    }

    console.error(`[ERROR] ${req.method} ${req.originalUrl}:`, err);
    res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
});

module.exports = app;
