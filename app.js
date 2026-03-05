/**
 * Kozhikode District Climate Dashboard (v2)
 * 70 Grama Panchayats — Area-Weighted CORDEX Interpolation
 */

// ── State ─────────────────────────────────────────────────────────
let climateData = null;
let geojsonData = null;
let currentPanchayat = null;   // set after data loads
let currentScenario = 'rcp26';
let currentYear = 2025;
let choroplethVar = 'rainfall';  // 'rainfall' | 'temperature'
let harvestCalculated = false;

// Chart instances
let rainfallTrendChart = null;
let monthlyRainfallChart = null;
let tempTrendChart = null;
let dtrTrendChart = null;
let comfortChart = null;

// Map
let map = null;
let geojsonLayer = null;
let municipalityLayer = null;

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ROOF_MATERIAL_RUNOFF = {
    concrete: 0.85,
    gi_fibre: 0.8,
    tile: 0.75,
    asbestos: 0.7,
    organic: 0.6,
};
const TREND_YEAR_MIN = 2000;
const TREND_YEAR_MAX = 2099;

// ── Chart.js defaults ─────────────────────────────────────────────
Chart.defaults.color = '#475569';
Chart.defaults.borderColor = 'rgba(0,0,0,0.05)';
Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.font.size = 11;
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.plugins.legend.labels.pointStyleWidth = 8;
Chart.defaults.plugins.legend.labels.padding = 16;
Chart.defaults.elements.point.radius = 0;
Chart.defaults.elements.point.hoverRadius = 5;
Chart.defaults.elements.line.tension = 0.3;
const xScrubTooltip = {
    id: 'xScrubTooltip',
    afterEvent(chart, args, pluginOptions) {
        if (!pluginOptions?.enabled) return;
        if (!chart.chartArea) return;

        const event = args.event;
        if (!event) return;

        const state = chart.$xScrubTooltipState || (chart.$xScrubTooltipState = { index: null, activeKey: '' });
        const clearActiveElements = () => {
            if (state.index === null && state.activeKey === '') return;
            chart.setActiveElements([]);
            chart.tooltip?.setActiveElements([], { x: 0, y: 0 });
            state.index = null;
            state.activeKey = '';
            args.changed = true;
        };

        if (event.type === 'mouseout' || event.type === 'mouseleave') {
            clearActiveElements();
            return;
        }
        if (event.type !== 'mousemove' && event.type !== 'touchmove') return;

        const { left, right, top, bottom } = chart.chartArea;
        const { x, y } = event;
        if (!Number.isFinite(x) || !Number.isFinite(y) || x < left || x > right || y < top || y > bottom) {
            clearActiveElements();
            return;
        }

        const labels = chart.data?.labels || [];
        if (!labels.length) {
            clearActiveElements();
            return;
        }

        const width = right - left;
        const rawIndex = labels.length === 1 || width <= 0
            ? 0
            : Math.round(((x - left) / width) * (labels.length - 1));
        const index = Math.max(0, Math.min(labels.length - 1, rawIndex));

        const activeElements = [];
        chart.data.datasets.forEach((dataset, datasetIndex) => {
            if (!chart.isDatasetVisible(datasetIndex)) return;
            if (index >= dataset.data.length) return;
            if (dataset.data[index] == null) return;
            activeElements.push({ datasetIndex, index });
        });

        if (!activeElements.length) {
            clearActiveElements();
            return;
        }

        const activeKey = activeElements.map(el => `${el.datasetIndex}:${el.index}`).join('|');
        if (state.index === index && state.activeKey === activeKey) return;

        const element = chart.getDatasetMeta(activeElements[0].datasetIndex)?.data?.[index];
        const tooltipPosition = element ? { x: element.x, y: element.y } : { x, y };

        chart.setActiveElements(activeElements);
        chart.tooltip?.setActiveElements(activeElements, tooltipPosition);
        state.index = index;
        state.activeKey = activeKey;
        args.changed = true;
    },
    beforeDestroy(chart) {
        delete chart.$xScrubTooltipState;
    },
};

Chart.register(xScrubTooltip);

// ── Data Loading ──────────────────────────────────────────────────
async function loadData() {
    try {
        const [climateResp, geojsonResp] = await Promise.all([
            fetch('kozhikode_climate_data.json?v=2'),
            fetch('kozhikode_panchayats.geojson'),
        ]);
        climateData = await climateResp.json();
        geojsonData = await geojsonResp.json();

        document.getElementById('loading-overlay').classList.add('hidden');
        initDashboard();
    } catch (e) {
        document.querySelector('.loading-spinner p').textContent =
            'Error loading data. Run preprocess_kozhikode_v2.py first.';
        console.error('Failed to load data:', e);
    }
}

// ── Init ──────────────────────────────────────────────────────────
function initDashboard() {
    // Default panchayat: first in the list
    currentPanchayat = climateData.panchayats[0] || 'Balussery';

    // Collect urban units from climate data (now have real preprocessed data)
    const urbanUnits = (climateData.urban_units || []).map(name => {
        const coordInfo = climateData.panchayat_coords?.[name] || {};
        return { name, type: coordInfo.type || 'municipality' };
    }).sort((a, b) => a.name.localeCompare(b.name));

    // Populate dropdown with optgroups
    const sel = document.getElementById('panchayat-select');
    sel.innerHTML = '';

    // Urban group
    if (urbanUnits.length) {
        const grpUrban = document.createElement('optgroup');
        grpUrban.label = '🏙️ Municipality / Corporation';
        urbanUnits.forEach(({ name, type }) => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = type === 'municipal_corporation' ? `${name} (Corporation)` : name;
            if (name === currentPanchayat) opt.selected = true;
            grpUrban.appendChild(opt);
        });
        sel.appendChild(grpUrban);
    }

    // Grama Panchayat group
    const grpGrama = document.createElement('optgroup');
    grpGrama.label = '🌿 Grama Panchayats';
    climateData.panchayats.slice().sort().forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        if (name === currentPanchayat) opt.selected = true;
        grpGrama.appendChild(opt);
    });
    sel.appendChild(grpGrama);

    // Events
    sel.addEventListener('change', e => {
        currentPanchayat = e.target.value;
        updateAll();
    });

    document.querySelectorAll('.scenario-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.scenario-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentScenario = btn.dataset.scenario;
            updateAll();
        });
    });

    const slider = document.getElementById('year-slider');
    slider.addEventListener('input', e => {
        currentYear = parseInt(e.target.value);
        document.getElementById('year-display').textContent = currentYear;
        updateSummaryCards();
        updateMonthlyRainfall();
        refreshHarvesting();
        refreshChoropleth();
    });

    document.getElementById('calc-harvest-btn').addEventListener('click', () => {
        harvestCalculated = true;
        updateHarvesting();
    });
    document.getElementById('roof-material').addEventListener('change', () => {
        syncRunoffFromMaterial();
        harvestCalculated = false;
        clearHarvestingResults();
    });
    document.getElementById('roof-area').addEventListener('input', () => {
        harvestCalculated = false;
        clearHarvestingResults();
    });
    syncRunoffFromMaterial();

    initMap();
    updateAll();
}

// ── Current panchayat data ────────────────────────────────────────
function getPanchayatData(name) {
    name = name || currentPanchayat;
    if (!climateData) return null;
    return climateData.scenarios[currentScenario]?.[name];
}

function getTrendYears(seriesByYear) {
    return Object.keys(seriesByYear || {})
        .map(Number)
        .filter(y => y >= TREND_YEAR_MIN && y <= TREND_YEAR_MAX)
        .sort((a, b) => a - b);
}

// ── Update Everything ─────────────────────────────────────────────
function updateAll() {
    updateSummaryCards();
    updateRainfallTrend();
    updateMonthlyRainfall();
    updateTempTrend();
    updateDTRTrend();
    updateComfortTrend();
    refreshHarvesting();
    refreshChoropleth();
}

// ── Summary Cards ─────────────────────────────────────────────────
function updateSummaryCards() {
    const d = getPanchayatData();
    if (!d) return;
    const yrStr = String(currentYear);

    // Rainfall
    const annualPr = d.annual_pr[yrStr];
    const elRain = document.getElementById('card-rainfall');
    const elRainCh = document.getElementById('card-rainfall-change');
    if (annualPr != null) {
        elRain.textContent = Math.round(annualPr).toLocaleString();
        const pct = ((annualPr - d.baseline_pr) / d.baseline_pr * 100);
        elRainCh.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% from baseline`;
        elRainCh.className = 'card-change ' + (pct >= 0 ? 'positive' : 'negative');
    } else {
        elRain.textContent = '--'; elRainCh.textContent = 'No data';
        elRainCh.className = 'card-change neutral';
    }

    // Temperature
    const annualTas = d.annual_tas[yrStr];
    const elTemp = document.getElementById('card-temp');
    const elTempCh = document.getElementById('card-temp-change');
    if (annualTas != null) {
        elTemp.textContent = annualTas.toFixed(1);
        const dT = annualTas - d.baseline_tas;
        elTempCh.textContent = `ΔT = ${dT >= 0 ? '+' : ''}${dT.toFixed(2)}°C`;
        elTempCh.className = 'card-change ' + (dT >= 0.5 ? 'negative' : dT >= 0 ? 'neutral' : 'positive');
    } else {
        elTemp.textContent = '--'; elTempCh.textContent = 'No data';
        elTempCh.className = 'card-change neutral';
    }

    // DTR
    const annualDTR = d.annual_dtr[yrStr];
    const elDTR = document.getElementById('card-dtr');
    const elDTRCh = document.getElementById('card-dtr-change');
    if (annualDTR != null) {
        elDTR.textContent = annualDTR.toFixed(1);
        elDTRCh.textContent = '°C daily range'; elDTRCh.className = 'card-change neutral';
    } else {
        elDTR.textContent = '--'; elDTRCh.textContent = 'No data';
        elDTRCh.className = 'card-change neutral';
    }

    // Comfort
    const comfortDI = d.annual_comfort[yrStr];
    const elCmf = document.getElementById('card-comfort');
    const elCmfSt = document.getElementById('card-comfort-status');
    if (comfortDI != null) {
        elCmf.textContent = comfortDI.toFixed(1);
        let status, cls;
        if (comfortDI < 21) { status = 'Comfortable'; cls = 'comfortable'; }
        else if (comfortDI < 24) { status = 'Mild Discomfort'; cls = 'mild-discomfort'; }
        else if (comfortDI < 27) { status = 'Discomfort'; cls = 'discomfort'; }
        else { status = 'Severe Discomfort'; cls = 'severe'; }
        elCmfSt.textContent = status; elCmfSt.className = 'card-status ' + cls;
    } else {
        elCmf.textContent = '--'; elCmfSt.textContent = 'No data';
        elCmfSt.className = 'card-status';
    }
}

// ── Rainfall Trend Chart ──────────────────────────────────────────
function updateRainfallTrend() {
    const d = getPanchayatData();
    if (!d) return;
    const years = Object.keys(d.annual_pr).map(Number).sort((a, b) => a - b);
    const values = years.map(y => d.annual_pr[String(y)]);
    const baseline = d.baseline_pr;

    const ctx = document.getElementById('rainfall-trend-chart');
    if (rainfallTrendChart) rainfallTrendChart.destroy();

    rainfallTrendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: years,
            datasets: [
                {
                    label: `Annual Rainfall (${currentScenario.toUpperCase()})`,
                    data: values,
                    borderColor: '#06b6d4',
                    backgroundColor: 'rgba(6,182,212,0.08)',
                    fill: true, borderWidth: 2,
                    pointHoverRadius: 4, pointHitRadius: 20,
                },
                {
                    label: 'Baseline (1981–2005)',
                    data: years.map(() => baseline),
                    borderColor: 'rgba(245,158,11,0.6)',
                    borderDash: [8, 4], borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 0,
                }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            animation: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top' },
                tooltip: { callbacks: { label: c => `${c.dataset.label}: ${Math.round(c.parsed.y)} mm` } }
            },
            scales: {
                x: { title: { display: true, text: 'Year', color: '#64748b' }, ticks: { maxTicksLimit: 12 } },
                y: { title: { display: true, text: 'Rainfall (mm/year)', color: '#64748b' } }
            }
        }
    });
}

// ── Monthly Rainfall Chart ────────────────────────────────────────
function updateMonthlyRainfall() {
    const d = getPanchayatData();
    if (!d) return;
    document.getElementById('monthly-rain-year').textContent = `Year ${currentYear}`;
    const yrStr = String(currentYear);
    const monthData = d.monthly_pr[yrStr] || {};
    const values = [];
    for (let m = 1; m <= 12; m++) values.push(monthData[String(m)] || 0);
    const colors = values.map(v => v > 500 ? '#0891b2' : v > 300 ? '#06b6d4' : v > 100 ? '#22d3ee' : v > 50 ? '#67e8f9' : '#a5f3fc');

    const ctx = document.getElementById('monthly-rainfall-chart');
    if (monthlyRainfallChart) monthlyRainfallChart.destroy();

    monthlyRainfallChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: MONTH_NAMES,
            datasets: [{ label: 'Monthly Rainfall (mm)', data: values, backgroundColor: colors, borderRadius: 6, borderSkipped: false }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: c => `${Math.round(c.parsed.y)} mm` } }
            },
            scales: {
                x: { grid: { display: false } },
                y: { title: { display: true, text: 'mm/month', color: '#64748b' }, beginAtZero: true }
            }
        }
    });
}

// ── Temperature Trend Chart ───────────────────────────────────────
function updateTempTrend() {
    const d = getPanchayatData();
    if (!d) return;
    const years = Object.keys(d.annual_tas).map(Number).sort((a, b) => a - b);
    const tasValues = years.map(y => d.annual_tas[String(y)]);
    const deltaT = years.map(y => d.annual_tas[String(y)] - d.baseline_tas);
    const baseline = d.baseline_tas;

    const ctx = document.getElementById('temp-trend-chart');
    if (tempTrendChart) tempTrendChart.destroy();

    tempTrendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: years,
            datasets: [
                { label: 'Mean Temperature (°C)', data: tasValues, borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.08)', fill: true, borderWidth: 2, yAxisID: 'y' },
                { label: 'ΔT from Baseline', data: deltaT, borderColor: '#ef4444', borderWidth: 1.5, borderDash: [4, 2], yAxisID: 'y1' },
                { label: 'Baseline Temp', data: years.map(() => baseline), borderColor: 'rgba(148,163,184,0.5)', borderDash: [8, 4], borderWidth: 1, pointRadius: 0, yAxisID: 'y' }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            animation: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top' },
                tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y.toFixed(2)}°C` } }
            },
            scales: {
                x: { title: { display: true, text: 'Year', color: '#64748b' }, ticks: { maxTicksLimit: 12 } },
                y: { position: 'left', title: { display: true, text: 'Temperature (°C)', color: '#64748b' } },
                y1: { position: 'right', title: { display: true, text: 'ΔT (°C)', color: '#ef4444' }, grid: { drawOnChartArea: false } }
            }
        }
    });
}

// ── DTR Trend Chart ───────────────────────────────────────────────
function updateDTRTrend() {
    const d = getPanchayatData();
    if (!d) return;
    const years = Object.keys(d.annual_dtr).map(Number).sort((a, b) => a - b);
    const values = years.map(y => d.annual_dtr[String(y)]);

    const ctx = document.getElementById('dtr-trend-chart');
    if (dtrTrendChart) dtrTrendChart.destroy();

    dtrTrendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: years,
            datasets: [{ label: 'Diurnal Temperature Range (°C)', data: values, borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.08)', fill: true, borderWidth: 2, pointHoverRadius: 4, pointHitRadius: 20 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            animation: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top' },
                tooltip: { callbacks: { label: c => `DTR: ${c.parsed.y.toFixed(2)}°C` } }
            },
            scales: {
                x: { title: { display: true, text: 'Year', color: '#64748b' }, ticks: { maxTicksLimit: 12 } },
                y: { title: { display: true, text: 'DTR (°C)', color: '#64748b' } }
            }
        }
    });
}

// ── Comfort Index Chart ───────────────────────────────────────────
function updateComfortTrend() {
    const d = getPanchayatData();
    if (!d) return;
    const years = Object.keys(d.annual_comfort).map(Number).sort((a, b) => a - b);
    const values = years.map(y => d.annual_comfort[String(y)]);

    const ctx = document.getElementById('comfort-chart');
    if (comfortChart) comfortChart.destroy();

    comfortChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: years,
            datasets: [{
                label: 'Discomfort Index (DI)',
                data: values,
                borderColor: '#ef4444',
                backgroundColor: 'rgba(239,68,68,0.08)',
                fill: true, borderWidth: 2,
                pointHoverRadius: 4, pointHitRadius: 20
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            animation: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top' },
                tooltip: {
                    callbacks: {
                        label: c => {
                            const v = c.parsed.y;
                            let lbl = `DI: ${v.toFixed(1)}`;
                            if (v < 21) lbl += ' (Comfortable)';
                            else if (v < 24) lbl += ' (Mild Discomfort)';
                            else if (v < 27) lbl += ' (Discomfort)';
                            else lbl += ' (Severe Discomfort)';
                            return lbl;
                        }
                    }
                },
                annotation: {
                    events: [],
                    annotations: {
                        line21: { type: 'line', yMin: 21, yMax: 21, borderColor: 'rgba(16,185,129,0.4)', borderDash: [6, 3], borderWidth: 1, label: { display: true, content: 'Comfortable', position: 'start', font: { size: 9 }, color: '#10b981', backgroundColor: 'transparent' } },
                        line24: { type: 'line', yMin: 24, yMax: 24, borderColor: 'rgba(245,158,11,0.4)', borderDash: [6, 3], borderWidth: 1, label: { display: true, content: 'Mild', position: 'start', font: { size: 9 }, color: '#f59e0b', backgroundColor: 'transparent' } },
                        line27: { type: 'line', yMin: 27, yMax: 27, borderColor: 'rgba(239,68,68,0.4)', borderDash: [6, 3], borderWidth: 1, label: { display: true, content: 'Discomfort', position: 'start', font: { size: 9 }, color: '#ef4444', backgroundColor: 'transparent' } }
                    }
                }
            },
            scales: {
                x: { title: { display: true, text: 'Year', color: '#64748b' }, ticks: { maxTicksLimit: 12 } },
                y: { title: { display: true, text: 'Discomfort Index', color: '#64748b' } }
            }
        }
    });
}

// ── Rainwater Harvesting ──────────────────────────────────────────
function syncRunoffFromMaterial() {
    const materialEl = document.getElementById('roof-material');
    const runoffEl = document.getElementById('runoff-coeff');
    const runoffValue = ROOF_MATERIAL_RUNOFF[materialEl?.value];

    if (runoffValue == null || !runoffEl) return;
    runoffEl.value = Number(runoffValue.toFixed(2)).toString();
}

function clearHarvestingResults() {
    document.getElementById('harvest-annual').textContent = '--';
    document.getElementById('harvest-daily').textContent = '--';
    const chEl = document.getElementById('harvest-change');
    chEl.textContent = '--';
    chEl.style.color = '';
}

function refreshHarvesting() {
    if (!harvestCalculated) {
        clearHarvestingResults();
        return;
    }
    updateHarvesting();
}

function updateHarvesting() {
    const d = getPanchayatData();
    if (!d) {
        clearHarvestingResults();
        return;
    }

    const roofArea = parseFloat(document.getElementById('roof-area').value);
    const runoff = parseFloat(document.getElementById('runoff-coeff').value);
    const hasValidRoof = Number.isFinite(roofArea) && roofArea > 0;
    const hasValidRunoff = Number.isFinite(runoff) && runoff > 0 && runoff <= 1;

    const yrStr = String(currentYear);
    const annualPr = d.annual_pr[yrStr];
    const baselinePr = d.baseline_pr;

    if (annualPr != null && baselinePr != null && hasValidRoof && hasValidRunoff) {
        const harvestLitres = annualPr * roofArea * runoff;
        const baselineHarvest = baselinePr * roofArea * runoff;
        const dailyAvg = harvestLitres / 365;

        document.getElementById('harvest-annual').textContent = Math.round(harvestLitres).toLocaleString();
        document.getElementById('harvest-daily').textContent = dailyAvg.toFixed(1);

        const chEl = document.getElementById('harvest-change');
        if (baselineHarvest > 0) {
            const pctChange = ((harvestLitres - baselineHarvest) / baselineHarvest * 100);
            chEl.textContent = `${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(1)}%`;
            chEl.style.color = pctChange >= 0 ? '#10b981' : '#ef4444';
        } else {
            chEl.textContent = '--';
            chEl.style.color = '';
        }
    } else {
        clearHarvestingResults();
    }
}

// ── Choropleth Colour Helpers ─────────────────────────────────────
function getRainfallColor(mm) {
    if (mm == null) return '#334155';
    if (mm > 3500) return '#0369a1';
    if (mm > 3000) return '#0891b2';
    if (mm > 2500) return '#06b6d4';
    if (mm > 2000) return '#22d3ee';
    if (mm > 1500) return '#67e8f9';
    return '#a5f3fc';
}

function getTempColor(tc) {
    if (tc == null) return '#334155';
    if (tc > 29) return '#dc2626';
    if (tc > 28) return '#ef4444';
    if (tc > 27) return '#f59e0b';
    if (tc > 26) return '#facc15';
    if (tc > 25) return '#4ade80';
    return '#86efac';
}

function panchayatColor(name) {
    const d = getPanchayatData(name);
    if (!d) return '#334155';
    const yrStr = String(currentYear);
    if (choroplethVar === 'temperature') {
        return getTempColor(d.annual_tas[yrStr]);
    }
    return getRainfallColor(d.annual_pr[yrStr]);
}

// ── Map ───────────────────────────────────────────────────────────
function makeMuniTooltip(name, type) {
    const d = getPanchayatData(name);
    const typeLabel = type === 'municipal_corporation' ? 'Corporation' : 'Municipality';
    if (!d) return `<strong>${name}</strong><br><em>${typeLabel}</em>`;
    const yrStr = String(currentYear);
    const pr = d.annual_pr[yrStr];
    const tas = d.annual_tas[yrStr];
    return `<strong>${name}</strong> <span style="font-size:10px;color:#94a3b8">(${typeLabel})</span><br>` +
        `Rainfall: ${pr != null ? Math.round(pr) + ' mm' : 'N/A'}<br>` +
        `Temp: ${tas != null ? tas.toFixed(1) + ' °C' : 'N/A'}`;
}

function initMap() {
    map = L.map('map', { center: [11.42, 75.78], zoom: 10 });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 16,
    }).addTo(map);

    // ── Gram Panchayat layer ────────────────────────────────────────
    const gramFeatures = geojsonData.features.filter(
        f => f.properties['local_authority:IN'] === 'gram_panchayat' &&
            f.properties['admin_level'] === '8'
    );
    geojsonLayer = L.geoJSON({ type: 'FeatureCollection', features: gramFeatures }, {
        style: feature => styleFeature(feature.properties.name),
        onEachFeature: (feature, layer) => {
            const name = feature.properties.name;
            layer.on({
                mouseover: e => {
                    const l = e.target;
                    l.setStyle({ weight: 2.5, color: '#ffffff', fillOpacity: 0.95 });
                    const d = getPanchayatData(name);
                    if (d) {
                        const yrStr = String(currentYear);
                        const pr = d.annual_pr[yrStr];
                        const tas = d.annual_tas[yrStr];
                        l.bindTooltip(
                            `<strong>${name}</strong><br>` +
                            `Rainfall: ${pr != null ? Math.round(pr) + ' mm' : 'N/A'}<br>` +
                            `Temp: ${tas != null ? tas.toFixed(1) + ' °C' : 'N/A'}`,
                            { sticky: true, opacity: 0.9 }
                        ).openTooltip();
                    }
                },
                mouseout: e => {
                    geojsonLayer.resetStyle(e.target);
                    e.target.closeTooltip();
                    highlightSelected();
                },
                click: () => {
                    currentPanchayat = name;
                    document.getElementById('panchayat-select').value = name;
                    updateAll();
                }
            });
        }
    }).addTo(map);

    // ── Municipality / Corporation layer ────────────────────────────
    const urbanTypes = ['municipality', 'municipal_corporation'];
    const urbanFeatures = geojsonData.features.filter(
        f => urbanTypes.includes(f.properties['local_authority:IN']) &&
            f.properties['admin_level'] === '8'
    );
    municipalityLayer = L.geoJSON({ type: 'FeatureCollection', features: urbanFeatures }, {
        style: feature => styleMuniFeature(feature.properties.name, feature.properties['local_authority:IN']),
        onEachFeature: (feature, layer) => {
            const name = feature.properties.name;
            const type = feature.properties['local_authority:IN'];
            layer.on({
                mouseover: e => {
                    const l = e.target;
                    l.setStyle({ weight: 3, color: '#ffffff', fillOpacity: 0.92 });
                    l.bindTooltip(makeMuniTooltip(name, type), { sticky: true, opacity: 0.95 }).openTooltip();
                },
                mouseout: e => {
                    municipalityLayer.resetStyle(e.target);
                    e.target.closeTooltip();
                    highlightSelected();
                },
                click: () => {
                    currentPanchayat = name;
                    document.getElementById('panchayat-select').value = name;
                    updateAll();
                }
            });
        }
    }).addTo(map);

    // Fit map to district bounds using gram layer
    try { map.fitBounds(geojsonLayer.getBounds(), { padding: [10, 10] }); } catch (e) { }

    // Add choropleth toggle buttons
    addMapLegend();
}

function styleFeature(name) {
    const isSelected = name === currentPanchayat;
    return {
        fillColor: panchayatColor(name),
        weight: isSelected ? 2.5 : 1,
        color: isSelected ? '#ffffff' : 'rgba(0,0,0,0.8)',
        fillOpacity: isSelected ? 0.95 : 0.72,
    };
}

function styleMuniFeature(name, type) {
    const isSelected = name === currentPanchayat;
    const isCorp = type === 'municipal_corporation';
    // Use same choropleth fill as gram panchayats (proxied), but distinct borders
    return {
        fillColor: panchayatColor(name),
        weight: isSelected ? 3 : isCorp ? 2.5 : 2,
        color: isSelected ? '#ffffff' : isCorp ? '#c026d3' : '#f97316',
        fillOpacity: isSelected ? 0.95 : 0.72,
        dashArray: isSelected ? null : '6 4',
    };
}

function highlightSelected() {
    if (geojsonLayer) {
        geojsonLayer.eachLayer(layer => {
            const name = layer.feature.properties.name;
            geojsonLayer.resetStyle(layer);
            if (name === currentPanchayat) {
                layer.setStyle({ weight: 2.5, color: '#ffffff', fillOpacity: 0.95 });
            }
        });
    }
    if (municipalityLayer) {
        municipalityLayer.eachLayer(layer => {
            const name = layer.feature.properties.name;
            const type = layer.feature.properties['local_authority:IN'];
            municipalityLayer.resetStyle(layer);
            if (name === currentPanchayat) {
                layer.setStyle({ weight: 3, color: '#ffffff', fillOpacity: 0.95, dashArray: null });
            }
        });
    }
}

function refreshChoropleth() {
    if (geojsonLayer) {
        geojsonLayer.eachLayer(layer => {
            const name = layer.feature.properties.name;
            layer.setStyle(styleFeature(name));
        });
    }
    if (municipalityLayer) {
        municipalityLayer.eachLayer(layer => {
            const name = layer.feature.properties.name;
            const type = layer.feature.properties['local_authority:IN'];
            layer.setStyle(styleMuniFeature(name, type));
        });
    }
    updateMapLegend();
}

function addMapLegend() {
    // Choropleth toggle control
    const toggleCtrl = L.control({ position: 'topright' });
    toggleCtrl.onAdd = () => {
        const div = L.DomUtil.create('div', 'map-choropleth-toggle');
        div.innerHTML = `
            <button class="cmap-btn active" data-var="rainfall">🌧 Rainfall</button>
            <button class="cmap-btn"        data-var="temperature">🌡 Temp</button>`;
        L.DomEvent.disableClickPropagation(div);
        div.querySelectorAll('.cmap-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                div.querySelectorAll('.cmap-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                choroplethVar = btn.dataset.var;
                // Update the map panel badge to reflect current choropleth
                const badge = document.getElementById('map-legend-label');
                if (badge) {
                    badge.textContent = choroplethVar === 'temperature'
                        ? 'Click a local body to select • Coloured by annual temperature'
                        : 'Click a local body to select • Coloured by annual rainfall';
                }
                refreshChoropleth();
            });
        });
        return div;
    };
    toggleCtrl.addTo(map);

    // Legend control
    const legend = L.control({ position: 'bottomright' });
    legend.onAdd = () => {
        const div = L.DomUtil.create('div', 'map-legend');
        div.id = 'map-legend-box';
        updateLegendHTML(div);
        return div;
    };
    legend.addTo(map);
}

function updateMapLegend() {
    const div = document.getElementById('map-legend-box');
    if (div) updateLegendHTML(div);
}

function updateLegendHTML(div) {
    const boundaryKey = `
        <hr style="margin:6px 0;border-color:rgba(0,0,0,0.1)">
        <b style="font-size:10px">Boundaries</b><br>
        <span style="display:inline-block;width:24px;height:0;border-top:2px solid rgba(0,0,0,0.8);vertical-align:middle;margin-right:4px"></span>Grama Panchayat<br>
        <span style="display:inline-block;width:24px;height:0;border-top:2px dashed #f97316;vertical-align:middle;margin-right:4px"></span>Municipality<br>
        <span style="display:inline-block;width:24px;height:0;border-top:2px dashed #c026d3;vertical-align:middle;margin-right:4px"></span>Corporation`;

    if (choroplethVar === 'rainfall') {
        div.innerHTML = `
            <b>Annual Rainfall</b><br>
            <span style="background:#0369a1">&nbsp;&nbsp;&nbsp;</span> &gt;3500 mm<br>
            <span style="background:#0891b2">&nbsp;&nbsp;&nbsp;</span> 3000–3500<br>
            <span style="background:#06b6d4">&nbsp;&nbsp;&nbsp;</span> 2500–3000<br>
            <span style="background:#22d3ee">&nbsp;&nbsp;&nbsp;</span> 2000–2500<br>
            <span style="background:#67e8f9">&nbsp;&nbsp;&nbsp;</span> 1500–2000<br>
            <span style="background:#a5f3fc">&nbsp;&nbsp;&nbsp;</span> &lt;1500 mm` + boundaryKey;
    } else {
        div.innerHTML = `
            <b>Mean Temperature</b><br>
            <span style="background:#dc2626">&nbsp;&nbsp;&nbsp;</span> &gt;29 °C<br>
            <span style="background:#ef4444">&nbsp;&nbsp;&nbsp;</span> 28–29<br>
            <span style="background:#f59e0b">&nbsp;&nbsp;&nbsp;</span> 27–28<br>
            <span style="background:#facc15">&nbsp;&nbsp;&nbsp;</span> 26–27<br>
            <span style="background:#4ade80">&nbsp;&nbsp;&nbsp;</span> 25–26<br>
            <span style="background:#86efac">&nbsp;&nbsp;&nbsp;</span> &lt;25 °C` + boundaryKey;
    }
}

function selectPanchayatFromMap(name) {
    currentPanchayat = name;
    // Try setting the select value — works for both gram panchayat and urban units
    const sel = document.getElementById('panchayat-select');
    const opt = sel.querySelector(`option[value="${name}"]`);
    if (opt) sel.value = name;
    map.closePopup();
    updateAll();
}

// ── Info Popup Toggle ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    function closeAllPopups() {
        document.querySelectorAll('.info-popup').forEach(p => p.style.display = 'none');
    }

    document.querySelectorAll('.info-wrap .info-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const wrap = btn.closest('.info-wrap');
            if (!wrap) return;
            const popup = wrap.querySelector('.info-popup');
            if (!popup) return;
            const isOpen = popup.style.display === 'block';
            closeAllPopups();
            if (!isOpen) popup.style.display = 'block';
        });
    });

    // Close on click outside
    document.addEventListener('click', e => {
        if (!e.target.closest('.info-wrap')) closeAllPopups();
    });

    // Close on Escape
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closeAllPopups();
    });
});

// ── Boot ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', loadData);
