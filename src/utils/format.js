function reference(prefix, id) {
    return `${prefix}-${String(id).padStart(4, '0')}`;
}

// Shape returned for any user record. Never includes the password hash.
function formatUser(row) {
    if (!row) return null;
    return {
        id: row.user_id,
        username: row.username,
        full_name: row.full_name,
        email: row.email,
        phone_number: row.phone_number,
        role: row.role,
        position: row.position || null,
        address: row.address || null,
        birth_date: row.birth_date || null,
        profile_pic: row.profile_pic || null,
        is_senior_mode: Boolean(row.is_senior_mode),
        is_active: row.is_active === undefined ? true : Boolean(row.is_active),
        created_at: row.created_at
    };
}

module.exports = { reference, formatUser };
