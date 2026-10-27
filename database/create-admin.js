// Creates an admin account from details typed in the terminal, or resets an existing
// account's password and makes it an admin. Usage: npm run create-admin
const bcrypt = require('bcrypt');
const v = require('../src/utils/validate');
const { createPrompter, askValid } = require('./prompt');

const field = (validator, name, opts) => (answer) => validator({ [name]: answer }, name, { required: true, ...opts });

async function promptAdmin(prompter, pool) {
    const username = await askValid(prompter, 'Admin username', field(v.username, 'username'));

    const [existing] = await pool.query('SELECT user_id FROM users WHERE username = ?', [username]);
    if (existing.length > 0) {
        const confirm = await prompter.ask(`"${username}" already exists. Reset its password and make it an admin? (y/N)`);
        if (!/^y(es)?$/i.test(confirm)) {
            console.log('No changes made.');
            return null;
        }
        const password = await askPassword(prompter);
        await pool.query("UPDATE users SET password_hash = ?, role = 'admin', is_active = TRUE WHERE user_id = ?", [await bcrypt.hash(password, 10), existing[0].user_id]);
        console.log(`✓ "${username}" is now an admin with the new password.`);
        return existing[0].user_id;
    }

    const fullName = await askValid(prompter, 'Full name', field(v.str, 'full_name', { max: 100, label: 'Full name' }));
    const email = await askValid(prompter, 'Email', field(v.email, 'email'));
    const phone = await askValid(prompter, 'Mobile number (09XXXXXXXXX)', field(v.phone, 'phone_number'));
    const position = await askValid(prompter, 'Position (optional, e.g. Barangay Secretary)', (answer) => v.str({ position: answer }, 'position', { max: 100, label: 'Position' }) || null);
    const password = await askPassword(prompter);

    const [result] = await pool.query(
        "INSERT INTO users (full_name, username, email, phone_number, password_hash, role, position) VALUES (?, ?, ?, ?, ?, 'admin', ?)",
        [fullName, username, email, phone, await bcrypt.hash(password, 10), position]
    );
    console.log(`✓ Admin account "${username}" created.`);
    return result.insertId;
}

async function askPassword(prompter) {
    for (;;) {
        const password = await askValid(prompter, 'Password (8+ characters)', field(v.password, 'password'), { secret: true });
        const confirm = await prompter.ask('Confirm password', { secret: true });
        if (password === confirm) return password;
        if (!prompter.interactive) throw new Error('Passwords do not match.');
        console.log('  ✗ Passwords do not match. Try again.');
    }
}

module.exports = { promptAdmin };

if (require.main === module) {
    const { pool } = require('../src/db');
    const prompter = createPrompter();
    promptAdmin(prompter, pool)
        .catch((err) => {
            console.error('Failed to create admin:', err.code === 'ER_DUP_ENTRY' ? 'that email or mobile number is already registered.' : err.message);
            process.exitCode = 1;
        })
        .finally(() => {
            prompter.close();
            pool.end();
        });
}
