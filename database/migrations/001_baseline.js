// The original schema (formerly schema.sql), created only where tables do not exist yet.
// Structure only: no rows are inserted.
module.exports.up = async ({ query }) => {
    await query(`CREATE TABLE IF NOT EXISTS users (
        user_id INT AUTO_INCREMENT PRIMARY KEY,
        full_name VARCHAR(100) DEFAULT NULL,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        phone_number VARCHAR(15) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role ENUM('resident', 'admin') DEFAULT 'resident',
        is_senior_mode BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    await query(`CREATE TABLE IF NOT EXISTS document_types (
        doc_type_id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        fee DECIMAL(10,2) DEFAULT 0.00
    )`);

    await query(`CREATE TABLE IF NOT EXISTS document_requests (
        request_id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        doc_type_id INT NOT NULL,
        status ENUM('Pending', 'Approved', 'Rejected', 'Ready for Pickup') DEFAULT 'Pending',
        scheduled_date DATE,
        scheduled_time_slot VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
        FOREIGN KEY (doc_type_id) REFERENCES document_types(doc_type_id) ON DELETE CASCADE
    )`);

    await query(`CREATE TABLE IF NOT EXISTS uploaded_files (
        file_id INT AUTO_INCREMENT PRIMARY KEY,
        request_id INT NOT NULL,
        file_path VARCHAR(255) NOT NULL,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (request_id) REFERENCES document_requests(request_id) ON DELETE CASCADE
    )`);

    await query(`CREATE TABLE IF NOT EXISTS appointments (
        appointment_id INT AUTO_INCREMENT PRIMARY KEY,
        request_id INT NOT NULL,
        user_id INT NOT NULL,
        scheduled_date DATE NOT NULL,
        time_slot VARCHAR(50) NOT NULL,
        status ENUM('Booked', 'Completed', 'Cancelled') DEFAULT 'Booked',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (request_id) REFERENCES document_requests(request_id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )`);

    await query(`CREATE TABLE IF NOT EXISTS sms_logs (
        log_id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        message TEXT NOT NULL,
        status ENUM('Sent', 'Failed') DEFAULT 'Sent',
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )`);
};
