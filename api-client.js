// Shared helpers every page uses to talk to the E-Barangay Connect API (loaded as api-client.js).
// Residents and officials keep separate sessions, so both portals can be open in one browser.
(function () {
    const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname) || location.protocol === 'file:';
    // Local copies use the local API; deployed pages (hosted on Vercel) use the Render backend.
    const API_BASE = isLocal ? 'http://localhost:5000' : 'https://e-barangay-connect.onrender.com';

    const PORTALS = {
        resident: { token: 'residentToken', user: 'residentUser', login: 'index.html' },
        admin: { token: 'adminToken', user: 'adminUser', login: 'admin.html' }
    };

    function readJson(key) {
        try {
            return JSON.parse(localStorage.getItem(key) || 'null');
        } catch (e) {
            return null;
        }
    }

    const Api = {
        base: API_BASE,

        session(portal) {
            const keys = PORTALS[portal];
            return { token: localStorage.getItem(keys.token), user: readJson(keys.user) };
        },

        saveSession(portal, token, user) {
            const keys = PORTALS[portal];
            if (token) localStorage.setItem(keys.token, token);
            localStorage.setItem(keys.user, JSON.stringify(user));
            if (portal === 'admin') localStorage.setItem('isAdminLoggedIn', 'true');
        },

        clearSession(portal) {
            const keys = PORTALS[portal];
            localStorage.removeItem(keys.token);
            localStorage.removeItem(keys.user);
            if (portal === 'admin') localStorage.removeItem('isAdminLoggedIn');
        },

        // Sends people without a session back to their login page. Call at the top of protected pages.
        requireSession(portal) {
            const session = Api.session(portal);
            if (!session.token) {
                Api.clearSession(portal);
                window.location.replace(PORTALS[portal].login);
                return null;
            }
            return session;
        },

        logout(portal) {
            Api.clearSession(portal);
            window.location.href = PORTALS[portal].login;
        },

        /**
         * Calls the API and returns the parsed JSON. Throws an Error whose message is the
         * server's explanation. Pass `json` for a JSON body or `form` for a FormData upload.
         */
        async request(portal, method, path, { json, form } = {}) {
            const headers = {};
            const token = portal ? Api.session(portal).token : null;
            if (token) headers.Authorization = `Bearer ${token}`;

            let body;
            if (json !== undefined) {
                headers['Content-Type'] = 'application/json';
                body = JSON.stringify(json);
            } else if (form) {
                body = form;
            }

            let res;
            try {
                res = await fetch(API_BASE + path, { method, headers, body });
            } catch (e) {
                throw new Error('Cannot connect to the server. Please check your connection and try again.');
            }

            const data = await res.json().catch(() => ({}));
            if (res.status === 401 && portal && token) {
                // Expired or revoked session: start over at the login page.
                Api.clearSession(portal);
                window.location.replace(PORTALS[portal].login);
            }
            if (!res.ok) {
                const err = new Error(data.error || `Request failed (${res.status}).`);
                err.status = res.status;
                throw err;
            }
            return data;
        },

        get: (portal, path) => Api.request(portal, 'GET', path),

        // Escapes text before it is placed inside HTML, so user input can never inject markup.
        escape(value) {
            return String(value === null || value === undefined ? '' : value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        },

        // "2026-10-29T03:41:00.000Z" or "2026-10-29" -> "Oct 29, 2026"
        formatDate(value) {
            if (!value) return '';
            const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + 'T00:00:00') : new Date(value);
            if (Number.isNaN(date.getTime())) return String(value);
            return date.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
        },

        // Tailwind classes for a request or appointment status badge.
        statusBadge(status) {
            switch (status) {
                case 'Approved':
                case 'Confirmed':
                    return 'bg-emerald-100 text-emerald-800 border-emerald-200';
                case 'Ready for Pickup':
                    return 'bg-blue-100 text-blue-800 border-blue-200';
                case 'Completed':
                    return 'bg-slate-100 text-slate-700 border-slate-200';
                case 'Rejected':
                case 'No Show':
                    return 'bg-red-100 text-red-800 border-red-200';
                case 'Cancelled':
                    return 'bg-gray-100 text-gray-500 border-gray-200';
                default:
                    return 'bg-amber-100 text-amber-800 border-amber-200';
            }
        },

        initials(name) {
            return String(name || '?').trim().charAt(0).toUpperCase() || '?';
        },

        // Shows a profile photo, or the person's initial when there is none, inside `element`.
        renderAvatar(element, user) {
            if (!element) return;
            const name = user ? user.full_name || user.username : '';
            element.innerHTML = user && user.profile_pic
                ? `<img src="${Api.escape(user.profile_pic)}" alt="Profile photo" class="w-full h-full object-cover rounded-full">`
                : `<span>${Api.escape(Api.initials(name))}</span>`;
        },

        /**
         * Shared setup for resident pages: Senior Mode toggle (saved to the profile so it follows
         * the resident to other devices) and logout. Defines the toggleSeniorMode() and
         * handleLogout() functions the navigation bar buttons call.
         */
        setupResidentNav() {
            const user = Api.session('resident').user;
            let active = user && typeof user.is_senior_mode === 'boolean'
                ? user.is_senior_mode
                : localStorage.getItem('senior_mode_active') === 'true';

            function apply() {
                const btnText = document.getElementById('seniorBtnText');
                const btn = document.getElementById('seniorModeBtn');
                document.body.classList.toggle('senior-mode', active);
                if (btnText) btnText.innerText = active ? 'Disable Senior Mode' : 'Senior Mode';
                if (btn) {
                    btn.classList.toggle('bg-amber-400', !active);
                    btn.classList.toggle('hover:bg-amber-500', !active);
                    btn.classList.toggle('bg-emerald-500', active);
                    btn.classList.toggle('hover:bg-emerald-600', active);
                    btn.classList.toggle('text-white', active);
                }
            }

            window.toggleSeniorMode = function toggleSeniorMode() {
                active = !active;
                localStorage.setItem('senior_mode_active', active);
                apply();
                Api.request('resident', 'PUT', '/api/profile/senior-mode', { json: { enabled: active } })
                    .then((data) => Api.saveSession('resident', null, data.user))
                    .catch(() => {});
            };
            window.handleLogout = () => Api.logout('resident');
            apply();
        },

        // "Barangay Captain", or "System Admin" / "Barangay Official" when no position is set.
        staffTitle(user) {
            if (!user) return '';
            return user.position || (user.role === 'admin' ? 'System Admin' : 'Barangay Official');
        },

        /**
         * Shared setup for admin pages: the navigation bar's name and photo, the profile modal
         * (photo, email, phone, password) and logout. Defines the global functions the shared
         * modal markup calls. `onProfileUpdated(user)` runs after the official edits their profile.
         */
        setupAdminNav({ onProfileUpdated } = {}) {
            const alertBox = () => document.getElementById('modalAlert');

            function showModalAlert(text, ok) {
                const box = alertBox();
                box.className = `text-xs text-center py-2 px-3 rounded-lg font-medium ${ok
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                    : 'bg-rose-100 text-rose-800 border border-rose-300'}`;
                box.innerText = text;
            }

            function render(user) {
                if (!user) return;
                const name = user.full_name || user.username;
                const navName = document.getElementById('navProfileName');
                if (navName) navName.innerText = name;
                Api.renderAvatar(document.getElementById('navAvatarContainer'), user);
                Api.renderAvatar(document.getElementById('modalAvatar'), user);
                document.getElementById('modalProfileName').innerText = name;
                document.getElementById('modalProfileRole').innerText = Api.staffTitle(user);
            }

            function updated(user) {
                Api.saveSession('admin', null, user);
                render(user);
                if (onProfileUpdated) onProfileUpdated(user);
            }

            window.openProfileModal = function openProfileModal() {
                const user = Api.session('admin').user || {};
                render(user);
                document.getElementById('profileUsername').value = `@${user.username || ''}`;
                document.getElementById('profileEmail').value = user.email || '';
                document.getElementById('profilePhone').value = user.phone_number || '';
                document.getElementById('changePasswordForm').reset();
                alertBox().classList.add('hidden');
                document.getElementById('profileModal').classList.remove('hidden');
            };

            window.closeProfileModal = function closeProfileModal() {
                document.getElementById('profileModal').classList.add('hidden');
            };

            window.handleImageUpload = async function handleImageUpload(event) {
                const file = event.target.files[0];
                event.target.value = '';
                if (!file) return;
                if (file.size > 2 * 1024 * 1024) {
                    showModalAlert('The photo is larger than 2 MB. Please choose a smaller image.', false);
                    return;
                }
                const form = new FormData();
                form.append('photo', file);
                try {
                    const data = await Api.request('admin', 'PUT', '/api/profile/photo', { form });
                    updated(data.user);
                    showModalAlert('Profile photo updated.', true);
                } catch (err) {
                    showModalAlert(err.message, false);
                }
            };

            window.handleSaveProfileDetails = async function handleSaveProfileDetails(event) {
                event.preventDefault();
                try {
                    const data = await Api.request('admin', 'PUT', '/api/profile', {
                        json: {
                            email: document.getElementById('profileEmail').value.trim(),
                            phone_number: document.getElementById('profilePhone').value.trim()
                        }
                    });
                    updated(data.user);
                    showModalAlert('Profile details saved successfully!', true);
                } catch (err) {
                    showModalAlert(err.message, false);
                }
            };

            window.handleChangePassword = async function handleChangePassword(event) {
                event.preventDefault();
                const newPassword = document.getElementById('newPassword').value;
                if (newPassword !== document.getElementById('confirmPassword').value) {
                    showModalAlert('New passwords do not match.', false);
                    return;
                }
                try {
                    await Api.request('admin', 'PUT', '/api/profile/password', {
                        json: { current_password: document.getElementById('currentPassword').value, new_password: newPassword }
                    });
                    document.getElementById('changePasswordForm').reset();
                    showModalAlert('Password changed successfully!', true);
                } catch (err) {
                    showModalAlert(err.message, false);
                }
            };

            window.handleLogout = () => Api.logout('admin');

            render(Api.session('admin').user);
            // Refresh the cached account in case it was changed elsewhere.
            Api.get('admin', '/api/auth/me').then((data) => updated(data.user)).catch(() => {});
        }
    };

    window.Api = Api;
})();
