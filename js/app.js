/* =========================================
   FenceEstimate Pro — Application Logic
   ========================================= */

const FENCE_PRESETS = {
    'wood':        45,
    'vinyl':       55,
    'chain-link':  20,
    'aluminum':    45,
    'split-rail':  22,
    'custom':      0,
};

// ──────────────────────────────────────────
// STATE
// ──────────────────────────────────────────
const state = {
    map:             null,
    autocomplete:    null,
    mapTypeRoad:     false,

    mode:            null,          // 'draw' | 'gate' | null
    segments:        [],            // [{ id, polyline, labelMarker, lengthFt }]
    gates:           [],            // [{ id, marker, type }]
    actionHistory:   [],
    nextId:          1,

    // Custom drawing state
    drawingPoints:   [],            // LatLng[] being built
    drawingPolyline: null,          // live preview polyline
    drawingDots:     [],            // small markers at each tap point

    gateClickListener:  null,
    mapDrawListener:    null,
    pendingGateLatLng:  null,
    currentAddress:     '',
};

// ──────────────────────────────────────────
// BOOTSTRAP
// ──────────────────────────────────────────
(function bootstrap() {
    applyBranding();
    applyConfigDefaults();
    loadLocalSettings();
    loadGoogleMapsScript();
})();

// ──────────────────────────────────────────
// BRANDING
// ──────────────────────────────────────────
function applyBranding() {
    const color  = FENCE_CONFIG.primaryColor || '#16a34a';
    const darker = shadeColor(color, -12);
    const root   = document.documentElement;
    root.style.setProperty('--green',       color);
    root.style.setProperty('--green-dark',  darker);
    root.style.setProperty('--green-light', shadeColor(color, 88));

    if (FENCE_CONFIG.companyName) {
        const brandEl = document.getElementById('brand-name-display');
        if (brandEl) brandEl.textContent = FENCE_CONFIG.companyName;
        const input = document.getElementById('company-name');
        if (input && !input.value) input.value = FENCE_CONFIG.companyName;
        document.title = FENCE_CONFIG.companyName + ' — Fence Estimator';
    }
}

function shadeColor(hex, pct) {
    hex = hex.replace('#','');
    if (hex.length === 3) hex = hex.split('').map(c => c+c).join('');
    const num = parseInt(hex, 16);
    const r   = Math.min(255, Math.max(0, (num >> 16)         + Math.round(255 * pct / 100)));
    const g   = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + Math.round(255 * pct / 100)));
    const b   = Math.min(255, Math.max(0, (num & 0xff)        + Math.round(255 * pct / 100)));
    return '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('');
}

// ──────────────────────────────────────────
// CONFIG DEFAULTS
// ──────────────────────────────────────────
function applyConfigDefaults() {
    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el && val != null && val !== '') el.value = val;
    };
    setVal('fence-type',        FENCE_CONFIG.fenceType);
    setVal('price-per-foot',    FENCE_CONFIG.pricePerFoot);
    setVal('price-single-gate', FENCE_CONFIG.singleGate);
    setVal('price-double-gate', FENCE_CONFIG.doubleGate);
    setVal('tax-rate',          FENCE_CONFIG.taxRate);
    setVal('notes-input',       FENCE_CONFIG.defaultNotes);

    if (!FENCE_CONFIG.allowPriceEdit) {
        ['price-per-foot','price-single-gate','price-double-gate','tax-rate'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.readOnly = true; el.style.background = '#f9fafb'; }
        });
        const ft = document.getElementById('fence-type');
        if (ft) ft.disabled = true;
    }
}

// ──────────────────────────────────────────
// DYNAMIC GOOGLE MAPS LOADER
// ──────────────────────────────────────────
function loadGoogleMapsScript() {
    const key = FENCE_CONFIG.googleMapsApiKey;
    if (!key || key === 'YOUR_GOOGLE_MAPS_API_KEY') {
        document.getElementById('api-error').classList.remove('hidden');
        return;
    }
    const script   = document.createElement('script');
    script.src     = 'https://maps.googleapis.com/maps/api/js'
        + '?key=' + encodeURIComponent(key)
        + '&libraries=places,geometry,drawing'
        + '&callback=initMap&loading=async';
    script.async   = true;
    script.defer   = true;
    script.onerror = () => document.getElementById('api-error').classList.remove('hidden');
    document.head.appendChild(script);
}

window.gm_authFailure = function () {
    document.getElementById('api-error').classList.remove('hidden');
};

// ──────────────────────────────────────────
// MAP INIT
// ──────────────────────────────────────────
function initMap() {
    state.map = new google.maps.Map(document.getElementById('map'), {
        center:                 { lat: 39.8283, lng: -98.5795 },
        zoom:                   4,
        mapTypeId:              'hybrid',
        mapTypeControl:         false,
        streetViewControl:      false,
        fullscreenControl:      false,
        disableDoubleClickZoom: false,
        gestureHandling:        'greedy',
        zoomControlOptions:     { position: google.maps.ControlPosition.RIGHT_CENTER },
    });

    setupAutocomplete();
    setupUIListeners();
    renderTotals();
}

// ──────────────────────────────────────────
// MAP LOCK / UNLOCK  (prevents pan/zoom
// interfering with drawing taps on mobile)
// ──────────────────────────────────────────
function lockMap() {
    state.map.setOptions({
        gestureHandling:        'none',
        draggable:              false,
        scrollwheel:            false,
        disableDoubleClickZoom: true,
    });
}

function unlockMap() {
    state.map.setOptions({
        gestureHandling:        'greedy',
        draggable:              true,
        scrollwheel:            true,
        disableDoubleClickZoom: false,
    });
}

// ──────────────────────────────────────────
// MODE MANAGEMENT
// ──────────────────────────────────────────
function setMode(newMode) {
    if (state.mode === newMode) newMode = null;

    // Cancel any in-progress drawing before switching
    if (state.mode === 'draw') cancelDrawing();

    state.mode = newMode;

    // Clean up listeners
    if (state.mapDrawListener) {
        google.maps.event.removeListener(state.mapDrawListener);
        state.mapDrawListener = null;
    }
    disableGateMode();

    const mapArea = document.getElementById('map-area');

    if (newMode === 'draw') {
        lockMap();
        mapArea.classList.add('map-locked');
        state.mapDrawListener = state.map.addListener('click', onMapTapForDraw);
        showDrawingBar(true);
    } else if (newMode === 'gate') {
        lockMap();
        mapArea.classList.add('map-locked');
        enableGateMode();
        showDrawingBar(false);
    } else {
        unlockMap();
        mapArea.classList.remove('map-locked');
        showDrawingBar(null);
    }

    document.querySelectorAll('.tool-btn[data-mode]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === newMode);
    });

    const hints = {
        draw: 'Map locked. Tap points on the map to trace your fence line, then tap Finish Section.',
        gate: 'Map locked. Tap where you want a gate, then choose the gate type.',
    };
    document.getElementById('mode-hint').textContent =
        hints[newMode] || 'Tap "Draw Fence" to start. The map will lock so your taps place fence points.';
}

function showDrawingBar(isDrawMode) {
    const bar = document.getElementById('drawing-bar');
    if (isDrawMode === null) {
        bar.classList.add('hidden');
        return;
    }
    bar.classList.remove('hidden');
    if (isDrawMode) {
        updateDrawingBarCount();
    } else {
        document.getElementById('drawing-bar-text').textContent = 'Tap on the map to place a gate';
        document.getElementById('btn-finish-section').style.display = 'none';
    }
}

function updateDrawingBarCount() {
    const n = state.drawingPoints.length;
    const bar = document.getElementById('drawing-bar-text');
    if (n === 0) {
        bar.textContent = 'Tap the map to place your first fence point';
    } else if (n === 1) {
        bar.textContent = '1 point placed — tap more points to continue';
    } else {
        const ft = computeLengthFtFromPoints(state.drawingPoints);
        bar.textContent = `${n} points — ${Math.round(ft)} ft so far`;
    }
    document.getElementById('btn-undo-point').style.display    = n >= 1 ? '' : 'none';
    document.getElementById('btn-finish-section').style.display = n >= 2 ? '' : 'none';
}

// ──────────────────────────────────────────
// CUSTOM TAP-TO-DRAW
// ──────────────────────────────────────────
function onMapTapForDraw(event) {
    const latLng = event.latLng;
    state.drawingPoints.push(latLng);

    const lineColor = FENCE_CONFIG.fenceLineColor || '#f97316';

    // Small dot marker at tap point
    const dot = new google.maps.Marker({
        position:  latLng,
        map:       state.map,
        icon: {
            path:         google.maps.SymbolPath.CIRCLE,
            fillColor:    lineColor,
            fillOpacity:  1,
            strokeColor:  '#ffffff',
            strokeWeight: 2,
            scale:        6,
        },
        clickable: false,
        zIndex:    200,
    });
    state.drawingDots.push(dot);

    // Update preview polyline
    if (state.drawingPolyline) {
        state.drawingPolyline.setPath(state.drawingPoints);
    } else {
        state.drawingPolyline = new google.maps.Polyline({
            path:          state.drawingPoints,
            strokeColor:   lineColor,
            strokeOpacity: 0.85,
            strokeWeight:  4,
            map:           state.map,
            clickable:     false,
            icons: [{
                icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3 },
                offset: '0',
                repeat: '14px',
            }],
        });
    }

    updateDrawingBarCount();
}

function undoLastPoint() {
    if (!state.drawingPoints.length) return;
    state.drawingPoints.pop();

    // Remove last dot marker
    const dot = state.drawingDots.pop();
    if (dot) dot.setMap(null);

    // Update or remove preview polyline
    if (state.drawingPoints.length < 1) {
        if (state.drawingPolyline) { state.drawingPolyline.setMap(null); state.drawingPolyline = null; }
    } else if (state.drawingPolyline) {
        state.drawingPolyline.setPath(state.drawingPoints);
    }

    updateDrawingBarCount();
}

function finishSection() {
    if (state.drawingPoints.length < 2) return;

    // Build final polyline from drawn points
    const polyline = new google.maps.Polyline({
        path:          state.drawingPoints,
        strokeColor:   FENCE_CONFIG.primaryColor || '#16a34a',
        strokeOpacity: 0.95,
        strokeWeight:  3,
        map:           state.map,
        clickable:     true,
    });

    clearDrawingPreview();
    onPolylineComplete(polyline);

    // Stay in draw mode for the next section
    updateDrawingBarCount();
}

function cancelDrawing() {
    clearDrawingPreview();
    updateDrawingBarCount();
}

function clearDrawingPreview() {
    if (state.drawingPolyline) {
        state.drawingPolyline.setMap(null);
        state.drawingPolyline = null;
    }
    state.drawingDots.forEach(d => d.setMap(null));
    state.drawingDots  = [];
    state.drawingPoints = [];
}

// ──────────────────────────────────────────
// POLYLINE COMPLETE
// ──────────────────────────────────────────
function onPolylineComplete(polyline) {
    const lengthFt  = computeLengthFt(polyline);
    const id        = state.nextId++;
    const lineColor = FENCE_CONFIG.fenceLineColor || '#f97316';
    const darkColor = shadeColor(lineColor, -15);

    // White outline polyline drawn underneath for contrast on any background
    const outline = new google.maps.Polyline({
        path:          polyline.getPath(),
        strokeColor:   '#ffffff',
        strokeOpacity: 0.9,
        strokeWeight:  7,
        map:           state.map,
        clickable:     false,
        zIndex:        1,
    });

    polyline.setOptions({ strokeColor: lineColor, strokeOpacity: 1, strokeWeight: 4, zIndex: 2 });

    polyline.addListener('mouseover', () => polyline.setOptions({ strokeWeight: 6, strokeColor: darkColor }));
    polyline.addListener('mouseout',  () => polyline.setOptions({ strokeWeight: 4, strokeColor: lineColor }));

    const label = createSegmentLabel(getPolylineMidpoint(polyline), id);

    state.segments.push({ id, polyline, outline, labelMarker: label, lengthFt });
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
            path:         google.maps.SymbolPath.CIRCLE,
            fillColor:    FENCE_CONFIG.fenceLineColor || '#f97316',
            fillOpacity:  1,
            strokeColor:  '#ffffff',
            strokeWeight: 2,
            scale:        13,
        },
        label: {
            text: String(number), color: '#ffffff', fontSize: '11px', fontWeight: 'bold',
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
    document.getElementById('modal-single-price').textContent = formatCurrency(pricing.singleGate);
    document.getElementById('modal-double-price').textContent = formatCurrency(pricing.doubleGate);
    document.getElementById('gate-modal').classList.remove('hidden');
}

function placeGate(latLng, type) {
    const id     = state.nextId++;
    const marker = createGateMarker(latLng, type);
    state.gates.push({ id, marker, type });
    state.actionHistory.push({ kind: 'gate', id });
    renderSegmentsList();
    renderGatesList();
    renderTotals();
}

function createGateMarker(position, type) {
    return new google.maps.Marker({
        position, map: state.map,
        icon: {
            path:         google.maps.SymbolPath.CIRCLE,
            fillColor:    '#2563eb',
            fillOpacity:  1,
            strokeColor:  '#ffffff',
            strokeWeight: 2,
            scale:        11,
        },
        label: { text: type === 'double' ? 'DG' : 'G', color: '#ffffff', fontSize: '9px', fontWeight: 'bold' },
        title:  type === 'single' ? 'Single Gate' : 'Double Gate',
        zIndex: 100,
    });
}

// ──────────────────────────────────────────
// REMOVE / UNDO / CLEAR
// ──────────────────────────────────────────
function removeSegment(id) {
    const idx = state.segments.findIndex(s => s.id === id);
    if (idx === -1) return;
    const [seg] = state.segments.splice(idx, 1);
    seg.polyline.setMap(null);
    if (seg.outline) seg.outline.setMap(null);
    seg.labelMarker.setMap(null);
    state.actionHistory = state.actionHistory.filter(a => !(a.kind === 'segment' && a.id === id));
    renderSegmentsList();
    renderTotals();
}

function removeGate(id) {
    const idx = state.gates.findIndex(g => g.id === id);
    if (idx === -1) return;
    const [gate] = state.gates.splice(idx, 1);
    gate.marker.setMap(null);
    state.actionHistory = state.actionHistory.filter(a => !(a.kind === 'gate' && a.id === id));
    renderGatesList();
    renderTotals();
}

function undo() {
    // While drawing: remove the last placed point
    if (state.mode === 'draw' && state.drawingPoints.length > 0) {
        undoLastPoint();
        return;
    }
    // Otherwise: remove the last completed segment or gate
    if (!state.actionHistory.length) return;
    const last = state.actionHistory[state.actionHistory.length - 1];
    if (last.kind === 'segment') removeSegment(last.id);
    else if (last.kind === 'gate') removeGate(last.id);
}

function clearAll() {
    if (!state.segments.length && !state.gates.length) return;
    if (!confirm('Remove all fence sections and gates?')) return;
    cancelDrawing();
    [...state.segments].forEach(s => removeSegment(s.id));
    [...state.gates].forEach(g => removeGate(g.id));
    state.actionHistory = [];
    renderSegmentsList();
    renderGatesList();
    renderTotals();
}

// ──────────────────────────────────────────
// MEASUREMENTS
// ──────────────────────────────────────────
function computeLengthFt(polyline) {
    return google.maps.geometry.spherical.computeLength(polyline.getPath()) * 3.28084;
}

function computeLengthFtFromPoints(points) {
    if (points.length < 2) return 0;
    let meters = 0;
    for (let i = 1; i < points.length; i++) {
        meters += google.maps.geometry.spherical.computeDistanceBetween(points[i-1], points[i]);
    }
    return meters * 3.28084;
}

function getPolylineMidpoint(polyline) {
    const path = polyline.getPath();
    let lat = 0, lng = 0;
    const n = path.getLength();
    for (let i = 0; i < n; i++) { lat += path.getAt(i).lat(); lng += path.getAt(i).lng(); }
    return new google.maps.LatLng(lat / n, lng / n);
}

function getTotalFeet() {
    return state.segments.reduce((s, seg) => s + seg.lengthFt, 0);
}

// ──────────────────────────────────────────
// RENDER — SEGMENTS LIST
// ──────────────────────────────────────────
function renderSegmentsList() {
    const el = document.getElementById('segments-list');
    if (!state.segments.length) {
        el.innerHTML = '<div class="empty-state">No fence sections yet — draw on the map to start</div>';
        return;
    }
    el.innerHTML = state.segments.map(seg => `
        <div class="item-row">
            <div class="item-number">${seg.id}</div>
            <div class="item-label">Section ${seg.id}<span>Fence section</span></div>
            <div class="item-value">${Math.round(seg.lengthFt)} ft</div>
            <button class="item-delete" onclick="removeSegment(${seg.id})" aria-label="Remove">&times;</button>
        </div>`).join('');
}

// ──────────────────────────────────────────
// RENDER — GATES LIST
// ──────────────────────────────────────────
function renderGatesList() {
    const el = document.getElementById('gates-list');
    if (!state.gates.length) { el.innerHTML = ''; return; }
    const pricing = readPricingFromUI();
    el.innerHTML = state.gates.map((gate, i) => {
        const label = gate.type === 'single' ? 'Single Gate (~4 ft)' : 'Double Gate (~10 ft)';
        const price = gate.type === 'single' ? pricing.singleGate : pricing.doubleGate;
        return `
        <div class="item-row">
            <div class="item-number gate-number">G${i+1}</div>
            <div class="item-label">${label}<span>Gate</span></div>
            <div class="item-value">${formatCurrency(price)}</div>
            <button class="item-delete" onclick="removeGate(${gate.id})" aria-label="Remove">&times;</button>
        </div>`;
    }).join('');
}

// ──────────────────────────────────────────
// RENDER — TOTALS
// ──────────────────────────────────────────
function renderTotals() {
    const pricing     = readPricingFromUI();
    const totalFt     = getTotalFeet();
    const fenceAmt    = totalFt * pricing.perFoot;
    const singleCount = state.gates.filter(g => g.type === 'single').length;
    const doubleCount = state.gates.filter(g => g.type === 'double').length;
    const gateAmt     = singleCount * pricing.singleGate + doubleCount * pricing.doubleGate;
    const subtotal    = fenceAmt + gateAmt;
    const taxAmt      = subtotal * (pricing.taxRate / 100);
    const total       = subtotal + taxAmt;

    document.getElementById('total-feet').textContent  = Math.round(totalFt).toLocaleString() + ' ft';
    document.getElementById('fence-cost').textContent  = formatCurrency(fenceAmt);
    document.getElementById('subtotal').textContent    = formatCurrency(subtotal);
    document.getElementById('grand-total').textContent = formatCurrency(total);

    const gateRow = document.getElementById('gate-cost-row');
    gateRow.style.display = gateAmt > 0 ? '' : 'none';
    if (gateAmt > 0) document.getElementById('gate-cost').textContent = formatCurrency(gateAmt);

    document.getElementById('tax-rate-label').textContent = pricing.taxRate;
    const taxRow = document.getElementById('tax-row');
    taxRow.style.display = pricing.taxRate > 0 ? '' : 'none';
    if (pricing.taxRate > 0) document.getElementById('tax-amount').textContent = formatCurrency(taxAmt);

    document.getElementById('btn-print').disabled = (state.segments.length === 0);
}

// ──────────────────────────────────────────
// PRICING
// ──────────────────────────────────────────
function readPricingFromUI() {
    return {
        fenceType:  document.getElementById('fence-type').value,
        perFoot:    parseFloat(document.getElementById('price-per-foot').value)    || 0,
        singleGate: parseFloat(document.getElementById('price-single-gate').value) || 0,
        doubleGate: parseFloat(document.getElementById('price-double-gate').value) || 0,
        taxRate:    parseFloat(document.getElementById('tax-rate').value)           || 0,
    };
}

function onFenceTypeChange() {
    const type  = document.getElementById('fence-type').value;
    const price = FENCE_PRESETS[type];
    if (type !== 'custom' && price != null && FENCE_CONFIG.allowPriceEdit) {
        document.getElementById('price-per-foot').value = price;
    }
    onPricingChange();
}

function onPricingChange() {
    renderGatesList();
    renderTotals();
    saveLocalSettings();
}

// ──────────────────────────────────────────
// ADDRESS AUTOCOMPLETE
// ──────────────────────────────────────────
function setupAutocomplete() {
    const input = document.getElementById('address-input');
    state.autocomplete = new google.maps.places.Autocomplete(input, {
        types:  ['address'],
        fields: ['geometry', 'formatted_address'],
    });
    state.autocomplete.addListener('place_changed', () => {
        const place = state.autocomplete.getPlace();
        if (!place.geometry?.location) return;
        state.currentAddress = place.formatted_address || input.value;
        state.map.setCenter(place.geometry.location);
        state.map.setZoom(19);
    });
}

function locateUser() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(pos => {
        const latlng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        state.map.setCenter(latlng);
        state.map.setZoom(19);
        new google.maps.Geocoder().geocode({ location: latlng }, (results, status) => {
            if (status === 'OK' && results[0]) {
                document.getElementById('address-input').value = results[0].formatted_address;
                state.currentAddress = results[0].formatted_address;
            }
        });
    }, () => alert('Unable to retrieve your location.'));
}

// ──────────────────────────────────────────
// PRINT
// ──────────────────────────────────────────
function printEstimate() {
    if (!state.segments.length) return;

    const pricing     = readPricingFromUI();
    const totalFt     = getTotalFeet();
    const fenceAmt    = totalFt * pricing.perFoot;
    const singleCount = state.gates.filter(g => g.type === 'single').length;
    const doubleCount = state.gates.filter(g => g.type === 'double').length;
    const gateAmt     = singleCount * pricing.singleGate + doubleCount * pricing.doubleGate;
    const subtotal    = fenceAmt + gateAmt;
    const taxAmt      = subtotal * (pricing.taxRate / 100);
    const total       = subtotal + taxAmt;

    const company = document.getElementById('company-name').value.trim() || FENCE_CONFIG.companyName || 'Your Company';
    document.getElementById('pt-company-name').textContent = company;
    document.getElementById('pt-date').textContent = new Date().toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
    });
    document.getElementById('pt-address').textContent =
        state.currentAddress || document.getElementById('address-input').value || '—';
    document.getElementById('pt-valid-days').textContent =
        `${FENCE_CONFIG.estimateValidDays || 30} days from date above`;

    const contactLines = [];
    if (FENCE_CONFIG.phone)         contactLines.push(FENCE_CONFIG.phone);
    if (FENCE_CONFIG.email)         contactLines.push(FENCE_CONFIG.email);
    if (FENCE_CONFIG.website)       contactLines.push(FENCE_CONFIG.website);
    if (FENCE_CONFIG.licenseNumber) contactLines.push('License: ' + FENCE_CONFIG.licenseNumber);
    document.getElementById('pt-contact-block').innerHTML =
        contactLines.map(l => `<span>${l}</span>`).join('');

    const fenceTypeLabel = document.getElementById('fence-type').selectedOptions[0]?.text || 'Fence';
    const rows = state.segments.map((seg, i) => `
        <tr>
            <td>${fenceTypeLabel} — Section ${i+1}</td>
            <td>${Math.round(seg.lengthFt)} lin. ft</td>
            <td>${formatCurrency(pricing.perFoot)} / ft</td>
            <td>${formatCurrency(seg.lengthFt * pricing.perFoot)}</td>
        </tr>`);

    if (singleCount > 0) rows.push(`
        <tr>
            <td>Single Gate (installed, ~4 ft wide)</td>
            <td>${singleCount} gate${singleCount > 1 ? 's' : ''}</td>
            <td>${formatCurrency(pricing.singleGate)} ea.</td>
            <td>${formatCurrency(singleCount * pricing.singleGate)}</td>
        </tr>`);

    if (doubleCount > 0) rows.push(`
        <tr>
            <td>Double Gate (installed, ~10 ft wide)</td>
            <td>${doubleCount} gate${doubleCount > 1 ? 's' : ''}</td>
            <td>${formatCurrency(pricing.doubleGate)} ea.</td>
            <td>${formatCurrency(doubleCount * pricing.doubleGate)}</td>
        </tr>`);

    document.getElementById('pt-items-body').innerHTML = rows.join('');
    document.getElementById('pt-subtotal').textContent = formatCurrency(subtotal);
    document.getElementById('pt-total').textContent    = formatCurrency(total);

    const taxRow = document.getElementById('pt-tax-row');
    if (pricing.taxRate > 0) {
        taxRow.classList.add('visible');
        document.getElementById('pt-tax-label').textContent = `Tax (${pricing.taxRate}%)`;
        document.getElementById('pt-tax').textContent = formatCurrency(taxAmt);
    } else {
        taxRow.classList.remove('visible');
    }

    const notesVal = document.getElementById('notes-input').value.trim();
    document.getElementById('pt-notes-text').textContent = notesVal;
    document.getElementById('pt-notes-section').classList.toggle('hidden', !notesVal);

    window.print();
}

// ──────────────────────────────────────────
// LOCAL SETTINGS
// ──────────────────────────────────────────
function saveLocalSettings() {
    try {
        localStorage.setItem('fenceEstimatePro', JSON.stringify({
            fenceType:   document.getElementById('fence-type').value,
            perFoot:     document.getElementById('price-per-foot').value,
            singleGate:  document.getElementById('price-single-gate').value,
            doubleGate:  document.getElementById('price-double-gate').value,
            taxRate:     document.getElementById('tax-rate').value,
            companyName: document.getElementById('company-name').value,
            notes:       document.getElementById('notes-input').value,
        }));
    } catch (_) {}
}

function loadLocalSettings() {
    try {
        const raw = localStorage.getItem('fenceEstimatePro');
        if (!raw) return;
        const d = JSON.parse(raw);
        if (FENCE_CONFIG.allowPriceEdit) {
            const s = (id, v) => { if (v != null && v !== '') document.getElementById(id).value = v; };
            s('fence-type',        d.fenceType);
            s('price-per-foot',    d.perFoot);
            s('price-single-gate', d.singleGate);
            s('price-double-gate', d.doubleGate);
            s('tax-rate',          d.taxRate);
        }
        if (d.companyName) document.getElementById('company-name').value = d.companyName;
        if (d.notes)       document.getElementById('notes-input').value  = d.notes;
    } catch (_) {}
}

// ──────────────────────────────────────────
// UI LISTENERS
// ──────────────────────────────────────────
function setupUIListeners() {
    document.getElementById('btn-draw').addEventListener('click',  () => setMode('draw'));
    document.getElementById('btn-gate').addEventListener('click',  () => setMode('gate'));
    document.getElementById('btn-undo').addEventListener('click',  undo);
    document.getElementById('btn-clear').addEventListener('click', clearAll);
    document.getElementById('btn-print').addEventListener('click', printEstimate);
    document.getElementById('btn-locate').addEventListener('click', locateUser);

    document.getElementById('btn-undo-point').addEventListener('click', undoLastPoint);
    document.getElementById('btn-finish-section').addEventListener('click', finishSection);
    document.getElementById('btn-cancel-drawing').addEventListener('click', () => setMode(null));

    document.getElementById('btn-map-type').addEventListener('click', () => {
        state.mapTypeRoad = !state.mapTypeRoad;
        state.map.setMapTypeId(state.mapTypeRoad ? 'roadmap' : 'hybrid');
        const btn = document.getElementById('btn-map-type');
        btn.textContent = state.mapTypeRoad ? 'Satellite' : 'Map';
        btn.classList.toggle('active', state.mapTypeRoad);
    });

    document.getElementById('sidebar-toggle').addEventListener('click', () => {
        const sidebar   = document.getElementById('sidebar');
        const collapsed = sidebar.classList.toggle('collapsed');
        document.getElementById('sidebar-toggle').innerHTML = collapsed ? '&#8250;' : '&#8249;';
    });

    document.getElementById('fence-type').addEventListener('change', onFenceTypeChange);
    ['price-per-foot','price-single-gate','price-double-gate','tax-rate'].forEach(id => {
        document.getElementById(id).addEventListener('input', onPricingChange);
    });

    document.getElementById('company-name').addEventListener('input', saveLocalSettings);
    document.getElementById('notes-input').addEventListener('input', saveLocalSettings);
    document.getElementById('address-input').addEventListener('change', () => {
        state.currentAddress = document.getElementById('address-input').value;
    });

    // Gate modal
    document.querySelectorAll('.gate-option').forEach(btn => {
        btn.addEventListener('click', () => {
            document.getElementById('gate-modal').classList.add('hidden');
            if (state.pendingGateLatLng) {
                placeGate(state.pendingGateLatLng, btn.dataset.type);
                state.pendingGateLatLng = null;
            }
            // Stay in gate mode
            if (state.mode === 'gate') enableGateMode();
        });
    });

    document.getElementById('modal-cancel').addEventListener('click', () => {
        document.getElementById('gate-modal').classList.add('hidden');
        state.pendingGateLatLng = null;
    });

    document.getElementById('gate-modal').addEventListener('click', e => {
        if (e.target === e.currentTarget) {
            document.getElementById('gate-modal').classList.add('hidden');
            state.pendingGateLatLng = null;
        }
    });

    document.addEventListener('keydown', e => {
        if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); return; }
        if (e.key === 'Escape')  { setMode(null); document.getElementById('gate-modal').classList.add('hidden'); }
        if (e.key === 'Enter')   finishSection();
        if (e.key === 'd' || e.key === 'D') setMode('draw');
        if (e.key === 'g' || e.key === 'G') setMode('gate');
    });
}

function expandSidebar() {
    document.getElementById('sidebar').classList.remove('collapsed');
    document.getElementById('sidebar-toggle').innerHTML = '&#8249;';
}

function formatCurrency(n) {
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
