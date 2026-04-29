/**
 * RoutePlanner2D
 * ==============
 * Handles point A → point B route planning on the 2D Leaflet map.
 * Mirrors RoutePlanner3D behaviour — text input with Nominatim autocomplete
 * + map click fallback.
 */

/**
 * Formats a Nominatim result into a concise readable address.
 */
function formatAddress(item) {
    const a = item.address || {};

    const NOISE = [
        /região/i, /metropolitana/i, /imediata/i, /intermediária/i,
        /geográfica/i, /brasil/i, /brazil/i, /estado do/i,
        /^rio de janeiro$/i
    ];
    const isNoise = str => NOISE.some(re => re.test(str.trim()));

    const street   = a.road || a.pedestrian || a.path || a.footway || '';
    const number   = a.house_number || '';
    const hood     = a.neighbourhood || a.suburb || a.quarter || '';
    const district = a.city_district || a.town || a.village || '';

    if (street) {
        const parts = [number ? `${street}, ${number}` : street];
        const area  = hood || district;
        if (area && area !== street) parts.push(area);
        return parts.join(' — ');
    }

    const tokens = item.display_name
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0 && !isNoise(t));

    return tokens.slice(0, 2).join(', ') || item.display_name.split(',')[0].trim();
}

export class RoutePlanner2D {

    constructor(map, options = {}) {
        this.map             = map;
        this.onRouteSelected = options.onRouteSelected || null;
        this.onClear         = options.onClear         || null;
        this.getCurrentHour  = options.getCurrentHour  || (() => 8);

        this.isSelecting = false;
        this.pointA      = null;
        this.pointB      = null;
        this.results     = [];

        this._markerA        = null;
        this._markerB        = null;
        this._abPolyline     = null;

        this._mapClickHandler = this._onMapClick.bind(this);
        this._buildPanel();
    }

    // ─── Public API ──────────────────────────────────────────────────────────

    activate() {
        this.isSelecting = true;
        this.pointA      = null;
        this.pointB      = null;
        this.results     = [];

        this.map.off('click', this._mapClickHandler);
        this._clearMarkers();
        this._clearABLine();
        this._hideStatus();
        this._updateCards([]);

        // Clear inputs
        ['rpInputA2D','rpInputB2D'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        ['rpClearA2D','rpClearB2D'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });

        this._setCursor('crosshair');
        this.map.on('click', this._mapClickHandler);
        this._showPanel();
        this._showStatus('Type an address or click on the map to set point A');
    }

    deactivate() {
        this.isSelecting = false;
        this.map.off('click', this._mapClickHandler);
        this._setCursor('');
        this._clearMarkers();
        this._clearABLine();
        this._hidePanel();
        this._hideStatus();
        if (this.onClear) this.onClear();
    }

    setHour(hour) { this._hour = hour; }

    // ─── Map click handler ───────────────────────────────────────────────────

    _onMapClick(e) {
        const { lat, lng } = e.latlng;

        if (!this.pointA) {
            this.pointA = { lat, lng };
            this._placeMarker('A', lat, lng);
            this._showStatus('Click on the map to set destination point (B)');

            // Update input A display
            const inA = document.getElementById('rpInputA2D');
            if (inA) { inA.value = `${lat.toFixed(5)}, ${lng.toFixed(5)}`; }
            return;
        }

        if (!this.pointB) {
            this.pointB = { lat, lng };
            this._placeMarker('B', lat, lng);
            this.map.off('click', this._mapClickHandler);
            this._setCursor('');

            const inB = document.getElementById('rpInputB2D');
            if (inB) { inB.value = `${lat.toFixed(5)}, ${lng.toFixed(5)}`; }

            this._showStatus('Searching for routes...');
            this._fetchRoutes();
        }
    }

    // ─── API call ────────────────────────────────────────────────────────────

    async _fetchRoutes() {
        const { lat: latA, lng: lngA } = this.pointA;
        const { lat: latB, lng: lngB } = this.pointB;
        const hour = this.getCurrentHour();

        try {
            const url = `/api/traffic/routes/between`
                + `?latA=${latA}&lngA=${lngA}`
                + `&latB=${latB}&lngB=${lngB}`
                + `&radius=600&hour=${hour}`;

            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            this.results = await res.json();

            if (!this.results.length) {
                this._showStatus('No routes found. Try again with different points.');
                setTimeout(() => {
                    this._clearMarkers();
                    this._clearABLine();
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
            this._updateCards(this.results);
            this._hideStatus();

        } catch (err) {
            console.error('RoutePlanner2D fetch error:', err);
            this._showStatus('Error fetching routes. Please try again.');
        }
    }

    // ─── A→B line (Leaflet polyline with gradient simulation) ────────────────

    _renderABLine() {
        if (!this.pointA || !this.pointB) return;
        this._clearABLine();

        // White outline
        const outline = L.polyline(
            [[this.pointA.lat, this.pointA.lng], [this.pointB.lat, this.pointB.lng]],
            { color: '#ffffff', weight: 8, opacity: 0.6, interactive: false }
        ).addTo(this.map);

        // Green segment (first half — departure side)
        const midLat = (this.pointA.lat + this.pointB.lat) / 2;
        const midLng = (this.pointA.lng + this.pointB.lng) / 2;

        const segA = L.polyline(
            [[this.pointA.lat, this.pointA.lng], [midLat, midLng]],
            { color: '#27ae60', weight: 4, opacity: 0.9, dashArray: '8 5', interactive: false }
        ).addTo(this.map);

        // Red segment (second half — destination side)
        const segB = L.polyline(
            [[midLat, midLng], [this.pointB.lat, this.pointB.lng]],
            { color: '#e74c3c', weight: 4, opacity: 0.9, dashArray: '8 5', interactive: false }
        ).addTo(this.map);

        this._abPolyline = { outline, segA, segB };
    }

    _clearABLine() {
        if (this._abPolyline) {
            const { outline, segA, segB } = this._abPolyline;
            [outline, segA, segB].forEach(l => { if (l && this.map.hasLayer(l)) this.map.removeLayer(l); });
            this._abPolyline = null;
        }
    }

    // ─── Markers ─────────────────────────────────────────────────────────────

    _placeMarker(label, lat, lng) {
        const color = label === 'A' ? '#27ae60' : '#e74c3c';
        const icon  = L.divIcon({
            className: '',
            html: `<div style="
                width:32px;height:32px;
                background:${color};
                border:3px solid #ffffff;
                border-radius:50% 50% 50% 0;
                transform:rotate(-45deg);
                box-shadow:0 3px 10px rgba(0,0,0,0.4);
            "><div style="
                width:100%;height:100%;
                display:flex;align-items:center;justify-content:center;
                transform:rotate(45deg);
                color:#fff;font-weight:800;font-size:13px;
            ">${label}</div></div>`,
            iconSize:   [32, 32],
            iconAnchor: [16, 32]
        });

        const marker = L.marker([lat, lng], { icon, interactive: false, zIndexOffset: 2000 })
            .addTo(this.map);

        if (label === 'A') this._markerA = marker;
        else               this._markerB = marker;
    }

    _clearMarker(label) {
        if (label === 'A' && this._markerA) {
            if (this.map.hasLayer(this._markerA)) this.map.removeLayer(this._markerA);
            this._markerA = null;
        }
        if (label === 'B' && this._markerB) {
            if (this.map.hasLayer(this._markerB)) this.map.removeLayer(this._markerB);
            this._markerB = null;
        }
    }

    _clearMarkers() {
        this._clearMarker('A');
        this._clearMarker('B');
    }

    // ─── Panel ───────────────────────────────────────────────────────────────

    _buildPanel() {
        const existing = document.getElementById('routePlannerPanel2D');
        if (existing) existing.remove();

        const panel = document.createElement('div');
        panel.id = 'routePlannerPanel2D';
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
                <button id="routePlannerClose2D" style="background:none;border:none;cursor:pointer;font-size:18px;color:#999;padding:0 4px;">✕</button>
            </div>

            <div style="display:flex;gap:8px;margin-bottom:12px;align-items:flex-end;">
                <div style="flex:1;">
                    <label style="font-size:11px;font-weight:600;color:#27ae60;display:block;margin-bottom:4px;">🟢 DEPARTURE</label>
                    <div style="position:relative;">
                        <input id="rpInputA2D" type="text" placeholder="Street, neighbourhood..."
                            style="width:100%;padding:8px 32px 8px 10px;border:2px solid #27ae60;
                                   border-radius:8px;font-size:13px;outline:none;box-sizing:border-box;"/>
                        <button id="rpClearA2D" style="position:absolute;right:6px;top:50%;transform:translateY(-50%);
                            background:none;border:none;cursor:pointer;color:#aaa;font-size:14px;display:none;">✕</button>
                    </div>
                    <div id="rpSuggestA2D" style="display:none;position:absolute;background:#fff;border:1px solid #ddd;
                        border-radius:6px;z-index:3000;width:260px;box-shadow:0 4px 12px rgba(0,0,0,0.1);
                        max-height:160px;overflow-y:auto;"></div>
                </div>
                <div style="flex:1;">
                    <label style="font-size:11px;font-weight:600;color:#e74c3c;display:block;margin-bottom:4px;">🔴 DESTINATION</label>
                    <div style="position:relative;">
                        <input id="rpInputB2D" type="text" placeholder="Street, neighbourhood..."
                            style="width:100%;padding:8px 32px 8px 10px;border:2px solid #e74c3c;
                                   border-radius:8px;font-size:13px;outline:none;box-sizing:border-box;"/>
                        <button id="rpClearB2D" style="position:absolute;right:6px;top:50%;transform:translateY(-50%);
                            background:none;border:none;cursor:pointer;color:#aaa;font-size:14px;display:none;">✕</button>
                    </div>
                    <div id="rpSuggestB2D" style="display:none;position:absolute;background:#fff;border:1px solid #ddd;
                        border-radius:6px;z-index:3000;width:260px;box-shadow:0 4px 12px rgba(0,0,0,0.1);
                        max-height:160px;overflow-y:auto;"></div>
                </div>
                <button id="rpSearchBtn2D" style="padding:9px 16px;background:#8e44ad;color:#fff;border:none;
                    border-radius:8px;cursor:pointer;font-weight:700;font-size:13px;white-space:nowrap;flex-shrink:0;">
                    🔍 Search
                </button>
            </div>

            <p style="font-size:11px;color:#aaa;margin:0 0 12px;text-align:center;">
                or click two points directly on the map
            </p>

            <div id="routePlannerCards2D" style="display:flex;gap:10px;overflow-x:auto;padding-bottom:4px;"></div>
        `;

        document.body.appendChild(panel);

        document.getElementById('routePlannerClose2D')
            .addEventListener('click', () => this.deactivate());

        document.getElementById('rpSearchBtn2D')
            .addEventListener('click', () => this._searchByText());

        this._setupInput('A',
            document.getElementById('rpInputA2D'),
            document.getElementById('rpClearA2D'),
            document.getElementById('rpSuggestA2D')
        );
        this._setupInput('B',
            document.getElementById('rpInputB2D'),
            document.getElementById('rpClearB2D'),
            document.getElementById('rpSuggestB2D')
        );

        ['rpInputA2D','rpInputB2D'].forEach(id => {
            document.getElementById(id)?.addEventListener('keydown', e => {
                if (e.key === 'Enter') this._searchByText();
            });
        });
    }

    // ─── Text input + autocomplete ───────────────────────────────────────────

    _setupInput(label, input, clearBtn, suggestBox) {
        if (!input) return;
        let debounce = null;

        input.addEventListener('input', () => {
            const val = input.value.trim();
            clearBtn.style.display = val ? 'block' : 'none';
            clearTimeout(debounce);
            if (val.length < 3) { suggestBox.style.display = 'none'; return; }
            debounce = setTimeout(() => this._fetchSuggestions(val, suggestBox, input, label), 350);
        });

        clearBtn.addEventListener('click', () => {
            input.value              = '';
            clearBtn.style.display   = 'none';
            suggestBox.style.display = 'none';
            if (label === 'A') { this._clearMarker('A'); this.pointA = null; }
            else               { this._clearMarker('B'); this.pointB = null; }
            this._clearABLine();
        });

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

            const res  = await fetch(url, { headers: { 'Accept-Language': 'pt-BR,pt;q=0.9' } });
            const data = await res.json();

            if (!data.length) { suggestBox.style.display = 'none'; return; }

            suggestBox.innerHTML = data.map((item, i) => {
                const name = formatAddress(item);
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
                    input.value              = formatAddress(item);
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

                    if (this.pointA && this.pointB) this._fetchRoutes();
                });
            });
        } catch (err) {
            console.error('Nominatim error:', err);
            suggestBox.style.display = 'none';
        }
    }

    async _searchByText() {
        const valA = document.getElementById('rpInputA2D')?.value.trim();
        const valB = document.getElementById('rpInputB2D')?.value.trim();

        if (!valA && !valB) {
            this._showStatus('Enter departure and destination.');
            setTimeout(() => this._hideStatus(), 3000);
            return;
        }

        if (valA && !this.pointA) {
            const pt = await this._geocode(valA);
            if (!pt) { this._showStatus('Departure not found.'); setTimeout(() => this._hideStatus(), 3000); return; }
            this.pointA = pt;
            this._clearMarker('A');
            this._placeMarker('A', pt.lat, pt.lng);
        }

        if (valB && !this.pointB) {
            const pt = await this._geocode(valB);
            if (!pt) { this._showStatus('Destination not found.'); setTimeout(() => this._hideStatus(), 3000); return; }
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
                + `&format=json&limit=1&addressdetails=1`
                + `&viewbox=-43.8,-23.1,-43.0,-22.7&bounded=1`;
            const res  = await fetch(url, { headers: { 'Accept-Language': 'pt-BR,pt;q=0.9' } });
            const data = await res.json();
            if (!data.length) return null;
            return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
        } catch { return null; }
    }

    // ─── Result cards ─────────────────────────────────────────────────────────

    _updateCards(routes) {
        const container = document.getElementById('routePlannerCards2D');
        if (!container) return;

        if (!routes.length) {
            container.innerHTML = '<p style="color:#aaa;font-size:13px;padding:8px 0;">No routes found.</p>';
            return;
        }

        const levelColors = { low:'#2ecc71', medium:'#f1c40f', high:'#e67e22', congested:'#e74c3c', unknown:'#95a5a6' };
        const levelLabels = { low:'Low', medium:'Medium', high:'High', congested:'Congested', unknown:'Unknown' };

        container.innerHTML = routes.map((r, i) => {
            const color     = levelColors[r.trafficLevel] || '#95a5a6';
            const label     = levelLabels[r.trafficLevel] || r.trafficLevel;
            const totalWalk = r.distanceToA + r.distanceToB;
            const isBest    = i === 0;

            return `
            <div class="route-card-2d" data-index="${i}" style="
                min-width:160px;
                background:${isBest ? '#f0faf4' : '#f8f9fa'};
                border:2px solid;
                border-color:${isBest ? '#27ae60' : '#e0e0e0'};
                border-radius:10px;padding:12px;cursor:pointer;
                flex-shrink:0;transition:transform 0.15s,box-shadow 0.15s;
                position:relative;
            ">
                ${isBest ? '<span style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:#27ae60;color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;">BEST</span>' : ''}
                <div style="font-size:18px;font-weight:800;color:#2c3e50;text-align:center;margin-bottom:6px;">
                    ${r.lineId.toUpperCase()}
                </div>
                <div style="display:flex;align-items:center;gap:5px;justify-content:center;margin-bottom:5px;">
                    <span style="width:9px;height:9px;border-radius:50%;background:${color};display:inline-block;"></span>
                    <span style="font-size:11px;color:${color};font-weight:600;">${label}</span>
                </div>
                <div style="font-size:11px;color:#777;text-align:center;margin-bottom:3px;">🚶 ${totalWalk}m walk</div>
                <div style="font-size:10px;color:#aaa;text-align:center;">${r.stopsBetween} stops</div>
                <div style="font-size:10px;color:#888;margin-top:6px;border-top:1px solid #eee;padding-top:5px;">
                    🟢 ${r.boardingStop.length > 20 ? r.boardingStop.slice(0,20)+'…' : r.boardingStop}
                </div>
                <div style="font-size:10px;color:#888;margin-top:2px;">
                    🔴 ${r.alightingStop.length > 20 ? r.alightingStop.slice(0,20)+'…' : r.alightingStop}
                </div>
            </div>`;
        }).join('');

        container.querySelectorAll('.route-card-2d').forEach(card => {
            card.addEventListener('mouseenter', () => {
                card.style.transform = 'translateY(-3px)';
                card.style.boxShadow = '0 6px 20px rgba(0,0,0,0.15)';
            });
            card.addEventListener('mouseleave', () => {
                card.style.transform = '';
                card.style.boxShadow = '';
            });
            card.addEventListener('click', () => {
                const route = this.results[parseInt(card.dataset.index)];
                if (route && this.onRouteSelected) {
                    this.onRouteSelected(route);
                    this._hidePanel();
                    this._hideStatus();
                    this.results     = [];
                    this.isSelecting = false;
                    this.pointA      = null;
                    this.pointB      = null;
                    this.map.off('click', this._mapClickHandler);
                    this._setCursor('');
                    if (this.onClear) this.onClear();
                }
            });
        });
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    _showPanel()  { const p = document.getElementById('routePlannerPanel2D'); if (p) p.style.display = 'block'; }
    _hidePanel()  { const p = document.getElementById('routePlannerPanel2D'); if (p) p.style.display = 'none';  }

    _showStatus(msg) {
        let el = document.getElementById('routePlannerStatus2D');
        if (!el) {
            el = document.createElement('div');
            el.id = 'routePlannerStatus2D';
            el.style.cssText = `
                position:fixed;top:24px;left:50%;transform:translateX(-50%);
                background:rgba(30,30,30,0.9);color:#fff;
                padding:8px 20px;border-radius:20px;font-size:13px;
                font-weight:600;pointer-events:none;z-index:9999;
                white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,0.3);
            `;
            document.body.appendChild(el);
        }
        el.textContent = msg;
        el.style.display = 'block';
    }

    _hideStatus() {
        const el = document.getElementById('routePlannerStatus2D');
        if (el) el.style.display = 'none';
    }

    _setCursor(cursor) {
        const container = this.map.getContainer();
        if (container) container.style.cursor = cursor;
    }
}
