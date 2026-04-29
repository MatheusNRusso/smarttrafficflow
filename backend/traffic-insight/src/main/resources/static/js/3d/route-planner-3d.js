/**
 * Formats a Nominatim result into a concise readable address.
 *
 * Strategy:
 *  1. Use structured address fields if available (road + neighbourhood)
 *  2. Fall back to filtering display_name tokens — removes Brazilian
 *     administrative region strings ("Região Geográfica", "Metropolitana", etc.)
 *     and keeps only the first meaningful 1-2 tokens.
 */
function _formatAddress(item) {
    const a = item.address || {};

    // Administrative noise patterns to discard
    const NOISE = [
        /região/i, /metropolitana/i, /imediata/i, /intermediária/i,
        /geográfica/i, /brasil/i, /brazil/i, /estado do/i,
        /^rio de janeiro$/i
    ];

    const isNoise = str => NOISE.some(re => re.test(str.trim()));

    // 1. Try structured fields first
    const street    = a.road || a.pedestrian || a.path || a.footway || '';
    const number    = a.house_number || '';
    const hood      = a.neighbourhood || a.suburb || a.quarter || '';
    const district  = a.city_district || a.town || a.village || '';

    if (street) {
        const parts = [number ? `${street}, ${number}` : street];
        const area  = hood || district;
        if (area && area !== street) parts.push(area);
        return parts.join(' — ');
    }

    // 2. Filter display_name tokens
    const tokens = item.display_name
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0 && !isNoise(t));

    // Keep at most 2 meaningful tokens
    return tokens.slice(0, 2).join(', ') || item.display_name.split(',')[0].trim();
}

/**
 * RoutePlanner3D
 * ==============
 * Handles point A → point B route planning on the 3D MapLibre/Deck.gl map.
 *
 * Flow:
 *   1. User clicks "Find Route" button → selection mode activates
 *   2. First map click  → Point A marker (green)
 *   3. Second map click → Point B marker (red) + API call
 *   4. Results rendered: dashed A→B line + route cards panel
 *   5. User clicks a card → that line animates
 */

export class RoutePlanner3D {

    constructor(map, overlay, options = {}) {
        this.map     = map;
        this.overlay = overlay;

        // Callbacks into main.js
        this.onRouteSelected = options.onRouteSelected || null; // (routeOption) => void
        this.onClear         = options.onClear         || null; // () => void

        this.isSelecting  = false;
        this.pointA       = null; // { lat, lng }
        this.pointB       = null;
        this.results      = [];   // RouteOptionDto[]
        this.currentHour  = options.getCurrentHour ? options.getCurrentHour() : 8;

        this._mapClickHandler = this._onMapClick.bind(this);
        this._buildPanel();
    }

    // ─── Public API ──────────────────────────────────────────────────────────

    /** Activates point selection mode */
    activate() {
        this.isSelecting = true;
        this.pointA      = null;
        this.pointB      = null;
        this.results     = [];
        // Remove before adding to prevent duplicate listeners on re-activation
        this.map.off('click', this._mapClickHandler);
        // Clear previous markers and AB line when starting a new search
        this._clearMarkers();
        this._hideStatus();
        this._updatePanel([]);
        // Clear text inputs for fresh search
        const inA = document.getElementById('rpInputA');
        const inB = document.getElementById('rpInputB');
        const clA = document.getElementById('rpClearA');
        const clB = document.getElementById('rpClearB');
        if (inA) { inA.value = ''; }
        if (inB) { inB.value = ''; }
        if (clA) clA.style.display = 'none';
        if (clB) clB.style.display = 'none';
        this._setCursor('crosshair');
        this.map.on('click', this._mapClickHandler);
        // Show panel with inputs immediately — user can type or click on map
        this._showPanel();
        this._showStatus('Type an address or click on the map to set point A');
    }

    /** Deactivates and clears everything */
    deactivate() {
        this.isSelecting = false;
        this.map.off('click', this._mapClickHandler);
        this._setCursor('');
        this._clearMarkers();
        this._updatePanel([]);
        this._hidePanel();
        if (this.onClear) this.onClear();
    }

    /** Updates the hour used for traffic level lookup */
    setHour(hour) { this.currentHour = hour; }

    // ─── Map click handler ───────────────────────────────────────────────────

    _onMapClick(e) {
        const { lng, lat } = e.lngLat;

        if (!this.pointA) {
            this.pointA = { lat, lng };
            this._placeMarker('A', lat, lng);
            this._showStatus('Click on the map to set destination point (B)');
            return;
        }

        if (!this.pointB) {
            this.pointB = { lat, lng };
            this._placeMarker('B', lat, lng);
            this.map.off('click', this._mapClickHandler);
            this._setCursor('');
            this._showStatus('Searching for routes...');
            this._fetchRoutes();
        }
    }

    // ─── API call ────────────────────────────────────────────────────────────

    async _fetchRoutes() {
        const { lat: latA, lng: lngA } = this.pointA;
        const { lat: latB, lng: lngB } = this.pointB;

        try {
            const url = `/api/traffic/routes/between`
                + `?latA=${latA}&lngA=${lngA}`
                + `&latB=${latB}&lngB=${lngB}`
                + `&radius=600&hour=${this.currentHour}`;

            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            this.results = await res.json();

            if (this.results.length === 0) {
                this._showStatus('No routes found. Try increasing the search area.');
                // Reset so user can try again without reloading
                setTimeout(() => {
                    this._clearMarkers();
                    this._hideStatus();
                    this.pointA = null;
                    this.pointB = null;
                    this.map.on('click', this._mapClickHandler);
                    this._setCursor('crosshair');
                    this._showStatus('Click on the map to set departure point (A)');
                }, 3000);
                return;
            }

            this._renderABLine();
            this._updatePanel(this.results);
            this._showPanel();
            this._hideStatus();

        } catch (err) {
            console.error('Route finder error:', err);
            this._showStatus('Error fetching routes. Please try again.');
        }
    }

    // ─── A→B dashed line via Deck.gl LineLayer ───────────────────────────────

    _renderABLine() {
        if (!this.pointA || !this.pointB || !this.overlay) return;

        const { LineLayer } = deck;

        // Render two layers:
        // 1. A thick white outline for visibility against any background
        // 2. A colored dashed line on top (green at A, fading to red at B)
        const outlineLayer = new LineLayer({
            id:   'route-planner-ab-outline',
            data: [{
                sourcePosition: [this.pointA.lng, this.pointA.lat, 100],
                targetPosition: [this.pointB.lng, this.pointB.lat, 100]
            }],
            getSourcePosition: d => d.sourcePosition,
            getTargetPosition: d => d.targetPosition,
            getColor:     [255, 255, 255, 120],
            getWidth:     8,
            pickable:     false
        });

        const abLayer = new LineLayer({
            id:   'route-planner-ab-line',
            data: [{
                sourcePosition: [this.pointA.lng, this.pointA.lat, 100],
                targetPosition: [this.pointB.lng, this.pointB.lat, 100],
                sourceColor:    [39, 174, 96, 220],   // green — departure
                targetColor:    [231, 76, 60, 220]    // red   — destination
            }],
            getSourcePosition: d => d.sourcePosition,
            getTargetPosition: d => d.targetPosition,
            getSourceColor:    d => d.sourceColor,
            getTargetColor:    d => d.targetColor,
            getWidth:          4,
            pickable:          false
        });

        // Merge with existing layers — remove old AB layers first
        const existingLayers = (this.overlay.props && this.overlay.props.layers) ? this.overlay.props.layers : [];
        const filtered = existingLayers.filter(l =>
            l?.id !== 'route-planner-ab-line' && l?.id !== 'route-planner-ab-outline'
        );
        this.overlay.setProps({ layers: [...filtered, outlineLayer, abLayer] });
    }

    _clearABLine() {
        if (!this.overlay) return;
        const existingLayers = (this.overlay.props && this.overlay.props.layers) ? this.overlay.props.layers : [];
        this.overlay.setProps({
            layers: existingLayers.filter(l =>
                l?.id !== 'route-planner-ab-line' && l?.id !== 'route-planner-ab-outline'
            )
        });
    }

    // ─── Markers ─────────────────────────────────────────────────────────────

    _placeMarker(label, lat, lng) {
        const color = label === 'A' ? '#27ae60' : '#e74c3c';
        const el    = document.createElement('div');
        el.style.cssText = `
            width: 32px; height: 32px;
            background: ${color};
            border: 3px solid #ffffff;
            border-radius: 50% 50% 50% 0;
            transform: rotate(-45deg);
            box-shadow: 0 3px 10px rgba(0,0,0,0.4);
            cursor: default;
        `;
        const inner = document.createElement('div');
        inner.style.cssText = `
            width: 100%; height: 100%;
            display: flex; align-items: center; justify-content: center;
            transform: rotate(45deg);
            color: white; font-weight: 800; font-size: 13px;
        `;
        inner.textContent = label;
        el.appendChild(inner);

        const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
            .setLngLat([lng, lat])
            .addTo(this.map);

        if (label === 'A') this._markerA = marker;
        else               this._markerB = marker;
    }

    _clearMarker(label) {
        if (label === 'A' && this._markerA) { this._markerA.remove(); this._markerA = null; }
        if (label === 'B' && this._markerB) { this._markerB.remove(); this._markerB = null; }
    }

    _clearMarkers() {
        this._clearMarker('A');
        this._clearMarker('B');
        this._clearABLine();
    }

    // ─── Results panel ───────────────────────────────────────────────────────

    _buildPanel() {
        const existing = document.getElementById('routePlannerPanel');
        if (existing) existing.remove();

        const panel = document.createElement('div');
        panel.id = 'routePlannerPanel';
        panel.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(255,255,255,0.97);
            border-radius: 14px;
            padding: 16px;
            width: 600px;
            max-width: calc(100vw - 40px);
            z-index: 2000;
            box-shadow: 0 8px 30px rgba(0,0,0,0.2);
            display: none;
            border: 1px solid rgba(0,0,0,0.1);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        `;

        panel.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
                <span style="font-weight:700;color:#2c3e50;font-size:15px;">🗺️ Find Route</span>
                <button id="routePlannerClose" style="background:none;border:none;cursor:pointer;font-size:18px;color:#999;padding:0 4px;">✕</button>
            </div>

            <!-- Text inputs -->
            <div style="display:flex;gap:8px;margin-bottom:12px;align-items:flex-end;">
                <div style="flex:1;">
                    <label style="font-size:11px;font-weight:600;color:#27ae60;display:block;margin-bottom:4px;">
                        🟢 DEPARTURE
                    </label>
                    <div style="position:relative;">
                        <input id="rpInputA" type="text" placeholder="Street, neighbourhood..."
                            style="width:100%;padding:8px 32px 8px 10px;border:2px solid #27ae60;
                                   border-radius:8px;font-size:13px;outline:none;box-sizing:border-box;"/>
                        <button id="rpClearA" style="position:absolute;right:6px;top:50%;transform:translateY(-50%);
                            background:none;border:none;cursor:pointer;color:#aaa;font-size:14px;display:none;">✕</button>
                    </div>
                    <div id="rpSuggestA" style="display:none;position:absolute;background:#fff;border:1px solid #ddd;
                        border-radius:6px;z-index:3000;width:260px;box-shadow:0 4px 12px rgba(0,0,0,0.1);
                        max-height:160px;overflow-y:auto;"></div>
                </div>
                <div style="flex:1;">
                    <label style="font-size:11px;font-weight:600;color:#e74c3c;display:block;margin-bottom:4px;">
                        🔴 DESTINATION
                    </label>
                    <div style="position:relative;">
                        <input id="rpInputB" type="text" placeholder="Street, neighbourhood..."
                            style="width:100%;padding:8px 32px 8px 10px;border:2px solid #e74c3c;
                                   border-radius:8px;font-size:13px;outline:none;box-sizing:border-box;"/>
                        <button id="rpClearB" style="position:absolute;right:6px;top:50%;transform:translateY(-50%);
                            background:none;border:none;cursor:pointer;color:#aaa;font-size:14px;display:none;">✕</button>
                    </div>
                    <div id="rpSuggestB" style="display:none;position:absolute;background:#fff;border:1px solid #ddd;
                        border-radius:6px;z-index:3000;width:260px;box-shadow:0 4px 12px rgba(0,0,0,0.1);
                        max-height:160px;overflow-y:auto;"></div>
                </div>
                <button id="rpSearchBtn" style="padding:9px 16px;background:#8e44ad;color:#fff;border:none;
                    border-radius:8px;cursor:pointer;font-weight:700;font-size:13px;white-space:nowrap;
                    flex-shrink:0;transition:background 0.2s;">
                    🔍 Search
                </button>
            </div>

            <p style="font-size:11px;color:#aaa;margin:0 0 12px;text-align:center;">
                or click two points directly on the map
            </p>

            <!-- Results cards -->
            <div id="routePlannerCards" style="display:flex;gap:10px;overflow-x:auto;padding-bottom:4px;min-height:0;"></div>
        `;

        document.body.appendChild(panel);

        // Close button
        document.getElementById('routePlannerClose')
            .addEventListener('click', () => this.deactivate());

        // Search button
        document.getElementById('rpSearchBtn')
            .addEventListener('click', () => this._searchByText());

        // Input A — autocomplete + clear
        this._setupInput('A',
            document.getElementById('rpInputA'),
            document.getElementById('rpClearA'),
            document.getElementById('rpSuggestA')
        );

        // Input B — autocomplete + clear
        this._setupInput('B',
            document.getElementById('rpInputB'),
            document.getElementById('rpClearB'),
            document.getElementById('rpSuggestB')
        );

        // Enter key triggers search
        ['rpInputA', 'rpInputB'].forEach(id => {
            document.getElementById(id)?.addEventListener('keydown', e => {
                if (e.key === 'Enter') this._searchByText();
            });
        });
    }

    // ─── Text input setup (autocomplete + clear) ──────────────────────────────

    _setupInput(label, input, clearBtn, suggestBox) {
        if (!input) return;

        let debounceTimer = null;

        input.addEventListener('input', () => {
            const val = input.value.trim();
            clearBtn.style.display = val ? 'block' : 'none';

            clearTimeout(debounceTimer);
            if (val.length < 3) { suggestBox.style.display = 'none'; return; }

            debounceTimer = setTimeout(() => this._fetchSuggestions(val, suggestBox, input, label), 350);
        });

        clearBtn.addEventListener('click', () => {
            input.value            = '';
            clearBtn.style.display = 'none';
            suggestBox.style.display = 'none';
            if (label === 'A') { this._clearMarker('A'); this.pointA = null; }
            else               { this._clearMarker('B'); this.pointB = null; }
            this._clearABLine();
        });

        // Close suggestions when clicking outside
        document.addEventListener('click', e => {
            if (!input.contains(e.target) && !suggestBox.contains(e.target)) {
                suggestBox.style.display = 'none';
            }
        });
    }

    async _fetchSuggestions(query, suggestBox, input, label) {
        try {
            const url = `https://nominatim.openstreetmap.org/search`
                + `?q=${encodeURIComponent(query + ', Rio de Janeiro, Brazil')}`
                + `&format=json&limit=5&addressdetails=1`
                + `&viewbox=-43.8,-23.1,-43.0,-22.7&bounded=1`;

            const res  = await fetch(url, {
                headers: { 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8' }
            });
            const data = await res.json();

            if (!data.length) { suggestBox.style.display = 'none'; return; }

            suggestBox.innerHTML = data.map((item, i) => {
                const name = _formatAddress(item);
                return `<div data-index="${i}" style="
                    padding:8px 12px;cursor:pointer;font-size:12px;color:#333;
                    border-bottom:1px solid #f0f0f0;line-height:1.4;
                ">${name}</div>`;
            }).join('');

            suggestBox.style.display = 'block';

            suggestBox.querySelectorAll('div').forEach((el, i) => {
                el.addEventListener('mouseenter', () => el.style.background = '#f5f5f5');
                el.addEventListener('mouseleave', () => el.style.background = '#fff');
                el.addEventListener('click', () => {
                    const item = data[i];
                    input.value = _formatAddress(item);
                    suggestBox.style.display = 'none';

                    const lat = parseFloat(item.lat);
                    const lng = parseFloat(item.lon);

                    if (label === 'A') {
                        this.pointA = { lat, lng };
                        this._clearMarker('A');
                        this._placeMarker('A', lat, lng);
                    } else {
                        this.pointB = { lat, lng };
                        this._clearMarker('B');
                        this._placeMarker('B', lat, lng);
                    }

                    // If both points set, search automatically
                    if (this.pointA && this.pointB) this._fetchRoutes();
                });
            });
        } catch (err) {
            console.error('Nominatim error:', err);
            suggestBox.style.display = 'none';
        }
    }

    async _searchByText() {
        const inputA = document.getElementById('rpInputA')?.value.trim();
        const inputB = document.getElementById('rpInputB')?.value.trim();

        if (!inputA && !inputB) {
            this._showStatus('Enter departure and destination to search.');
            setTimeout(() => this._hideStatus(), 3000);
            return;
        }

        // Geocode any missing points
        if (inputA && !this.pointA) {
            const pt = await this._geocode(inputA);
            if (!pt) { this._showStatus('Departure not found. Try a different address.'); setTimeout(() => this._hideStatus(), 3000); return; }
            this.pointA = pt;
            this._clearMarker('A');
            this._placeMarker('A', pt.lat, pt.lng);
        }

        if (inputB && !this.pointB) {
            const pt = await this._geocode(inputB);
            if (!pt) { this._showStatus('Destination not found. Try a different address.'); setTimeout(() => this._hideStatus(), 3000); return; }
            this.pointB = pt;
            this._clearMarker('B');
            this._placeMarker('B', pt.lat, pt.lng);
        }

        if (this.pointA && this.pointB) this._fetchRoutes();
    }

    async _geocode(query) {
        try {
            const url = `https://nominatim.openstreetmap.org/search`
                + `?q=${encodeURIComponent(query + ', Rio de Janeiro, Brazil')}`
                + `&format=json&limit=1`
                + `&viewbox=-43.8,-23.1,-43.0,-22.7&bounded=1`;
            const res  = await fetch(url, {
                headers: { 'Accept-Language': 'pt-BR,pt;q=0.9' }
            });
            const data = await res.json();
            if (!data.length) return null;
            return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
        } catch { return null; }
    }

    _updatePanel(routes) {
        const container = document.getElementById('routePlannerCards');
        if (!container) return;

        if (routes.length === 0) {
            container.innerHTML = '<p style="color:#aaa;font-size:13px;padding:8px 0;">No routes found.</p>';
            return;
        }

        const levelColors = {
            low: '#2ecc71', medium: '#f1c40f',
            high: '#e67e22', congested: '#e74c3c', unknown: '#95a5a6'
        };
        const levelLabels = {
            low: 'Low', medium: 'Medium',
            high: 'High', congested: 'Congested', unknown: 'Unknown'
        };

        container.innerHTML = routes.map((r, i) => {
            const color      = levelColors[r.trafficLevel] || '#95a5a6';
            const levelLabel = levelLabels[r.trafficLevel] || r.trafficLevel;
            const totalWalk  = r.distanceToA + r.distanceToB;
            const isBest     = i === 0;

            return `
            <div class="route-card" data-index="${i}" style="
                min-width: 160px;
                background: ${isBest ? '#f0faf4' : '#f8f9fa'};
                border: 2px solid;
                border-color: ${isBest ? '#27ae60' : '#e0e0e0'};
                border-radius: 10px;
                padding: 12px;
                cursor: pointer;
                flex-shrink: 0;
                transition: transform 0.15s, box-shadow 0.15s;
                position: relative;
            ">
                ${isBest ? '<span style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:#27ae60;color:white;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;">BEST</span>' : ''}
                <div style="font-size:18px;font-weight:800;color:#2c3e50;text-align:center;margin-bottom:6px;">
                    ${r.lineId.toUpperCase()}
                </div>
                <div style="display:flex;align-items:center;gap:5px;margin-bottom:5px;justify-content:center;">
                    <span style="width:9px;height:9px;border-radius:50%;background:${color};display:inline-block;flex-shrink:0;"></span>
                    <span style="font-size:11px;color:${color};font-weight:600;">${levelLabel}</span>
                </div>
                <div style="font-size:11px;color:#777;text-align:center;margin-bottom:3px;">
                    🚶 ${totalWalk}m walk
                </div>
                <div style="font-size:10px;color:#aaa;text-align:center;">
                    ${r.stopsBetween} stops
                </div>
                <div style="font-size:10px;color:#888;margin-top:6px;border-top:1px solid #eee;padding-top:5px;">
                    🟢 ${r.boardingStop.length > 20 ? r.boardingStop.slice(0,20)+'…' : r.boardingStop}
                </div>
                <div style="font-size:10px;color:#888;margin-top:2px;">
                    🔴 ${r.alightingStop.length > 20 ? r.alightingStop.slice(0,20)+'…' : r.alightingStop}
                </div>
            </div>`;
        }).join('');

        // Hover effect + click handler
        container.querySelectorAll('.route-card').forEach(card => {
            card.addEventListener('mouseenter', () => {
                card.style.transform  = 'translateY(-3px)';
                card.style.boxShadow  = '0 6px 20px rgba(0,0,0,0.15)';
            });
            card.addEventListener('mouseleave', () => {
                card.style.transform  = '';
                card.style.boxShadow  = '';
            });
            card.addEventListener('click', () => {
                const idx   = parseInt(card.dataset.index);
                const route = this.results[idx];
                if (route && this.onRouteSelected) {
                    this.onRouteSelected(route);
                    // Keep markers A/B and the dashed line visible —
                    // they show the user where the selected route runs between.
                    // Only close the panel and reset internal flags so a new
                    // search can be triggered without reloading.
                    this._hidePanel();
                    this._hideStatus();
                    this.results     = [];
                    this.isSelecting = false;
                    this.map.off('click', this._mapClickHandler);
                    this._setCursor('');
                    if (this.onClear) this.onClear();
                }
            });
        });
    }

    _showPanel()  { const p = document.getElementById('routePlannerPanel'); if (p) p.style.display = 'block'; }
    _hidePanel()  { const p = document.getElementById('routePlannerPanel'); if (p) p.style.display = 'none';  }

    // ─── Status message ──────────────────────────────────────────────────────

    _showStatus(msg) {
        let el = document.getElementById('routePlannerStatus');
        if (!el) {
            el = document.createElement('div');
            el.id = 'routePlannerStatus';
            el.style.cssText = `
                position: fixed;
                top: 24px; left: 50%;
                transform: translateX(-50%);
                background: rgba(30,30,30,0.9);
                color: #fff;
                padding: 8px 20px;
                border-radius: 20px;
                font-size: 13px;
                font-weight: 600;
                pointer-events: none;
                z-index: 9999;
                white-space: nowrap;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            `;
            document.body.appendChild(el);
        }
        el.textContent = msg;
        el.style.display = 'block';
    }

    _hideStatus() {
        const el = document.getElementById('routePlannerStatus');
        if (el) el.style.display = 'none';
    }

    // ─── Cursor ──────────────────────────────────────────────────────────────
    _setCursor(cursor) {
        const canvas = this.map.getCanvas();
        if (canvas) canvas.style.cursor = cursor;
    }
}