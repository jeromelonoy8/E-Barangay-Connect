USE e_barangay_db;

UPDATE users 
SET password_hash = '$2b$10$wBbw1SW6pJ9xp21yTgQNAeCniKEMLeFzANwwSuC9llYF6rQHC.2Ca',
    role = 'admin' 
WHERE username = 'admin';