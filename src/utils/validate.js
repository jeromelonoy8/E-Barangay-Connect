const { badRequest } = require('./errors');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,50}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function str(body, field, { required = false, max = 255, min = 0, label = field } = {}) {
    const raw = body[field];
    if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
        if (required) throw badRequest(`${label} is required.`);
        return undefined;
    }
    if (typeof raw !== 'string' && typeof raw !== 'number') {
        throw badRequest(`${label} must be text.`);
    }
    const value = String(raw).trim();
    if (value.length < min) throw badRequest(`${label} must be at least ${min} characters.`);
    if (value.length > max) throw badRequest(`${label} must be at most ${max} characters.`);
    return value;
}

function email(body, field = 'email', opts = {}) {
    const value = str(body, field, { max: 100, label: 'Email', ...opts });
    if (value !== undefined && !EMAIL_PATTERN.test(value)) throw badRequest('Email address is not valid.');
    return value === undefined ? undefined : value.toLowerCase();
}

function username(body, field = 'username', opts = {}) {
    const value = str(body, field, { max: 50, label: 'Username', ...opts });
    if (value !== undefined && !USERNAME_PATTERN.test(value)) {
        throw badRequest('Username must be 3-50 characters: letters, numbers, dot, dash or underscore.');
    }
    return value === undefined ? undefined : value.toLowerCase();
}

function password(body, field = 'password', opts = {}) {
    const raw = body[field];
    if (raw === undefined || raw === null || raw === '') {
        if (opts.required) throw badRequest(`${opts.label || 'Password'} is required.`);
        return undefined;
    }
    if (typeof raw !== 'string') throw badRequest('Password must be text.');
    if (raw.length < 8) throw badRequest(`${opts.label || 'Password'} must be at least 8 characters.`);
    if (raw.length > 72) throw badRequest(`${opts.label || 'Password'} must be at most 72 characters.`);
    return raw;
}

// Normalizes Philippine mobile numbers to the 11-digit 09XXXXXXXXX format.
function normalizePhone(raw) {
    if (raw === undefined || raw === null) return null;
    const digits = String(raw).replace(/\D/g, '');
    if (digits.startsWith('639') && digits.length === 12) return '0' + digits.substring(2);
    if (digits.startsWith('9') && digits.length === 10) return '0' + digits;
    if (digits.startsWith('09') && digits.length === 11) return digits;
    return null;
}

function phone(body, field = 'phone_number', opts = {}) {
    const value = str(body, field, { max: 20, label: 'Phone number', ...opts });
    if (value === undefined) return undefined;
    const normalized = normalizePhone(value);
    if (!normalized) throw badRequest('Phone number must be a valid Philippine mobile number (e.g. 09171234567).');
    return normalized;
}

function date(body, field, opts = {}) {
    const value = str(body, field, { max: 10, ...opts });
    if (value === undefined) return undefined;
    if (!DATE_PATTERN.test(value) || Number.isNaN(Date.parse(value + 'T00:00:00Z'))) {
        throw badRequest(`${opts.label || field} must be a date in YYYY-MM-DD format.`);
    }
    return value;
}

function oneOf(body, field, allowed, opts = {}) {
    const value = str(body, field, opts);
    if (value !== undefined && !allowed.includes(value)) {
        throw badRequest(`${opts.label || field} must be one of: ${allowed.join(', ')}.`);
    }
    return value;
}

function bool(body, field, { required = false, label = field } = {}) {
    const raw = body[field];
    if (raw === undefined || raw === null || raw === '') {
        if (required) throw badRequest(`${label} is required.`);
        return undefined;
    }
    if (raw === true || raw === 'true' || raw === 1 || raw === '1') return true;
    if (raw === false || raw === 'false' || raw === 0 || raw === '0') return false;
    throw badRequest(`${label} must be true or false.`);
}

function positiveInt(raw, label = 'ID') {
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) throw badRequest(`${label} must be a positive whole number.`);
    return value;
}

// Accepts plain numeric IDs as well as references such as "REQ-0001" or "APT-12".
function referenceId(raw, label = 'ID') {
    const match = String(raw).trim().match(/^(?:[A-Za-z]+-)?0*(\d+)$/);
    if (!match) throw badRequest(`${label} is not valid.`);
    return positiveInt(match[1], label);
}

module.exports = { str, email, username, password, phone, normalizePhone, date, oneOf, bool, positiveInt, referenceId };
