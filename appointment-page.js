lucide.createIcons();

const appointmentPurposeSelect = document.getElementById('visitPurpose');
let currentAvailability = null;

Api.requireSession('resident');
Api.setupResidentNav();

document.addEventListener('DOMContentLoaded', initializeAppointments);

async function initializeAppointments() {
    const dateInput = document.getElementById('appointmentDate');
    const now = new Date();
    dateInput.min = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    await Promise.all([loadAppointmentSettings(), loadDailyBookingCounts(), loadMyAppointments(), loadCalendarEvents()]);
}

async function loadAppointmentSettings() {
    try {
        const settings = await Api.get(null, '/api/appointments/schedule');
        const purposes = settings.purposes || [];
        if (purposes.length) {
            appointmentPurposeSelect.innerHTML = '<option value="" disabled selected>Select purpose</option>' +
                purposes.map(purpose => `<option value="${Api.escape(purpose)}">${Api.escape(purpose)}</option>`).join('');
        }
        if (!settings.configured) {
            showAppointmentNotice('Appointment scheduling has not been configured by the barangay office.', true);
        }
    } catch (err) {
        showAppointmentNotice(err.message, true);
    }
}

async function loadDailyBookingCounts() {
    const grid = document.getElementById('dailyBookingGrid');
    try {
        const forecast = await Api.get(null, '/api/appointments/forecast?days=14');
        if (!forecast.configured) {
            grid.innerHTML = '<p class="col-span-full text-xs text-slate-500">The barangay appointment schedule is not available yet.</p>';
            return;
        }
        grid.innerHTML = forecast.days.map(day => {
            return `
                <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center transition-all">
                    <p class="text-xs font-bold text-gray-700">${Api.escape(day.day)} ${Api.escape(formatShortDate(day.date))}</p>
                    <span class="inline-block px-2 py-0.5 text-[10px] font-extrabold bg-emerald-100 text-emerald-700 rounded-full mt-1.5">Open</span>
                    <p class="text-[10px] text-emerald-700 mt-1.5 font-bold">${day.booked} resident${day.booked === 1 ? '' : 's'} booked</p>
                </div>
            `;
        }).join('');
    } catch (err) {
        grid.innerHTML = `<p class="col-span-full text-xs text-rose-700">${Api.escape(err.message)}</p>`;
    }
}

async function loadCalendarEvents() {
    const container = document.getElementById('calendarEvents');
    try {
        const data = await Api.get(null, '/api/appointments/calendar');
        if (!data.events.length) {
            container.innerHTML = data.source === 'appointments'
                ? '<p class="text-xs text-slate-500">No upcoming confirmed barangay appointments in the next 30 days.</p>'
                : '<p class="text-xs text-slate-500">No public barangay calendar events in the next 30 days.</p>';
            return;
        }
        const fallbackNotice = data.source === 'appointments'
            ? '<p class="text-xs text-slate-500">Showing confirmed appointments from this system.</p>'
            : '';
        container.innerHTML = fallbackNotice + data.events.map(event => {
            const link = safeCalendarUrl(event.url);
            return `
                <div class="border-l-2 border-blue-200 pl-3 py-1">
                    <p class="text-sm font-semibold text-slate-800">${Api.escape(event.title)}</p>
                    <p class="text-xs text-slate-500">${Api.escape(formatCalendarDate(event.start))}${event.time_slot ? ` · ${Api.escape(event.time_slot)}` : event.location ? ` · ${Api.escape(event.location)}` : ''}</p>
                    ${link ? `<a class="text-xs font-semibold text-blue-800 hover:underline" href="${link}" target="_blank" rel="noopener noreferrer">View event</a>` : ''}
                </div>
            `;
        }).join('');
    } catch (err) {
        container.innerHTML = `<p class="text-xs text-slate-500">${Api.escape(err.message)}</p>`;
    }
}

async function handleDateChange() {
    const dateInput = document.getElementById('appointmentDate');
    const banner = document.getElementById('dateTrafficBanner');
    const text = document.getElementById('dateTrafficText');
    const badge = document.getElementById('dateTrafficBadge');

    currentAvailability = null;
    if (!dateInput.value) {
        banner.classList.add('hidden');
        return;
    }

    try {
        const availability = await Api.get(null, `/api/appointments/availability?date=${encodeURIComponent(dateInput.value)}`);
        currentAvailability = availability;
        banner.classList.remove('hidden');
        if (!availability.configured) {
            text.innerText = 'Appointment scheduling is not configured.';
            badge.innerText = 'Unavailable';
            return;
        }
        if (!availability.is_open) {
            text.innerText = 'The barangay office is closed on this date.';
            badge.innerText = 'Closed';
            return;
        }

        const booked = availability.total_booked;
        text.innerText = `Selected Date: ${booked} resident${booked === 1 ? '' : 's'} booked`;
        badge.innerText = 'Open';
        badge.className = 'px-2 py-0.5 rounded-full text-[11px] bg-emerald-100 text-emerald-800 font-bold';
    } catch (err) {
        banner.classList.remove('hidden');
        text.innerText = err.message;
        badge.innerText = 'Unavailable';
    }
}

async function handleAppointmentSubmit(event) {
    event.preventDefault();
    const purpose = appointmentPurposeSelect.value;
    const date = document.getElementById('appointmentDate').value;
    if (!purpose || !date || !currentAvailability || !currentAvailability.is_open) {
        showAppointmentNotice('Choose a purpose and an open date.', true);
        return;
    }

    const submit = event.submitter || document.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
        const data = await Api.request('resident', 'POST', '/api/appointments', {
            json: { purpose, date }
        });
        showAppointmentNotice(`${data.message} Reference: ${data.appointment.reference_no}`, false);
        document.querySelector('form[onsubmit="handleAppointmentSubmit(event)"]').reset();
        await Promise.all([loadMyAppointments(), loadDailyBookingCounts()]);
        await handleDateChange();
    } catch (err) {
        showAppointmentNotice(err.message, true);
    } finally {
        submit.disabled = false;
    }
}

async function loadMyAppointments() {
    const container = document.getElementById('appointmentsList');
    const badgeCount = document.getElementById('appointmentBadgeCount');
    try {
        const appointments = await Api.get('resident', '/api/appointments/mine');
        badgeCount.innerText = `${appointments.length} Request${appointments.length === 1 ? '' : 's'}`;
        if (!appointments.length) {
            container.innerHTML = `
                <div class="text-center py-8 text-gray-400">
                    <i class="fa-regular fa-calendar-xmark text-4xl mb-2 block"></i>
                    <p class="text-sm">No appointments yet.</p>
                </div>
            `;
            return;
        }
        container.innerHTML = appointments.map(appointment => {
            const canCancel = ['Pending', 'Confirmed'].includes(appointment.status);
            const statusColor = appointment.status === 'Confirmed' ? 'bg-emerald-100 text-emerald-700'
                : appointment.status === 'Rejected' ? 'bg-rose-100 text-rose-700'
                    : appointment.status === 'Pending' ? 'bg-amber-100 text-amber-800'
                        : 'bg-slate-100 text-slate-700';
            return `
                <div class="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div class="space-y-1 min-w-0">
                        <div class="flex items-center flex-wrap gap-2">
                            <span class="text-xs font-bold bg-[#1e3a8a] text-white px-2 py-0.5 rounded">${Api.escape(appointment.reference_no)}</span>
                            <span class="text-xs font-semibold px-2 py-0.5 rounded-full ${statusColor}">${Api.escape(appointment.status)}</span>
                        </div>
                        <h3 class="font-bold text-gray-900 text-sm mt-1">${Api.escape(appointment.purpose)}</h3>
                        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600 font-medium pt-1">
                            <span><i class="fa-regular fa-calendar text-blue-900 mr-1"></i> ${Api.escape(formatShortDate(appointment.date))}</span>
                        </div>
                        ${appointment.rejection_reason ? `<p class="text-xs text-rose-700 pt-1"><strong>Reason:</strong> ${Api.escape(appointment.rejection_reason)}</p>` : ''}
                    </div>
                    ${canCancel ? `<button onclick="cancelAppointment(${appointment.appointment_id})" class="self-end md:self-center px-3 py-1.5 text-xs font-semibold text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition border border-red-200 flex items-center space-x-1 cursor-pointer"><i class="fa-regular fa-trash-can"></i><span>Cancel</span></button>` : ''}
                </div>
            `;
        }).join('');
    } catch (err) {
        container.innerHTML = `<p class="text-sm text-rose-700">${Api.escape(err.message)}</p>`;
    }
}

async function cancelAppointment(appointmentId) {
    if (!confirm('Are you sure you want to cancel this appointment?')) return;
    try {
        await Api.request('resident', 'PATCH', `/api/appointments/${appointmentId}/cancel`);
        await Promise.all([loadMyAppointments(), loadDailyBookingCounts()]);
        if (document.getElementById('appointmentDate').value) await handleDateChange();
    } catch (err) {
        showAppointmentNotice(err.message, true);
    }
}

function showAppointmentNotice(message, isError) {
    let notice = document.getElementById('appointmentNotice');
    if (!notice) {
        notice = document.createElement('div');
        notice.id = 'appointmentNotice';
        notice.className = 'text-sm rounded-xl px-4 py-3';
        document.querySelector('main').insertBefore(notice, document.querySelector('main').children[1]);
    }
    notice.className = `text-sm rounded-xl px-4 py-3 ${isError ? 'bg-rose-50 text-rose-700 border border-rose-100' : 'bg-emerald-50 text-emerald-800 border border-emerald-100'}`;
    notice.innerText = message;
}

function formatShortDate(value) {
    if (!value) return '';
    const date = new Date(`${value.slice(0, 10)}T00:00:00`);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatCalendarDate(value) {
    if (!value) return '';
    const date = value.length === 10 ? new Date(`${value}T00:00:00`) : new Date(value);
    return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: value.length === 10 ? undefined : 'numeric', minute: value.length === 10 ? undefined : '2-digit' });
}

function safeCalendarUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' ? Api.escape(url.href) : '';
    } catch {
        return '';
    }
}

window.handleAppointmentSubmit = handleAppointmentSubmit;
window.handleDateChange = handleDateChange;
window.cancelAppointment = cancelAppointment;
window.resetForm = function resetForm() {
    document.querySelector('form[onsubmit="handleAppointmentSubmit(event)"]').reset();
    document.getElementById('dateTrafficBanner').classList.add('hidden');
    currentAvailability = null;
};
