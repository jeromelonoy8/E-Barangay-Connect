const axios = require('axios');
const config = require('../config');
const db = require('../db');

const SEMAPHORE_URL = 'https://semaphore.co/api/v4/messages';

async function logSms(userId, phoneNumber, message, status, providerResponse) {
    try {
        await db.query(
            'INSERT INTO sms_logs (user_id, phone_number, message, status, provider_response) VALUES (?, ?, ?, ?, ?)',
            [userId, phoneNumber, message, status, providerResponse ? JSON.stringify(providerResponse).slice(0, 2000) : null]
        );
    } catch (err) {
        console.error('[SMS] Failed to write sms_logs entry:', err.message);
    }
}

async function deliver(userId, message) {
    const rows = await db.query('SELECT phone_number FROM users WHERE user_id = ?', [userId]);
    const phoneNumber = rows[0] && rows[0].phone_number;
    if (!phoneNumber) {
        console.error(`[SMS] No phone number on file for user ${userId}`);
        return;
    }

    if (!config.sms.apiKey) {
        console.log(`[SMS SKIPPED] No SEMAPHORE_API_KEY set. Would send to ${phoneNumber}: "${message}"`);
        await logSms(userId, phoneNumber, message, 'Skipped', null);
        return;
    }

    try {
        const response = await axios.post(
            SEMAPHORE_URL,
            new URLSearchParams({ apikey: config.sms.apiKey, number: phoneNumber, message, sendername: config.sms.senderName }),
            { timeout: 15000 }
        );

        // Semaphore answers HTTP 200 even for errors such as an invalid API key; a real
        // success is an array of queued messages that each carry a message_id.
        const data = response.data;
        const accepted = Array.isArray(data) && data.length > 0 && data.every(m => m.message_id);
        if (accepted) {
            console.log(`[SMS SENT] ${phoneNumber} (user ${userId})`);
            await logSms(userId, phoneNumber, message, 'Sent', data);
        } else {
            console.error(`[SMS FAILED] ${phoneNumber} (user ${userId}):`, JSON.stringify(data));
            await logSms(userId, phoneNumber, message, 'Failed', data);
        }
    } catch (err) {
        const detail = err.response ? err.response.data : err.message;
        console.error(`[SMS FAILED] ${phoneNumber} (user ${userId}):`, JSON.stringify(detail));
        await logSms(userId, phoneNumber, message, 'Failed', detail);
    }
}

// Fire-and-forget: SMS problems must never fail or slow down the API response.
function sendSms(userId, message) {
    deliver(userId, message).catch(err => console.error('[SMS] Unexpected error:', err));
}

module.exports = { sendSms };
