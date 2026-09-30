-- 1. Create and Use Database
CREATE DATABASE IF NOT EXISTS e_barangay_db;
USE e_barangay_db;

-- 2. Clean Up Tables (Optional, prevents schema duplication errors)
DROP TABLE IF EXISTS sms_logs;
DROP TABLE IF EXISTS uploaded_files;
DROP TABLE IF EXISTS appointments;
DROP TABLE IF EXISTS document_requests;
DROP TABLE IF EXISTS document_types;
DROP TABLE IF EXISTS users;

-- 3. Users Table (Supports Resident Accounts, Admin Roles & Senior Preferences)
CREATE TABLE users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(100) DEFAULT NULL,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    phone_number VARCHAR(15) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('resident', 'admin') DEFAULT 'resident',
    is_senior_mode BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Document Types Table
CREATE TABLE document_types (
    doc_type_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    fee DECIMAL(10,2) DEFAULT 0.00
);

-- 5. Document Requests Table
CREATE TABLE document_requests (
    request_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    doc_type_id INT NOT NULL,
    status ENUM('Pending', 'Approved', 'Rejected', 'Ready for Pickup') DEFAULT 'Pending',
    scheduled_date DATE,
    scheduled_time_slot VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (doc_type_id) REFERENCES document_types(doc_type_id) ON DELETE CASCADE
);

-- 6. Uploaded Requirement Files Table
CREATE TABLE uploaded_files (
    file_id INT AUTO_INCREMENT PRIMARY KEY,
    request_id INT NOT NULL,
    file_path VARCHAR(255) NOT NULL,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (request_id) REFERENCES document_requests(request_id) ON DELETE CASCADE
);

-- 7. Appointments & Capacity Scheduling Table
CREATE TABLE appointments (
    appointment_id INT AUTO_INCREMENT PRIMARY KEY,
    request_id INT NOT NULL,
    user_id INT NOT NULL,
    scheduled_date DATE NOT NULL,
    time_slot VARCHAR(50) NOT NULL,
    status ENUM('Booked', 'Completed', 'Cancelled') DEFAULT 'Booked',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (request_id) REFERENCES document_requests(request_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- 8. SMS Logs Table
CREATE TABLE sms_logs (
    log_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    message TEXT NOT NULL,
    status ENUM('Sent', 'Failed') DEFAULT 'Sent',
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- 9. Insert Initial Core Document Types
INSERT INTO document_types (name, description, fee) VALUES 
('Barangay Clearance', 'Clearance for employment, business, or legal requirements.', 50.00),
('Certificate of Indigency', 'Certificate for medical, financial, or educational assistance.', 0.00),
('Certificate of Residency', 'Official proof of residing within the barangay.', 30.00),
('First Time Job Seeker Certificate', 'Free certification for first-time job applicants.', 0.00),
('Barangay ID Application', 'Application for official Barangay Identification Card.', 100.00);

-- 10. Insert Default Admin Account (Username: admin | Password: adminpassword)
INSERT INTO users (full_name, username, email, phone_number, password_hash, role) 
VALUES ('Barangay Admin', 'admin', 'admin@barangay.gov.ph', '09000000000', 'adminpassword', 'admin');
