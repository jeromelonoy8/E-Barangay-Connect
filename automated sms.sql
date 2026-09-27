USE e_barangay_db;

-- 1. Update a resident user with your actual phone number (e.g., user_id = 1)
UPDATE users 
SET phone_number = '09752693832' 
WHERE user_id = 1;

-- 2. Verify the update worked
SELECT user_id, full_name, phone_number, role FROM users WHERE user_id = 1;

-- 3. Verify there is an existing request for this user
SELECT * FROM document_requests WHERE user_id = 1;