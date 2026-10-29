// Barangay activity charts shared by the resident and admin dashboards.
// Needs Chart.js and api-client.js loaded first. Usage: DashboardCharts.render(element, overview)
// where `overview` is the response of GET /api/stats/overview.
(function () {
    const SERIES = '#1e3a8a';   // the portal's navy: one series, one color
    const OTHER = '#94a3b8';    // the folded "Other" bar stays neutral
    const INK = { primary: '#0f172a', secondary: '#475569', muted: '#94a3b8', grid: '#e9eef5' };
    const MAX_DOCUMENT_BARS = 7; // the rest fold into "Other"

    const charts = [];

    // Writes each bar's value just past its end, in text ink (never the bar color).
    const valueAtTip = {
        id: 'valueAtTip',
        afterDatasetsDraw(chart) {
            const { ctx } = chart;
            const meta = chart.getDatasetMeta(0);
            ctx.save();
            ctx.font = `600 11px ${Chart.defaults.font.family}`;
            ctx.fillStyle = INK.secondary;
            ctx.textBaseline = 'middle';
            meta.data.forEach((bar, i) => {
                ctx.fillText(String(chart.data.datasets[0].data[i]), bar.x + 6, bar.y);
            });
            ctx.restore();
        }
    };

    function plural(n, word) {
        return `${n} ${word}${n === 1 ? '' : 's'}`;
    }

    function tableHtml(headers, rows) {
        return `
            <details class="mt-3 text-xs text-slate-500">
                <summary class="cursor-pointer font-semibold hover:text-slate-700">Show data table</summary>
                <div class="mt-2 max-h-56 overflow-y-auto">
                    <table class="w-full text-left">
                        <thead><tr class="text-slate-400 uppercase text-[10px]">${headers.map(h => `<th class="py-1 pr-3 font-semibold">${h}</th>`).join('')}</tr></thead>
                        <tbody class="divide-y divide-slate-100 text-slate-700" style="font-variant-numeric: tabular-nums">
                            ${rows.map(r => `<tr>${r.map(c => `<td class="py-1 pr-3">${Api.escape(c)}</td>`).join('')}</tr>`).join('')}
                        </tbody>
                    </table>
                </div>
            </details>`;
    }

    function card(title, subtitle, body) {
        return `
            <div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
                <h3 class="text-sm font-bold text-slate-900">${title}</h3>
                <p class="text-[11px] text-slate-400 font-medium mt-0.5">${subtitle}</p>
                ${body}
            </div>`;
    }

    function emptyState(text) {
        return `<div class="h-40 flex items-center justify-center text-xs text-slate-400">${text}</div>`;
    }

    function baseOptions() {
        return {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 300 },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#0f172a',
                    padding: 10,
                    cornerRadius: 8,
                    displayColors: false,
                    titleFont: { weight: '600' }
                }
            }
        };
    }

    function render(container, overview) {
        charts.splice(0).forEach(c => c.destroy());
        Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
        Chart.defaults.font.size = 11;
        Chart.defaults.color = INK.muted;

        const { bookings } = overview;
        const docs = overview.top_documents;
        const shown = docs.slice(0, MAX_DOCUMENT_BARS);
        const rest = docs.slice(MAX_DOCUMENT_BARS).reduce((sum, d) => sum + d.requests, 0);
        const docLabels = shown.map(d => d.document_type).concat(rest ? ['Other'] : []);
        const docValues = shown.map(d => d.requests).concat(rest ? [rest] : []);
        const docHeight = Math.max(160, docLabels.length * 34 + 30);

        container.innerHTML = `
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                ${card(
                    `Bookings in ${Api.escape(overview.month_label)}`,
                    'Appointments scheduled at the barangay hall, excluding cancellations',
                    `<p class="mt-3 text-2xl font-bold text-slate-900">${bookings.total}
                        <span class="text-xs font-semibold text-slate-500">${bookings.total === 1 ? 'booking' : 'bookings'} from ${plural(bookings.residents, 'resident')}</span>
                     </p>
                     ${bookings.total
                        ? `<div class="relative mt-3" style="height:220px"><canvas id="bookingsChart" role="img" aria-label="${plural(bookings.total, 'booking')} in ${Api.escape(overview.month_label)}, by day"></canvas></div>`
                        : emptyState('No bookings yet this month.')}
                     ${tableHtml(['Date', 'Bookings'], bookings.by_day.filter(d => d.bookings).map(d => [Api.formatDate(d.date), d.bookings]))}`
                )}
                ${card(
                    'Most Requested Documents',
                    'All document requests, excluding cancellations',
                    docLabels.length
                        ? `<div class="relative mt-3" style="height:${docHeight}px"><canvas id="documentsChart" role="img" aria-label="Document requests by type, most requested first"></canvas></div>
                           ${tableHtml(['Document', 'Requests'], docs.map(d => [d.document_type, d.requests]))}`
                        : emptyState('No document requests yet.')
                )}
            </div>`;

        if (bookings.total) {
            const days = bookings.by_day;
            const options = baseOptions();
            options.plugins.tooltip.callbacks = {
                title: (items) => Api.formatDate(days[items[0].dataIndex].date),
                label: (item) => plural(item.raw, 'booking')
            };
            options.scales = {
                x: { grid: { display: false }, border: { color: INK.grid }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 16 } },
                y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: INK.grid }, border: { display: false } }
            };
            charts.push(new Chart(document.getElementById('bookingsChart'), {
                type: 'bar',
                data: {
                    labels: days.map(d => d.day),
                    datasets: [{
                        data: days.map(d => d.bookings),
                        backgroundColor: SERIES,
                        hoverBackgroundColor: '#172e6e',
                        borderRadius: { topLeft: 4, topRight: 4 },
                        borderSkipped: 'bottom',
                        maxBarThickness: 24,
                        barPercentage: 0.85,
                        categoryPercentage: 0.9
                    }]
                },
                options
            }));
        }

        if (docLabels.length) {
            const options = baseOptions();
            options.indexAxis = 'y';
            options.layout = { padding: { right: 28 } };
            options.plugins.tooltip.callbacks = { label: (item) => plural(item.raw, 'request') };
            options.scales = {
                x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: INK.grid }, border: { display: false } },
                y: { grid: { display: false }, border: { color: INK.grid }, ticks: { color: INK.primary } }
            };
            charts.push(new Chart(document.getElementById('documentsChart'), {
                type: 'bar',
                data: {
                    labels: docLabels,
                    datasets: [{
                        data: docValues,
                        backgroundColor: docLabels.map(l => (l === 'Other' && rest ? OTHER : SERIES)),
                        borderRadius: { topRight: 4, bottomRight: 4 },
                        borderSkipped: 'left',
                        maxBarThickness: 24,
                        barPercentage: 0.8,
                        categoryPercentage: 0.9
                    }]
                },
                options,
                plugins: [valueAtTip]
            }));
        }
    }

    window.DashboardCharts = { render };
})();
