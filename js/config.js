/**
 * FenceEstimate Pro — Company Configuration
 *
 * HOW TO USE:
 *   Option A (single deployment): Edit the DEFAULTS object below,
 *     then host this folder. Every visitor gets these settings.
 *
 *   Option B (multi-company / iframe embed): Leave DEFAULTS as-is.
 *     Pass URL parameters to customise each client embed:
 *       index.html?company=Valley+Fence+Co&color=1a56db&perFoot=50
 *     Use admin.html to generate embed codes automatically.
 *
 * URL PARAMETER REFERENCE:
 *   apiKey        — Google Maps API key (only needed if not set in DEFAULTS)
 *   company       — Company name
 *   color         — Primary/brand color as hex WITHOUT # (e.g. 16a34a)
 *   phone         — Contact phone number
 *   email         — Contact email address
 *   website       — Company website URL
 *   license       — Contractor license number
 *   fenceType     — Default fence type: wood|vinyl|chain-link|aluminum|split-rail|custom
 *   perFoot       — Default price per linear foot
 *   singleGate    — Default single gate installed price
 *   doubleGate    — Default double gate installed price
 *   taxRate       — Default tax rate percentage (e.g. 8.5)
 *   allowEdit     — Whether clients can edit prices: true|false
 *   validDays     — Estimate valid for N days (shown on printout)
 *   notes         — Default notes printed on every estimate
 */

const FENCE_CONFIG = (function () {

    /* ── Edit these values for a single-company deployment ── */
    const DEFAULTS = {
        googleMapsApiKey:  'YOUR_GOOGLE_MAPS_API_KEY',
        companyName:       '',
        primaryColor:      '#16a34a',
        phone:             '',
        email:             '',
        website:           '',
        licenseNumber:     '',
        fenceType:         'wood',
        pricePerFoot:      45,
        singleGate:        350,
        doubleGate:        650,
        taxRate:           0,
        allowPriceEdit:    true,
        defaultNotes:      '',
        estimateValidDays: 30,
    };

    /* ── URL parameter → config key mapping ── */
    const PARAM_MAP = {
        apiKey:     'googleMapsApiKey',
        company:    'companyName',
        color:      'primaryColor',
        phone:      'phone',
        email:      'email',
        website:    'website',
        license:    'licenseNumber',
        fenceType:  'fenceType',
        perFoot:    'pricePerFoot',
        singleGate: 'singleGate',
        doubleGate: 'doubleGate',
        taxRate:    'taxRate',
        allowEdit:  'allowPriceEdit',
        validDays:  'estimateValidDays',
        notes:      'defaultNotes',
    };

    const NUMERIC = new Set(['pricePerFoot', 'singleGate', 'doubleGate', 'taxRate', 'estimateValidDays']);

    const params   = new URLSearchParams(window.location.search);
    const override = {};

    Object.entries(PARAM_MAP).forEach(([param, key]) => {
        if (!params.has(param)) return;
        let val = params.get(param);
        if (NUMERIC.has(key))          { val = parseFloat(val) || 0; }
        else if (key === 'allowPriceEdit') { val = val !== 'false' && val !== '0'; }
        else if (key === 'primaryColor')   { if (val && !val.startsWith('#')) val = '#' + val; }
        override[key] = val;
    });

    return Object.assign({}, DEFAULTS, override);
})();
