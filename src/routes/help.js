const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const v = require('../utils/validate');
const { requireResident } = require('../middleware/auth');

const router = express.Router();
const chatLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'You have reached the assistant message limit. Please try again later.' }
});

router.post('/chat', requireResident, chatLimiter, async (req, res) => {
    const message = v.str(req.body || {}, 'message', { required: true, min: 2, max: 1500, label: 'Message' });
    if (!config.gemini.apiKey) {
        return res.status(503).json({ error: 'The AI assistant is not configured yet. Please contact the barangay office for help.' });
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.gemini.model)}:generateContent`;
    let response;
    try {
        response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': config.gemini.apiKey
            },
            signal: AbortSignal.timeout(15000),
            body: JSON.stringify({
                systemInstruction: {
                    parts: [{
                        text: 'You are the help assistant for a barangay resident-services website in the Philippines. Answer briefly about using this site, appointment booking, document requests, and general barangay services. You cannot see or change a resident’s account, appointment, or request; never claim that you can. Do not request passwords, verification codes, or API keys. Do not invent barangay-specific requirements, schedules, fees, or legal advice; explain that local rules vary and direct the resident to the barangay office for official confirmation. For emergencies, direct the resident to local emergency services.'
                    }]
                },
                contents: [{ role: 'user', parts: [{ text: message }] }],
                generationConfig: { maxOutputTokens: 512, temperature: 0.3 }
            })
        });
    } catch (err) {
        console.error('[CHATBOT] Gemini request failed:', err.message);
        return res.status(502).json({ error: 'The AI assistant is temporarily unavailable. Please try again later.' });
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        console.error(`[CHATBOT] Gemini returned ${response.status}:`, data.error && data.error.message);
        return res.status(502).json({ error: 'The AI assistant is temporarily unavailable. Please try again later.' });
    }

    const reply = (data.candidates && data.candidates[0] && data.candidates[0].content &&
        data.candidates[0].content.parts || [])
        .map(part => part.text || '')
        .join('')
        .trim();
    if (!reply) {
        return res.status(502).json({ error: 'The AI assistant could not prepare a response. Please try again.' });
    }

    res.json({ reply });
});

module.exports = router;
