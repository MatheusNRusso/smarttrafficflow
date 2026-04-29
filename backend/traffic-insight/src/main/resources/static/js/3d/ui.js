/**
 * Shows a tooltip at screen coordinates
 * @param {string} text - Tooltip content
 * @param {number} x - X coordinate in pixels (from Deck.gl onHover)
 * @param {number} y - Y coordinate in pixels (from Deck.gl onHover)
 */
export function showTooltip(text, x, y) {
    // Try both possible IDs for backward compatibility
    let tooltip = document.getElementById('tooltip') ||
        document.getElementById('traffic-tooltip');

    // Create tooltip if it doesn't exist
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'tooltip';
        tooltip.className = 'tooltip';
        document.body.appendChild(tooltip);
    }

    // Update content and position
    tooltip.textContent = text;
    tooltip.style.left = `${x + 15}px`;
    tooltip.style.top = `${y - 35}px`;
    tooltip.style.display = 'block';
    tooltip.style.opacity = '1';
}

/**
 * Hides the tooltip
 */
export function hideTooltip() {
    const tooltip = document.getElementById('tooltip') ||
        document.getElementById('traffic-tooltip');
    if (tooltip) {
        tooltip.style.display = 'none';
        tooltip.style.opacity = '0';
    }
}

/**
 * Updates tooltip position without changing content
 * @param {number} x - X coordinate in pixels
 * @param {number} y - Y coordinate in pixels
 */
export function updateTooltipPosition(x, y) {
    const tooltip = document.getElementById('tooltip') ||
        document.getElementById('traffic-tooltip');
    if (tooltip && tooltip.style.display !== 'none') {
        tooltip.style.left = `${x + 15}px`;
        tooltip.style.top = `${y - 35}px`;
    }
}