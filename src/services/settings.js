// Barangay-specific configuration, stored in the `settings` table and managed by an admin
// through PUT /api/settings. Nothing here has a built-in value: until the barangay sets
// a value, it is empty and the related feature reports that it is not configured.
const db = require('../db');
const { badRequest } = require('../utils/errors');

function textList(maxItems, maxLength) {
    return (value, label) => {
        if (!Array.isArray(value)) throw badRequest(`${label} must be a list.`);
        if (value.length > maxItems) throw badRequest(`${label} can have at most ${maxItems} entries.`);
        const cleaned = value.map((item) => {
            if (typeof item !== 'string' || !item.trim()) throw badRequest(`${label} entries must be non-empty text.`);
            const text = item.trim();
            if (text.length > maxLength) throw badRequest(`${label} entries must be at most ${maxLength} characters.`);
            return text;
        });
        if (new Set(cleaned.map(s => s.toLowerCase())).size !== cleaned.length) {
            throw badRequest(`${label} has duplicate entries.`);
        }
        return cleaned;
    };
}

function weekdays(value, label) {
    if (!Array.isArray(value)) throw badRequest(`${label} must be a list of day numbers (0 = Sunday ... 6 = Saturday).`);
    if (!value.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) {
        throw badRequest(`${label} must only contain day numbers from 0 (Sunday) to 6 (Saturday).`);
    }
    return [...new Set(value)].sort((a, b) => a - b);
}

function wholeNumber(min, max) {
    return (value, label) => {
        const n = Number(value);
        if (!Number.isInteger(n) || n < min || n > max) throw badRequest(`${label} must be a whole number from ${min} to ${max}.`);
        return n;
    };
}

const DEFINITIONS = {
    appointment_time_slots: { label: 'Appointment time slots', unset: [], validate: textList(24, 50) },
    appointment_slot_capacity: { label: 'Appointment slot capacity', unset: null, validate: wholeNumber(1, 1000) },
    appointment_open_days: { label: 'Appointment open days', unset: [], validate: weekdays },
    appointment_purposes: { label: 'Appointment purposes', unset: [], validate: textList(30, 100) },
    announcement_categories: { label: 'Announcement categories', unset: [], validate: textList(50, 50) },
    official_positions: { label: 'Official positions', unset: [], validate: textList(50, 100) }
};

async function getSettings() {
    const rows = await db.query('SELECT setting_key, setting_value FROM settings');
    const stored = Object.fromEntries(rows.map(r => [r.setting_key, JSON.parse(r.setting_value)]));
    return Object.fromEntries(
        Object.entries(DEFINITIONS).map(([key, def]) => [key, key in stored ? stored[key] : def.unset])
    );
}

// Applies a partial update. Sending null for a key clears it.
async function updateSettings(changes, userId) {
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw badRequest('Send an object of settings to change.');
    const keys = Object.keys(changes);
    if (keys.length === 0) throw badRequest('Nothing to update.');

    const unknown = keys.filter(k => !(k in DEFINITIONS));
    if (unknown.length) throw badRequest(`Unknown setting(s): ${unknown.join(', ')}. Valid settings: ${Object.keys(DEFINITIONS).join(', ')}.`);

    // Validate everything before writing anything.
    const writes = keys.map((key) => {
        const def = DEFINITIONS[key];
        return [key, changes[key] === null ? null : def.validate(changes[key], def.label)];
    });

    await db.withTransaction(async (conn) => {
        for (const [key, value] of writes) {
            if (value === null) {
                await conn.query('DELETE FROM settings WHERE setting_key = ?', [key]);
            } else {
                await conn.query(
                    `INSERT INTO settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?)
                     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
                    [key, JSON.stringify(value), userId]
                );
            }
        }
    });
    return getSettings();
}

async function appointmentSchedule() {
    const s = await getSettings();
    const schedule = {
        timeSlots: s.appointment_time_slots,
        capacity: s.appointment_slot_capacity,
        openDays: s.appointment_open_days,
        purposes: s.appointment_purposes
    };
    schedule.configured = schedule.timeSlots.length > 0 && Boolean(schedule.capacity) && schedule.openDays.length > 0;
    return schedule;
}

module.exports = { getSettings, updateSettings, appointmentSchedule, SETTING_KEYS: Object.keys(DEFINITIONS) };
