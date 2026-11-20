lucide.createIcons();

const appointmentPurposeSelect = document.getElementById('visitPurpose');
let appointmentSlots = [];
let currentAvailability = null;

Api.requireSession('resident');
Api.setupResidentNav();

document.addEventListener('DOMContentLoaded', initializeAppointments);

async function initializeAppointments() {
    const dateInput = document.getElementById('appointmentDate');
    const now = new Date();
    dateInput.min = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    await Promise.all([loadAppointmentSettings(), loadWeeklyForecast(), loadMyAppointments(), loadCalendarEvents()]);
}

async function loadAppointmentSettings() {
    try {
        const settings = await Api.get(null, '/api/settings');
        appointmentSlots = settings.appointment_time_slots || [];
        const purposes = settings.appointment_purposes || [];
        if (purposes.length) {
            appointmentPurposeSelect.innerHTML = '<option value="" disabled selected>Select purpose</option>' +
                purposes.map(purpose => `<option value="${Api.escape(purpose)}">${Api.escape(purpose)}</option>`).join('');
        }
        if (!appointmentSlots.length) {
            showAppointmentNotice('Appointment scheduling has not been configured by the barangay office.', true);
        }
    } catch (err) {
        showAppointmentNotice(err.message, true);
    }
}

async function loadWeeklyForecast() {
    const grid = document.getElementById('weeklyForecastGrid');
    try {
        const forecast = await Api.get(null, '/api/appointments/forecast?days=14');
        if (!forecast.configured) {
            grid.innerHTML = '<p class="col-span-full text-xs text-slate-500">The barangay appointment schedule is not available yet.</p>';
            return;
        }
        grid.innerHTML = forecast.days.map(day => {
            const busy = day.utilization >= 75;
            const moderate = day.utilization >= 40;
            const color = busy
                ? { card: 'bg-red-50 border-red-200', pill: 'bg-red-100 text-red-700', text: 'text-red-600' }
                : moderate
                    ? { card: 'bg-amber-50 border-amber-200', pill: 'bg-amber-100 text-amber-800', text: 'text-amber-700' }
                    : { card: 'bg-emerald-50 border-emerald-200', pill: 'bg-emerald-100 text-emerald-700', text: 'text-emerald-600' };
            const label = busy ? 'High Traffic' : moderate ? 'Moderate' : 'Low Traffic';
            return `
                <div class="${color.card} border rounded-xl p-3 text-center transition-all">
                    <p class="text-xs font-bold text-gray-700">${Api.escape(day.day)} ${Api.escape(formatShortDate(day.date))}</p>
                    <span class="inline-block px-2 py-0.5 text-[10px] font-extrabold ${color.pill} rounded-full mt-1.5">${label}</span>
                    <p class="text-[10px] ${color.text} mt-1.5 font-bold">${day.booked} / ${day.capacity} booked</p>
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
            container.innerHTML = '<p class="text-xs text-slate-500">No public barangay calendar events in the next 30 days.</p>';
            return;
        }
        container.innerHTML = data.events.map(event => {
            const link = safeCalendarUrl(event.url);
            return `
                <div class="border-l-2 border-blue-200 pl-3 py-1">
                    <p class="text-sm font-semibold text-slate-800">${Api.escape(event.title)}</p>
                    <p class="text-xs text-slate-500">${Api.escape(formatCalendarDate(event.start))}${event.location ? ` · ${Api.escape(event.location)}` : ''}</p>
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
    const timeSelect = document.getElementById('timeSlot');
    const banner = document.getElementById('dateTrafficBanner');
    const text = document.getElementById('dateTrafficText');
    const badge = document.getElementById('dateTrafficBadge');

    timeSelect.disabled = true;
    currentAvailability = null;
    if (!dateInput.value) {
        banner.classList.add('hidden');
        timeSelect.innerHTML = '<option value="" disabled selected>Select a date first</option>';
        return;
    }

    try {
        const availability = await Api.get(null, `/api/appointments/availability?date=${encodeURIComponent(dateInput.value)}`);
        currentAvailability = availability;
        banner.classList.remove('hidden');
        if (!availability.configured) {
            text.innerText = 'Appointment scheduling is not configured.';
            badge.innerText = 'Unavailable';
            timeSelect.innerHTML = '<option value="" disabled selected>Schedule unavailable</option>';
            return;
        }
        if (!availability.is_open) {
            text.innerText = 'The barangay office is closed on this date.';
            badge.innerText = 'Closed';
            timeSelect.innerHTML = '<option value="" disabled selected>Select an open date</option>';
            return;
        }

        const booked = availability.total_booked;
        text.innerText = `Selected Date: ${booked} resident${booked === 1 ? '' : 's'} booked`;
        badge.innerText = booked >= availability.capacity_per_slot * availability.slots.length ? 'Busy Day' : 'Open';
        badge.className = 'px-2 py-0.5 rounded-full text-[11px] bg-emerald-100 text-emerald-800 font-bold';
        timeSelect.disabled = false;
        timeSelect.innerHTML = '<option value="" disabled selected>Select an available time slot</option>' +
            availability.slots.map(slot => {
                const full = slot.is_full;
                const demand = slot.booked >= Math.ceil(availability.capacity_per_slot / 2) ? ' · Busy' : '';
                return `<option value="${Api.escape(slot.time_slot)}" ${full ? 'disabled' : ''}>${Api.escape(slot.time_slot)} — ${slot.available} available${demand}</option>`;
            }).join('');
    } catch (err) {
        banner.classList.remove('hidden');
        text.innerText = err.message;
        badge.innerText = 'Unavailable';
        timeSelect.innerHTML = '<option value="" disabled selected>Could not load time slots</option>';
    }
}

async function handleAppointmentSubmit(event) {
    event.preventDefault();
    const purpose = appointmentPurposeSelect.value;
    const date = document.getElementById('appointmentDate').value;
    const timeSlot = document.getElementById('timeSlot').value;
    if (!purpose || !date || !timeSlot || !currentAvailability || !currentAvailability.is_open) {
        showAppointmentNotice('Choose a purpose, open date, and available time slot.', true);
        return;
    }

    const submit = event.submitter || document.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
        const data = await Api.request('resident', 'POST', '/api/appointments', {
            json: { purpose, date, time_slot: timeSlot }
        });
        showAppointmentNotice(`${data.message} Reference: ${data.appointment.reference_no}`, false);
        document.querySelector('form[onsubmit="handleAppointmentSubmit(event)"]').reset();
        await Promise.all([loadMyAppointments(), loadWeeklyForecast()]);
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
                            <span><i class="fa-regular fa-clock text-blue-900 mr-1"></i> ${Api.escape(appointment.time_slot)}</span>
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
        await Promise.all([loadMyAppointments(), loadWeeklyForecast()]);
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
    document.getElementById('timeSlot').disabled = true;
    document.getElementById('dateTrafficBanner').classList.add('hidden');
    currentAvailability = null;
};
