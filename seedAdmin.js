// seedAdmin.js
const mongoose = require('mongoose'); // Replace with your DB library if not using Mongoose
const bcrypt = require('bcrypt');

// 1. Import your User model (adjust the path to match your project structure)
const User = require('./models/User'); 

// 2. Database Connection String (adjust database name/URI if needed)
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/barangay_db';

async function createFirstAdmin() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('Connected to database...');

        // Check if an admin already exists to prevent duplicate creation
        const existingAdmin = await User.findOne({ role: 'admin' });
        if (existingAdmin) {
            console.log('An admin account already exists in the database!');
            process.exit(0);
        }

        // Define initial admin credentials
        const adminUsername = 'admin';
        const adminPassword = 'AdminPassword123!'; // Change this to your desired initial password

        // Hash the password for security
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(adminPassword, saltRounds);

        // Create the new admin object
        const firstAdmin = new User({
            username: adminUsername,
            password: hashedPassword,
            role: 'admin',
            fullName: 'System Administrator'
        });

        await firstAdmin.save();
        console.log('--------------------------------------------------');
        console.log('First Admin Account Created Successfully!');
        console.log(`Username: ${adminUsername}`);
        console.log(`Password: ${adminPassword}`);
        console.log('--------------------------------------------------');

    } catch (error) {
        console.error('Error creating first admin:', error);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}

createFirstAdmin();