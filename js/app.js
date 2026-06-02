/* =========================================
   FenceEstimate Pro — Application Logic
   ========================================= */

// ──────────────────────────────────────────
// FENCE TYPE PRESETS (price per linear foot)
// ──────────────────────────────────────────
const FENCE_PRESETS = {
    'wood':        45,
    'vinyl':       55,
    'chain-link':  20,
    'aluminum':    45,
    'split-rail':  22,
    'custom':      0,
};

// ──────────────────────────────────────────
// APPLICATION STATE
// ──────────────────────────────────────────
const state = {
    map:             null,
    drawingManager:  null,
    autocomplete:    null,
    mapTypeRoad:     false,     // false = hybrid/satellite, true = roadmap

    mode:            null,      // 'draw' | 'gate' | null
    segments:        [],        // [{ id, polyline, labelMarker, lengthFt }]
    gates:           [],        // [{ id, marker, type }]
    actionHistory:   [],        // for undo: [{ kind:'segment'|'gate', id }]
    nextId:          1,

    gateClickListener: null,
    pendingGateLatLng: null,

    pricing: {
        fenceType:    'wood',
        perFoot:      45,
        singleGate:   350,
        doubleGate:   650,
        taxRate:      0,
    },
    companyName:   '',
    currentAddress: '',
};

// ──────────────────────────────────────────
// INITIALIZATION  (Google Maps callback)
// ──────────────────────────────────────────
function initMap() {
    state.map = new google.maps.Map(document.getElementById('map'), {
        center:           { lat: 39.8283, lng: -98.5795 },
        zoom:             4,
        mapTypeId:        'hybrid',
        mapTypeControl:   false,
        streetViewControl: false,
        fullscreenControl: false,
        zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_CENTER },
    });

    setupDrawingManager();
    setupAutocomplete();
    setupUIListeners();
    loadSettings();
}

// Auth failure callback for invalid API key
window.gm_authFailure = function () {
    document.getElementById('api-error').classList.remove('hidden');
};

// ──────────────────────────────────────────
// DRAWING MANAGER
// ──────────────────────────────────────────
function setupDrawingManager() {
    state.drawingManager = new google.maps.drawing.DrawingManager({
        drawingMode:    null,
        drawingControl: false,
        polylineOptions: {
            strokeColor:   '#16a34a',
            strokeOpacity: 0.95,
            strokeWeight:  3,
            clickable:     true,
            editable:      false,
            zIndex:        1,
        },
    });

    state.drawingManager.setMap(state.map);

    state.drawingManager.addListener('overlaycomplete', (event) => {
        if (event.type !== google.maps.drawing.OverlayType.POLYLINE) return;

        const polyline = event.overlay;
        if (polyline.getPath().getLength() < 2) {
            polyline.setMap(null);
        } else {
            onPolylineComplete(polyline);
        }

        // Stay in draw mode to allow chaining another section
        if (state.mode === 'draw') {
            state.drawingManager.setDrawingMode(google.maps.drawing.OverlayType.POLYLINE);
        }
    });
}

// ──────────────────────────────────────────
// POLYLINE COMPLETE
// ──────────────────────────────────────────
function onPolylineComplete(polyline) {
    const lengthFt = computeLengthFt(polyline);
    const id       = state.nextId++;
    const label    = createSegmentLabel(getPolylineMidpoint(polyline), id);

    // Hover highlight
    polyline.addListener('mouseover', () => polyline.setOptions({ strokeWeight: 5, strokeColor: '#15803d' }));
    polyline.addListener('mouseout',  () => polyline.setOptions({ strokeWeight: 3, strokeColor: '#16a34a' }));

    state.segments.push({ id, polyline, labelMarker: label, lengthFt });
    state.actionHistory.push({ kind: 'segment', id });

    renderSegmentsList();
    renderGatesList();
    renderTotals();
}

// ──────────────────────────────────────────
// SEGMENT LABEL MARKER
// ──────────────────────────────────────────
function createSegmentLabel(position, number) {
    return new google.maps.Marker({
        position,
        map: state.map,
        icon: {
            path:          google.maps.SymbolPath.CIRCLE,
            fillColor:     '#16a34a',
            fillOpacity:   1,
            strokeColor:   '#ffffff',
            strokeWeight:  2,
            scale:         13,
        },
        label: {
            text:       String(number),
            color:      '#ffffff',
            fontSize:   '11px',
            fontWeight: 'bold',
        },
        title:  `Section ${number}`,
        zIndex: 50,
    });
}

// ──────────────────────────────────────────
// GATE PLACEMENT
// ──────────────────────────────────────────
function enableGateMode() {
    disableGateMode();
    state.gateClickListener = state.map.addListener('click', (event) => {
        showGateModal(event.latLng);
    });
}

function disableGateMode() {
    if (state.gateClickListener) {
        google.maps.event.removeListener(state.gateClickListener);
        state.gateClickListener = null;
    }
}

function showGateModal(latLng) {
    state.pendingGateLatLng = latLng;
    const pricing = readPricingFromUI();
    document.getElementById('modal-single-price').textContent = '$' + pricing.singleGate.toLocaleString();
    document.getElementById('modal-double-price').textContent = '$' + pricing.doubleGate.toLocaleString();
    document.getElementById('gate-modal').classList.remove('hidden');
}

function placeGate(latLng, type) {
    const id     = state.nextId++;
    const marker = createGateMarker(latLng, type, id);

    state.gates.push({ id, marker, type });
    state.actionHistory.push({ kind: 'gate', id });

    renderSegmentsList();
    renderGatesList();
    renderTotals();
}

function createGateMarker(position, type, id) {
    const label = type === 'double' ? 'DG' : 'G';
    return new google.maps.Marker({
        position,
        map: state.map,
        icon: {
            path:        google.maps.SymbolPath.CIRCLE,
            fillColor:   '#2563eb',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2,
            scale:       11,
        },
        label: {
            text:       label,
            color:      '#ffffff',
            fontSize:   '9px',
            fontWeight: 'bold',
        },
        title:  type === 'single' ? 'Single Gate' : 'Double Gate',
        zIndex: 100,
    });
}

// ──────────────────────────────────────────
// MODE MANAGEMENT
// ──────────────────────────────────────────
function setMode(newMode) {
    // Toggle off if clicking the active mode
    if (state.mode === newMode) newMode = null;

    state.mode = newMode;

    // Manage DrawingManager
    if (newMode === 'draw') {
        state.drawingManager.setDrawingMode(google.maps.drawing.OverlayType.POLYLINE);
        disableGateMode();
    } else {
        state.drawingManager.setDrawingMode(null);
    }

    if (newMode === 'gate') {
        enableGateMode();
    } else {
        disableGateMode();
    }

    // Update button active states
    document.querySelectorAll('.tool-btn[data-mode]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.mode === newMode);
    });

    // Update hint text
    const hints = {
        draw: 'Click on the map to place fence points. Double-click to finish a section. Draw multiple sections as needed.',
        gate: 'Click anywhere on the map to place a gate marker. Choose single or double gate.',
    };
    document.getElementById('mode-hint').textContent =
        hints[newMode] || 'Click "Draw Fence" to start measuring your fence line.';
}

// ──────────────────────────────────────────
// REMOVE / UNDO / CLEAR
// ──────────────────────────────────────────
function removeSegment(id) {
    const idx = state.segments.findIndex((s) => s.id === id);
    if (idx === -1) return;
    const [seg] = state.segments.splice(idx, 1);
    seg.polyline.setMap(null);
    seg.labelMarker.setMap(null);
    state.actionHistory = state.actionHistory.filter((a) => !(a.kind === 'segment' && a.id === id));
    renderSegmentsList();
    renderTotals();
}

function removeGate(id) {
    const idx = state.gates.findIndex((g) => g.id === id);
    if (idx === -1) return;
    const [gate] = state.gates.splice(idx, 1);
    gate.marker.setMap(null);
    state.actionHistory = state.actionHistory.filter((a) => !(a.kind === 'gate' && a.id === id));
    renderGatesList();
    renderTotals();
}

function undo() {
    if (!state.actionHistory.length) return;
    const last = state.actionHistory[state.actionHistory.length - 1];
    if (last.kind === 'segment') removeSegment(last.id);
    else if (last.kind === 'gate') removeGate(last.id);
}

function clearAll() {
    if (!state.segments.length && !state.gates.length) return;
    if (!confirm('Remove all fence sections and gates?')) return;
    [...state.segments].forEach((s) => removeSegment(s.id));
    [...state.gates].forEach((g) => removeGate(g.id));
    state.actionHistory = [];
    renderSegmentsList();
    renderGatesList();
    renderTotals();
}

// ──────────────────────────────────────────
// MEASUREMENTS
// ──────────────────────────────────────────
function computeLengthFt(polyline) {
    const meters = google.maps.geometry.spherical.computeLength(polyline.getPath());
    return meters * 3.28084; // meters → feet
}

function getPolylineMidpoint(polyline) {
    const path = polyline.getPath();
    let lat = 0, lng = 0;
    const n = path.getLength();
    for (let i = 0; i < n; i++) {
        lat += path.getAt(i).lat();
        lng += path.getAt(i).lng();
    }
    return new google.maps.LatLng(lat / n, lng / n);
}

function getTotalFeet() {
    return state.segments.reduce((sum, s) => sum + s.lengthFt, 0);
}

// ──────────────────────────────────────────
// RENDER — SEGMENTS LIST
// ──────────────────────────────────────────
function renderSegmentsList() {
    const container = document.getElementById('segments-list');

    if (!state.segments.length) {
        container.innerHTML = '<div class="empty-state">No fence sections yet — draw on the map to start</div>';
        return;
    }

    container.innerHTML = state.segments.map((seg) => `
        <div class="item-row">
            <div class="item-number">${seg.id}</div>
            <div class="item-label">
                Section ${seg.id}
                <span>Fence section</span>
            </div>
            <div class="item-value">${Math.round(seg.lengthFt)} ft</div>
            <button class="item-delete" onclick="removeSegment(${seg.id})" title="Remove section" aria-label="Remove section ${seg.id}">&times;</button>
        </div>
    `).join('');
}

// ──────────────────────────────────────────
// RENDER — GATES LIST
// ──────────────────────────────────────────
function renderGatesList() {
    const container = document.getElementById('gates-list');
    if (!state.gates.length) {
        container.innerHTML = '';
        return;
    }

    const pricing = readPricingFromUI();
    container.innerHTML = state.gates.map((gate, i) => {
        const label = gate.type === 'single' ? 'Single Gate (~4 ft)' : 'Double Gate (~10 ft)';
        const price = gate.type === 'single' ? pricing.singleGate : pricing.doubleGate;
        return `
            <div class="item-row">
                <div class="item-number gate-number">G${i + 1}</div>
                <div class="item-label">
                    ${label}
                    <span>Gate</span>
                </div>
                <div class="item-value">${formatCurrency(price)}</div>
                <button class="item-delete" onclick="removeGate(${gate.id})" title="Remove gate" aria-label="Remove gate">&times;</button>
            </div>
        `;
    }).join('');
}

// ──────────────────────────────────────────
// RENDER — TOTALS
// ──────────────────────────────────────────
function renderTotals() {
    const pricing    = readPricingFromUI();
    const totalFt    = getTotalFeet();
    const fenceAmt   = totalFt * pricing.perFoot;

    const singleCount = state.gates.filter((g) => g.type === 'single').length;
    const doubleCount = state.gates.filter((g) => g.type === 'double').length;
    const gateAmt     = singleCount * pricing.singleGate + doubleCount * pricing.doubleGate;

    const subtotal  = fenceAmt + gateAmt;
    const taxAmt    = subtotal * (pricing.taxRate / 100);
    const total     = subtotal + taxAmt;

    document.getElementById('total-feet').textContent  = Math.round(totalFt).toLocaleString() + ' ft';
    document.getElementById('fence-cost').textContent  = formatCurrency(fenceAmt);
    document.getElementById('subtotal').textContent    = formatCurrency(subtotal);
    document.getElementById('grand-total').textContent = formatCurrency(total);

    // Gate cost row
    const gateRow = document.getElementById('gate-cost-row');
    if (gateAmt > 0) {
        gateRow.style.display = '';
        document.getElementById('gate-cost').textContent = formatCurrency(gateAmt);
    } else {
        gateRow.style.display = 'none';
    }

    // Tax row
    const taxRow = document.getElementById('tax-row');
    document.getElementById('tax-rate-label').textContent = pricing.taxRate;
    if (pricing.taxRate > 0) {
        taxRow.style.display = '';
        document.getElementById('tax-amount').textContent = formatCurrency(taxAmt);
    } else {
        taxRow.style.display = 'none';
    }

    // Enable/disable print button
    document.getElementById('btn-print').disabled = (state.segments.length === 0);
}

// ──────────────────────────────────────────
// PRICING — read inputs
// ──────────────────────────────────────────
function readPricingFromUI() {
    return {
        fenceType:  document.getElementById('fence-type').value,
        perFoot:    parseFloat(document.getElementById('price-per-foot').value)  || 0,
        singleGate: parseFloat(document.getElementById('price-single-gate').value) || 0,
        doubleGate: parseFloat(document.getElementById('price-double-gate').value) || 0,
        taxRate:    parseFloat(document.getElementById('tax-rate').value) || 0,
    };
}

function onFenceTypeChange() {
    const type  = document.getElementById('fence-type').value;
    const price = FENCE_PRESETS[type];
    if (type !== 'custom' && price != null) {
        document.getElementById('price-per-foot').value = price;
    }
    onPricingChange();
}

function onPricingChange() {
    renderGatesList();
    renderTotals();
    saveSettings();
}

// ──────────────────────────────────────────
// AUTOCOMPLETE — address search
// ──────────────────────────────────────────
function setupAutocomplete() {
    const input = document.getElementById('address-input');
    state.autocomplete = new google.maps.places.Autocomplete(input, {
        types: ['address'],
        fields: ['geometry', 'formatted_address'],
    });

    state.autocomplete.addListener('place_changed', () => {
        const place = state.autocomplete.getPlace();
        if (!place.geometry || !place.geometry.location) return;

        state.currentAddress = place.formatted_address || input.value;
        state.map.setCenter(place.geometry.location);
        state.map.setZoom(19); // street-level for fence drawing
    });
}

// Geolocation button
function locateUser() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            const latlng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            state.map.setCenter(latlng);
            state.map.setZoom(19);
            // Reverse geocode to fill the address field
            const geocoder = new google.maps.Geocoder();
            geocoder.geocode({ location: latlng }, (results, status) => {
                if (status === 'OK' && results[0]) {
                    document.getElementById('address-input').value = results[0].formatted_address;
                    state.currentAddress = results[0].formatted_address;
                }
            });
        },
        () => alert('Unable to retrieve your location.')
    );
}

// ──────────────────────────────────────────
// PRINT
// ──────────────────────────────────────────
function printEstimate() {
    if (!state.segments.length) return;

    const pricing     = readPricingFromUI();
    const totalFt     = getTotalFeet();
    const fenceAmt    = totalFt * pricing.perFoot;
    const singleCount = state.gates.filter((g) => g.type === 'single').length;
    const doubleCount = state.gates.filter((g) => g.type === 'double').length;
    const gateAmt     = singleCount * pricing.singleGate + doubleCount * pricing.doubleGate;
    const subtotal    = fenceAmt + gateAmt;
    const taxAmt      = subtotal * (pricing.taxRate / 100);
    const total       = subtotal + taxAmt;

    // Fill header
    const company = document.getElementById('company-name').value || 'Your Company';
    document.getElementById('pt-company-name').textContent = company;
    document.getElementById('pt-date').textContent = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    document.getElementById('pt-address').textContent = state.currentAddress || document.getElementById('address-input').value || '—';

    // Build items rows
    const fenceTypeLabel = document.getElementById('fence-type').selectedOptions[0]?.text || 'Fence';
    const rows = [];

    state.segments.forEach((seg, i) => {
        rows.push(`
            <tr>
                <td>${fenceTypeLabel} — Section ${i + 1}</td>
                <td>${Math.round(seg.lengthFt)} lin. ft</td>
                <td>${formatCurrency(pricing.perFoot)} / ft</td>
                <td>${formatCurrency(seg.lengthFt * pricing.perFoot)}</td>
            </tr>
        `);
    });

    if (singleCount > 0) {
        rows.push(`
            <tr>
                <td>Single Gate (installed, ~4 ft wide)</td>
                <td>${singleCount} gate${singleCount > 1 ? 's' : ''}</td>
                <td>${formatCurrency(pricing.singleGate)} ea.</td>
                <td>${formatCurrency(singleCount * pricing.singleGate)}</td>
            </tr>
        `);
    }
    if (doubleCount > 0) {
        rows.push(`
            <tr>
                <td>Double Gate (installed, ~10 ft wide)</td>
                <td>${doubleCount} gate${doubleCount > 1 ? 's' : ''}</td>
                <td>${formatCurrency(pricing.doubleGate)} ea.</td>
                <td>${formatCurrency(doubleCount * pricing.doubleGate)}</td>
            </tr>
        `);
    }

    document.getElementById('pt-items-body').innerHTML = rows.join('');
    document.getElementById('pt-subtotal').textContent = formatCurrency(subtotal);
    document.getElementById('pt-total').textContent    = formatCurrency(total);

    // Tax row
    const taxRow = document.getElementById('pt-tax-row');
    if (pricing.taxRate > 0) {
        taxRow.classList.add('visible');
        document.getElementById('pt-tax-label').textContent = `Tax (${pricing.taxRate}%)`;
        document.getElementById('pt-tax').textContent = formatCurrency(taxAmt);
    } else {
        taxRow.classList.remove('visible');
    }

    // Notes
    const notesVal = document.getElementById('notes-input').value.trim();
    const notesSection = document.getElementById('pt-notes-section');
    if (notesVal) {
        notesSection.classList.remove('hidden');
        document.getElementById('pt-notes-text').textContent = notesVal;
    } else {
        notesSection.classList.add('hidden');
    }

    window.print();
}

// ──────────────────────────────────────────
// SETTINGS PERSISTENCE
// ──────────────────────────────────────────
function saveSettings() {
    try {
        const data = {
            fenceType:    document.getElementById('fence-type').value,
            perFoot:      document.getElementById('price-per-foot').value,
            singleGate:   document.getElementById('price-single-gate').value,
            doubleGate:   document.getElementById('price-double-gate').value,
            taxRate:      document.getElementById('tax-rate').value,
            companyName:  document.getElementById('company-name').value,
        };
        localStorage.setItem('fenceEstimatePro', JSON.stringify(data));
    } catch (_) { /* storage unavailable */ }
}

function loadSettings() {
    try {
        const raw = localStorage.getItem('fenceEstimatePro');
        if (!raw) return;
        const data = JSON.parse(raw);
        if (data.fenceType)   document.getElementById('fence-type').value         = data.fenceType;
        if (data.perFoot)     document.getElementById('price-per-foot').value      = data.perFoot;
        if (data.singleGate)  document.getElementById('price-single-gate').value   = data.singleGate;
        if (data.doubleGate)  document.getElementById('price-double-gate').value   = data.doubleGate;
        if (data.taxRate)     document.getElementById('tax-rate').value             = data.taxRate;
        if (data.companyName) document.getElementById('company-name').value         = data.companyName;
    } catch (_) { /* corrupted storage */ }
}

// ──────────────────────────────────────────
// UI LISTENERS
// ──────────────────────────────────────────
function setupUIListeners() {
    // Drawing tools
    document.getElementById('btn-draw').addEventListener('click', () => setMode('draw'));
    document.getElementById('btn-gate').addEventListener('click', () => setMode('gate'));
    document.getElementById('btn-undo').addEventListener('click', undo);
    document.getElementById('btn-clear').addEventListener('click', clearAll);

    // Print
    document.getElementById('btn-print').addEventListener('click', printEstimate);

    // Locate
    document.getElementById('btn-locate').addEventListener('click', locateUser);

    // Map type toggle
    document.getElementById('btn-map-type').addEventListener('click', () => {
        state.mapTypeRoad = !state.mapTypeRoad;
        state.map.setMapTypeId(state.mapTypeRoad ? 'roadmap' : 'hybrid');
        document.getElementById('btn-map-type').textContent = state.mapTypeRoad ? 'Satellite' : 'Map';
        document.getElementById('btn-map-type').classList.toggle('active', state.mapTypeRoad);
    });

    // Sidebar toggle
    document.getElementById('sidebar-toggle').addEventListener('click', () => {
        const sidebar = document.getElementById('sidebar');
        const isCollapsed = sidebar.classList.toggle('collapsed');
        document.getElementById('sidebar-toggle').textContent = isCollapsed ? '›' : '‹';
    });

    // Fence type preset
    document.getElementById('fence-type').addEventListener('change', onFenceTypeChange);

    // Pricing inputs → live recalculate
    ['price-per-foot', 'price-single-gate', 'price-double-gate', 'tax-rate'].forEach((id) => {
        document.getElementById(id).addEventListener('input', onPricingChange);
    });

    // Company name save
    document.getElementById('company-name').addEventListener('input', saveSettings);
    document.getElementById('notes-input').addEventListener('input', saveSettings);

    // Address input blur → update stored address
    document.getElementById('address-input').addEventListener('change', () => {
        state.currentAddress = document.getElementById('address-input').value;
    });

    // Gate modal
    document.querySelectorAll('.gate-option').forEach((btn) => {
        btn.addEventListener('click', () => {
            const type = btn.dataset.type;
            document.getElementById('gate-modal').classList.add('hidden');
            if (state.pendingGateLatLng) {
                placeGate(state.pendingGateLatLng, type);
                state.pendingGateLatLng = null;
            }
        });
    });

    document.getElementById('modal-cancel').addEventListener('click', () => {
        document.getElementById('gate-modal').classList.add('hidden');
        state.pendingGateLatLng = null;
    });

    // Close modal on overlay click
    document.getElementById('gate-modal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) {
            document.getElementById('gate-modal').classList.add('hidden');
            state.pendingGateLatLng = null;
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
        if (e.key === 'Escape') {
            setMode(null);
            document.getElementById('gate-modal').classList.add('hidden');
        }
        if (e.key === 'd' || e.key === 'D') setMode('draw');
        if (e.key === 'g' || e.key === 'G') setMode('gate');
    });
}

// ──────────────────────────────────────────
// UTILITIES
// ──────────────────────────────────────────
function formatCurrency(n) {
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
