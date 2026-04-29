export const TrafficStyler = {
    // Color palette for traffic levels [R, G, B]
    // Note: 'unknown' is now blue (default) instead of gray
    colors: {
        unknown: [52, 152, 219],    // 🔵 Blue - default when no traffic data
        low: [46, 204, 113],        // 🟢 Green - light traffic
        medium: [241, 196, 15],     // 🟡 Yellow - moderate traffic
        high: [230, 126, 34],       // 🟠 Orange - heavy traffic
        congested: [231, 76, 60]    // 🔴 Red - congested
    },

    // Default style values
    defaults: {
        width2D: 4,
        width3D: 4,
        minPixels: 2,
        maxPixels: 8
    },

    /**
     * Get color array for a traffic level
     * @param {string|null} level - Traffic level or null
     * @returns {Array<number>} [R, G, B] color array
     */
    getColor(level) {
        const normalized = level?.toLowerCase();
        return this.colors[normalized] || this.colors.unknown;
    },

    /**
     * Get hex color string for CSS/Leaflet usage
     * @param {string|null} level - Traffic level or null
     * @returns {string} Hex color string (e.g., '#3498db')
     */
    getColorHex(level) {
        const [r, g, b] = this.getColor(level);
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    },

    /**
     * Get width for route based on traffic level and renderer type
     * @param {string|null} level - Traffic level
     * @param {'2D'|'3D'} renderer - Target renderer
     * @returns {number} Width in pixels
     */
    getWidth(level, renderer = '2D') {
        const base = renderer === '3D' ? this.defaults.width3D : this.defaults.width2D;
        if (level === 'congested') return base + 2;
        if (level === 'high') return base + 1;
        return base;
    },

    /**
     * Get complete style object for 2D renderer (Leaflet)
     * @param {string|null} level - Traffic level
     * @param {boolean} isSelected - Whether route is currently selected
     * @returns {Object} Leaflet path options
     */
    getStyle2D(level, isSelected = false) {
        const baseWidth = this.getWidth(level, '2D');
        return {
            color: this.getColorHex(level),
            weight: isSelected ? baseWidth + 2 : baseWidth,
            opacity: isSelected ? 1 : 0.85,
            lineCap: 'round',
            lineJoin: 'round'
        };
    },

    /**
     * Get complete style object for 3D renderer (Deck.gl)
     * @param {string|null} level - Traffic level
     * @param {boolean} isSelected - Whether route is currently selected
     * @returns {Object} Deck.gl PathLayer props
     */
    getStyle3D(level, isSelected = false) {
        const baseWidth = this.getWidth(level, '3D');
        return {
            getColor: () => this.getColor(level),
            getWidth: () => isSelected ? baseWidth + 2 : baseWidth,
            widthMinPixels: this.defaults.minPixels,
            widthMaxPixels: this.defaults.maxPixels,
            capRounded: true,
            jointRounded: true
        };
    }
};