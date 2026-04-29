/**
 * mobile-enhancements.js
 * =======================
 * Mobile usability improvements for SmartTrafficFlow.
 * Works on both 3D (index-3d.html) and 2D (index-2d.html) maps.
 */

(function () {
    'use strict';

    const isMobile     = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    // Detect which map is active
    const is2D = !!document.getElementById('insightsPanel2D');

    // Unified toggle function — calls the correct one per page
    function toggleInsightsPanel() {
        if (is2D) {
            if (typeof window.toggleInsights2D === 'function') {
                window.toggleInsights2D();
            } else {
                // Fallback if function not yet defined
                const body    = document.getElementById('insightsBody2D');
                const chevron = document.getElementById('insightsChevron2D');
                if (body && chevron) {
                    const isOpen = body.style.display !== 'none';
                    body.style.display    = isOpen ? 'none' : 'block';
                    chevron.textContent   = isOpen ? '▼' : '▲';
                }
            }
        } else {
            if (typeof window.toggleInsights === 'function') {
                window.toggleInsights();
            } else {
                const body    = document.getElementById('insightsBody');
                const chevron = document.getElementById('insightsChevron');
                if (body && chevron) {
                    const isOpen = body.style.display !== 'none';
                    body.style.display    = isOpen ? 'none' : 'block';
                    chevron.textContent   = isOpen ? '▼' : '▲';
                }
            }
        }
    }

    // ─── Prevent double-tap zoom on iOS ──────────────────────────────────────
    if (isTouchDevice) {
        document.addEventListener('dblclick', e => e.preventDefault(), { passive: false });
    }

    // ─── Prevent scroll propagation to map ───────────────────────────────────
    function setupScrollBehavior() {
        const panels = [
            document.querySelector('.controls'),
            document.querySelector('.insights-panel'),
            document.querySelector('.insights-panel-2d')
        ].filter(Boolean);

        panels.forEach(panel => {
            panel.addEventListener('touchmove', e => e.stopPropagation(), { passive: true });
        });
    }

    // ─── Touch feedback on buttons ────────────────────────────────────────────
    function setupButtonOptimizations() {
        document.querySelectorAll('button, .insights-toggle, .insights-toggle-2d').forEach(btn => {
            btn.addEventListener('touchstart',  function () { this.style.opacity = '0.7'; }, { passive: true });
            btn.addEventListener('touchend',    function () { this.style.opacity = ''; },   { passive: true });
            btn.addEventListener('touchcancel', function () { this.style.opacity = ''; },   { passive: true });
        });
    }

    // ─── CSS --vh variable (fixes 100vh on mobile browsers) ──────────────────
    function setVHVariable() {
        document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`);
    }

    // ─── Orientation change ───────────────────────────────────────────────────
    function setupOrientationChange() {
        window.addEventListener('orientationchange', () => setTimeout(setVHVariable, 300));
        window.addEventListener('resize', setVHVariable);
    }

    // ─── Prevent iOS zoom on select focus ────────────────────────────────────
    function setupSelectEnhancements() {
        if (!isMobile) return;
        const viewport = document.querySelector('meta[name=viewport]');
        if (!viewport) return;

        document.querySelectorAll('select').forEach(select => {
            select.addEventListener('focus', () => {
                viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0');
            });
            select.addEventListener('blur', () => {
                viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover');
            });
        });
    }

    // ─── Swipe gestures on insights panel ────────────────────────────────────
    function setupSwipeGestures() {
        if (!isTouchDevice) return;

        // Works for both 3D and 2D toggle buttons
        const toggleBtn = document.getElementById('insightsToggle') ||
            document.querySelector('.insights-toggle-2d');
        const bodyEl    = document.getElementById('insightsBody') ||
            document.getElementById('insightsBody2D');

        if (!toggleBtn || !bodyEl) return;

        let touchStartY = 0;

        toggleBtn.addEventListener('touchstart', e => {
            touchStartY = e.touches[0].clientY;
        }, { passive: true });

        toggleBtn.addEventListener('touchend', e => {
            const swipeDistance = touchStartY - e.changedTouches[0].clientY;
            if (Math.abs(swipeDistance) < 50) return;

            const isOpen = bodyEl.style.display !== 'none';
            if (swipeDistance > 0 && isOpen)  toggleInsightsPanel(); // swipe up → close
            if (swipeDistance < 0 && !isOpen) toggleInsightsPanel(); // swipe down → open
        });
    }

    // ─── Init ─────────────────────────────────────────────────────────────────
    function init() {
        setVHVariable();
        setupScrollBehavior();
        setupButtonOptimizations();
        setupOrientationChange();
        setupSelectEnhancements();
        setupSwipeGestures();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();