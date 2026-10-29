const { pool } = require('./db');

async function seed() {
  try {
    console.log('Starting database seeding...');

    const mockList = [];
    const statuses = ['Pending', 'Approved', 'Ready for Pickup', 'Completed', 'Rejected'];
    const docTypes = [
      'Barangay Clearance', 
      'Certificate of Indigency', 
      'Barangay Residency', 
      'Business Permit Clearance', 
      'Certificate of Good Moral'
    ];
    const names = [
      'Juan Dela Cruz', 'Maria Clara Santos', 'Jose Rizal', 'Andres Bonifacio', 
      'Apolinario Mabini', 'Emilio Aguinaldo', 'Melchora Aquino', 'Gabriela Silang', 
      'Juan Luna', 'Marcelo H. Del Pilar', 'Antonio Luna', 'Gregorio Del Pilar'
    ];

    for (let i = 1; i <= 100; i++) {
      const refNo = `REQ-2026-${String(i).padStart(4, '0')}`;
      const name = `${names[i % names.length]} (${i})`;
      const doc = docTypes[i % docTypes.length];
      const status = statuses[i % statuses.length];
      const purpose = 'Official Requirement';
      const residentId = 1;

      mockList.push([
        refNo,
        residentId,
        name,
        doc,
        purpose,
        status,
        '2026-10-29'
      ]);
    }

    const query = `
      INSERT INTO requests 
        (reference_no, user_id, resident_name, document_type, purpose, status, created_at) 
      VALUES ? 
      ON DUPLICATE KEY UPDATE status=VALUES(status);
    `;

    await pool.query(query, [mockList]);
    console.log('Successfully inserted 100 mock requests into database!');

  } catch (err) {
    console.error('Seeding note:', err.message);
  }
}

module.exports = seed;