const path = require('path');
const multer = require('multer');
const config = require('../config');
const { badRequest } = require('../utils/errors');

// Files are kept in memory and stored in the database, because hosts such as Render
// wipe the local disk on every deploy.
const multipartFile = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.uploads.maxFileBytes, files: 1 }
});

const SIGNATURES = [
    { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
    { mime: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
    { mime: 'image/gif', test: (b) => b.subarray(0, 4).toString('ascii') === 'GIF8' },
    { mime: 'image/webp', test: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
    { mime: 'application/pdf', test: (b) => b.subarray(0, 5).toString('ascii') === '%PDF-' }
];

const EXTENSIONS = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'application/pdf': '.pdf'
};

// Detects the real type from the file's first bytes instead of trusting the client.
function detectMime(buffer) {
    const match = SIGNATURES.find(s => buffer.length >= 12 && s.test(buffer));
    return match ? match.mime : null;
}

function cleanFileName(name, mime) {
    const base = path.basename(String(name || 'attachment')).replace(/[^\w.\- ]+/g, '_').slice(0, 120);
    const fallback = 'attachment' + (EXTENSIONS[mime] || '');
    return base && base !== '.' ? base : fallback;
}

function parseDataUrl(dataUrl) {
    const match = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl));
    if (!match) throw badRequest('File must be a base64 data URL (data:<type>;base64,...).');
    return Buffer.from(match[2].replace(/\s/g, ''), 'base64');
}

/**
 * Reads one uploaded file from either a multipart field (`req.file`) or a base64
 * data URL in the JSON body (`dataField`, with an optional `<dataField>_name`).
 * Returns null when no file was sent.
 */
function readUploadedFile(req, { dataField = 'file_data', nameField = 'file_name', allowed, maxBytes = config.uploads.maxFileBytes, label = 'File' } = {}) {
    let buffer;
    let originalName;

    if (req.file) {
        buffer = req.file.buffer;
        originalName = req.file.originalname;
    } else if (req.body && req.body[dataField]) {
        buffer = parseDataUrl(req.body[dataField]);
        originalName = req.body[nameField];
    } else {
        return null;
    }

    if (buffer.length === 0) throw badRequest(`${label} is empty.`);
    if (buffer.length > maxBytes) throw badRequest(`${label} must be ${Math.floor(maxBytes / (1024 * 1024))} MB or smaller.`);

    const mime = detectMime(buffer);
    const allowedTypes = allowed || Object.keys(EXTENSIONS);
    if (!mime || !allowedTypes.includes(mime)) {
        throw badRequest(`${label} must be one of these types: ${allowedTypes.map(t => EXTENSIONS[t]).join(', ')}.`);
    }

    return { buffer, mime, size: buffer.length, name: cleanFileName(originalName, mime) };
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

module.exports = { multipartFile, readUploadedFile, IMAGE_TYPES };
