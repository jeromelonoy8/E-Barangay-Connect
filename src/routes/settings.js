const express = require('express');
const { requireAdmin } = require('../middleware/auth');
const { getSettings, updateSettings } = require('../services/settings');

const router = express.Router();

// Public: pages need these to fill dropdowns (time slots, categories, positions).
router.get('/', async (req, res) => {
    res.json(await getSettings());
});

router.put('/', requireAdmin, async (req, res) => {
    const settings = await updateSettings(req.body, req.user.user_id);
    res.json({ message: 'Settings saved.', settings });
});

module.exports = router;
