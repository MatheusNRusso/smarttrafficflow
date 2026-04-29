/**
 * Shows a tooltip at screen coordinates
 * @param {string} text - Tooltip content
 * @param {number} x - X coordinate in pixels
 * @param {number} y - Y coordinate in pixels
 */
export function showTooltip(text, x, y) {
    const tooltip = document.getElementById('tooltip');
    if (!tooltip) return;

    tooltip.textContent = text;
    tooltip.style.left = `${x + 15}px`;
    tooltip.style.top = `${y - 35}px`;
    tooltip.style.display = 'block';
}

/**
 * Hides the tooltip
 */
export function hideTooltip() {
    const tooltip = document.getElementById('tooltip');
    if (tooltip) {
        tooltip.style.display = 'none';
    }
}