const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bcrypt = require('bcrypt');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Semaphore Credentials
const SEMAPHORE_API_KEY = process.env.SEMAPHORE_API_KEY || '7b09252a2b017b124579f7f187e8fe38';
const SENDER_NAME = process.env.SEMAPHORE_SENDER_NAME || 'SEMAPHORE'; // Set to 'SEMAPHORE' by default for trial/unregistered sender names

// Database Connection Setup
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',      // Replace with your MySQL username
    password: '123456',      // Replace with your MySQL password if set
    database: 'e_barangay_db'
});

db.connect((err) => {
    if (err) {
        console.error('Database connection failed: ', err.stack);
        return;
    }
    console.log('Connected to MySQL Database.');
});

// Helper Function: Format Philippine phone numbers for Semaphore (e.g., 639171234567 or 09171234567 -> 09171234567)
function formatPhoneNumber(phone) {
    if (!phone) return null;
    let cleaned = phone.replace(/\D/g, ''); // Remove non-numeric characters
    if (cleaned.startsWith('639') && cleaned.length === 12) {
        return '0' + cleaned.substring(2);
    }
    if (cleaned.startsWith('9') && cleaned.length === 10) {
        return '0' + cleaned;
    }
    if (cleaned.startsWith('09') && cleaned.length === 11) {
        return cleaned;
    }
    return cleaned;
}

// Real-Time Semaphore SMS Notification Dispatcher
async function sendSMSNotification(userId, message) {
    // 1. Fetch user contact details from DB
    const userSql = 'SELECT phone_number FROM users WHERE user_id = ?';
    db.query(userSql, [userId], async (err, results) => {
        if (err || results.length === 0) {
            console.error(`[SMS ERROR] Could not find user details for User ID ${userId}`);
            return;
        }

        const rawPhone = results[0].phone_number;
        const recipientNumber = formatPhoneNumber(rawPhone);

        if (!recipientNumber) {
            console.error(`[SMS ERROR] Invalid phone number format for User ID ${userId}`);
            return;
        }

        try {
            // 2. Dispatch real-time SMS via Semaphore REST API
            const response = await axios.post(
                'https://semaphore.co/api/v4/messages',
                new URLSearchParams({
                    apikey: SEMAPHORE_API_KEY,
                    number: recipientNumber,
                    message: message,
                    sendername: SENDER_NAME
                }),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                }
            );

            console.log(`[SEMAPHORE SMS SUCCESS] Sent to ${recipientNumber} (User ID ${userId}): "${message}"`);

            // 3. Log successfully sent SMS in Database
            const sqlLog = 'INSERT INTO sms_logs (user_id, message, status) VALUES (?, ?, "Sent")';
            db.query(sqlLog, [userId, message], (err) => {
                if (err) console.error('Failed to log SMS update:', err);
            });

        } catch (error) {
            const errorMsg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
            console.error(`[SEMAPHORE SMS ERROR] Failed to send SMS to User ID ${userId}:`, errorMsg);

            // Log failed SMS attempt in Database
            const sqlLog = 'INSERT INTO sms_logs (user_id, message, status) VALUES (?, ?, "Failed")';
            db.query(sqlLog, [userId, message], (err) => {
                if (err) console.error('Failed to log SMS update:', err);
            });
        }
    });
}

// ---------------- API ENDPOINTS ----------------

// 1. Resident Registration Endpoint
app.post('/api/auth/register', async (req, res) => {
    const { username, email, phone_number, password } = req.body;

    if (!username || !email || !phone_number || !password) {
        return res.status(400).json({ error: 'All fields are required.' });
    }

    try {
        // Hash password before saving to database
        const hashedPassword = await bcrypt.hash(password, 10);

        const sql = 'INSERT INTO users (full_name, username, email, phone_number, password_hash, role) VALUES (?, ?, ?, ?, ?, "resident")';
        
        db.query(sql, [username, username, email, phone_number, hashedPassword], (err, result) => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY') {
                    return res.status(400).json({ error: 'Username, email, or contact number already registered.' });
                }
                return res.status(500).json({ error: err.message });
            }
            res.status(201).json({ message: 'Resident account created successfully!', userId: result.insertId });
        });
    } catch (error) {
        res.status(500).json({ error: 'Error processing password encryption.' });
    }
});

// 2. Resident Login Endpoint
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;

    const sql = 'SELECT * FROM users WHERE (username = ? OR email = ?)';
    db.query(sql, [username, username], async (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) {
            return res.status(401).json({ error: 'Invalid resident credentials.' });
        }

        const user = results[0];

        // Check if account is actually a resident
        if (user.role !== 'resident') {
            return res.status(403).json({ error: 'Access denied. Please use the Admin Portal.' });
        }

        // Verify bcrypt password hash
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid resident credentials.' });
        }

        res.json({
            message: 'Resident login successful',
            user: {
                id: user.user_id,
                username: user.username,
                email: user.email,
                phone: user.phone_number,
                role: user.role,
                isSeniorMode: user.is_senior_mode
            }
        });
    });
});

// 3. Dedicated Admin Login Endpoint
app.post('/api/auth/admin-login', (req, res) => {
    const { username, password } = req.body;

    const sql = 'SELECT * FROM users WHERE (username = ? OR email = ?)';
    db.query(sql, [username, username], async (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) {
            return res.status(401).json({ error: 'Invalid admin credentials.' });
        }

        const admin = results[0];

        // Verify password hash
        const isMatch = await bcrypt.compare(password, admin.password_hash);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid admin credentials.' });
        }

        // Strict role check
        if (admin.role !== 'admin') {
            return res.status(403).json({ error: 'Access denied: Account is not authorized as an Admin.' });
        }

        res.json({
            message: 'Admin authentication successful',
            user: {
                id: admin.user_id,
                username: admin.username,
                email: admin.email,
                role: admin.role
            }
        });
    });
});

// 4. Fetch Available Document Types
app.get('/api/documents', (req, res) => {
    db.query('SELECT * FROM document_types', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// 5. Submit Document Request & Book Appointment
app.post('/api/requests', (req, res) => {
    const { user_id, doc_type_id, scheduled_date, scheduled_time_slot } = req.body;
    const sql = 'INSERT INTO document_requests (user_id, doc_type_id, scheduled_date, scheduled_time_slot) VALUES (?, ?, ?, ?)';
    
    db.query(sql, [user_id, doc_type_id, scheduled_date, scheduled_time_slot], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // Sends real SMS via Semaphore
        sendSMSNotification(user_id, `E-BARANGAY CONNECT: Your document request #${result.insertId} has been submitted for ${scheduled_date}.`);
        res.status(201).json({ message: 'Document request submitted successfully', requestId: result.insertId });
    });
});

// 6. Admin Update Document Request Status
app.patch('/api/requests/:id/status', (req, res) => {
    const requestId = req.params.id;
    const { status } = req.body;

    const getReqSql = 'SELECT user_id FROM document_requests WHERE request_id = ?';
    db.query(getReqSql, [requestId], (err, rows) => {
        if (err || rows.length === 0) return res.status(404).json({ error: 'Request not found' });

        const userId = rows[0].user_id;
        const updateSql = 'UPDATE document_requests SET status = ? WHERE request_id = ?';

        db.query(updateSql, [status, requestId], (err) => {
            if (err) return res.status(500).json({ error: err.message });

            // Custom automated message logic based on status provided by admin
            let smsMessage = `Update: Your request #${requestId} status is now "${status}".`;

            if (status === 'APPROVED_BOOK_APPOINTMENT' || status === 'Approved') {
                smsMessage = `E-BARANGAY CONNECT: Your document request #${requestId} has been APPROVED! Please log in to your portal account to book a date and time slot for pick-up.`;
            } else if (status === 'READY_FOR_PICKUP') {
                smsMessage = `E-BARANGAY CONNECT: Your document request #${requestId} is READY FOR PICKUP at the Barangay Hall on your scheduled slot.`;
            }

            // Sends real SMS via Semaphore
            sendSMSNotification(userId, smsMessage);
            res.json({ message: `Request #${requestId} status updated to ${status}` });
        });
    });
});

// Server Listener
const PORT = 5000;
app.listen(PORT, () => {
    console.log(`E-Barangay Connect server running on port ${PORT}`);
});