const config = require('../config');

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
});

// Today's date (YYYY-MM-DD) in the barangay's local time zone, not the server's.
function today() {
    return dateFormatter.format(new Date());
}

function addDays(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

function dayOfWeek(dateStr) {
    return new Date(dateStr + 'T00:00:00Z').getUTCDay();
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

module.exports = { today, addDays, dayOfWeek, DAY_NAMES };
