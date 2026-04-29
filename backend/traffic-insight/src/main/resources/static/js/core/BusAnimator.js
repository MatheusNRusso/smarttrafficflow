// js/core/BusAnimator.js
// Bus animation with realistic stop behavior (pause at each stop)

export class BusAnimator {
    constructor({
                    routePaths,
                    stops,
                    onPositionUpdate,
                    onStopReached,
                    stopDuration = 2500,    // Time to wait at each stop (ms)
                    moveSpeed = 0.0008,     // Progress increment per frame
                    proximityThreshold = 50 // Meters to consider "arrived" at stop
                }) {
        this.routePaths = routePaths;
        this.stops = stops || [];
        this.onPositionUpdate = onPositionUpdate;
        this.onStopReached = onStopReached;
        this.stopDuration = stopDuration;
        this.moveSpeed = moveSpeed;
        this.proximityThreshold = proximityThreshold;

        // Animation state
        this.isPlaying = false;
        this.animationId = null;
        this.currentWaypointIndex = 0;
        this.progress = 0; // 0 to 1 along current segment
        this.state = 'STOPPED'; // 'MOVING' or 'STOPPED'
        this.stopTimer = null;

        // Build waypoints list: [start, stop1, stop2, ..., end]
        this.waypoints = this._buildWaypoints();
    }

    /**
     * Build ordered list of waypoints from route + stops
     * @returns {Array} Array of { position: [lon, lat], type: 'start'|'stop'|'end', id, name }
     */
    _buildWaypoints() {
        const waypoints = [];

        if (!this.routePaths || this.routePaths.length === 0) return waypoints;

        // Get first direction path (simplified - could handle both directions)
        const firstRoute = this.routePaths[0];
        const directions = Object.values(firstRoute.directions || {});
        if (directions.length === 0) return waypoints;

        const path = directions[0].path;
        if (!path || path.length < 2) return waypoints;

        // Add START waypoint (first coordinate of path)
        waypoints.push({
            position: path[0],
            type: 'start',
            id: `${firstRoute.lineId}-start`,
            name: 'Route Start'
        });

        // Add STOP waypoints (from stops list, in order)
        if (this.stops && this.stops.length > 0) {
            this.stops.forEach((stop, index) => {
                if (stop.position && Array.isArray(stop.position) && stop.position.length >= 2) {
                    waypoints.push({
                        position: stop.position,
                        type: 'stop',
                        id: stop.id,
                        name: stop.name || `Parada ${index + 1}`,
                        order: index
                    });
                }
            });
        }

        // Add END waypoint (last coordinate of path)
        waypoints.push({
            position: path[path.length - 1],
            type: 'end',
            id: `${firstRoute.lineId}-end`,
            name: 'Fim da Rota'
        });

        return waypoints;
    }

    /**
     * Calculate distance between two coordinates in meters
     */
    _calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371e3;
        const φ1 = lat1 * Math.PI / 180;
        const φ2 = lat2 * Math.PI / 180;
        const Δφ = (lat2 - lat1) * Math.PI / 180;
        const Δλ = (lon2 - lon1) * Math.PI / 180;

        const a = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

        return R * c;
    }

    /**
     * Check if bus is close enough to a waypoint
     */
    _isNearWaypoint(busPos, waypointPos) {
        const [busLon, busLat] = busPos;
        const [wpLon, wpLat] = waypointPos;
        return this._calculateDistance(busLat, busLon, wpLat, wpLon) < this.proximityThreshold;
    }

    /**
     * Interpolate position between two coordinates
     */
    _interpolate(start, end, t) {
        return [
            start[0] + (end[0] - start[0]) * t,
            start[1] + (end[1] - start[1]) * t,
            0
        ];
    }

    /**
     * Start the animation
     */
    start() {
        if (this.waypoints.length < 2) {
            console.warn('BusAnimator: Not enough waypoints to animate');
            return;
        }

        this.isPlaying = true;
        this.state = 'STOPPED'; // Start stopped at first waypoint
        this.currentWaypointIndex = 0;
        this.progress = 0;

        // Notify initial position
        if (this.onPositionUpdate) {
            this.onPositionUpdate(this.waypoints[0].position, {
                ...this.waypoints[0],
                state: 'STOPPED'
            });
        }

        // Start stopped, wait before moving
        this._startStopTimer();

        this._animate();
    }

    /**
     * Stop the animation
     */
    stop() {
        this.isPlaying = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        if (this.stopTimer) {
            clearTimeout(this.stopTimer);
            this.stopTimer = null;
        }
    }

    /**
     * Start timer for stopped state
     */
    _startStopTimer() {
        if (this.stopTimer) clearTimeout(this.stopTimer);

        this.stopTimer = setTimeout(() => {
                if (this.isPlaying && this.state === 'STOPPED') {
                    this.state = 'MOVING';
                    this.progress = 0;

                    // Notify stop ended
                    if (this.onStopReached) {
                        this.onStopReached(this.waypoints[this.currentWaypointIndex], 'departed');
                    }
                }
            }, this.state === 'STOPPED' && this.currentWaypointIndex === 0
                ? 3000  // Longer pause at start (3s)
                : this.stopDuration  // Normal stop duration (2.5s)
        );
    }

    /**
     * Main animation loop
     */
    _animate = () => {
        if (!this.isPlaying) return;

        if (this.state === 'STOPPED') {
            // Just keep reporting stopped position
            if (this.onPositionUpdate) {
                this.onPositionUpdate(this.waypoints[this.currentWaypointIndex].position, {
                    ...this.waypoints[this.currentWaypointIndex],
                    state: 'STOPPED'
                });
            }
            this.animationId = requestAnimationFrame(this._animate);
            return;
        }

        // MOVING state
        const currentIndex = this.currentWaypointIndex;
        const nextIndex = currentIndex + 1;

        // Check if we reached the end
        if (nextIndex >= this.waypoints.length) {
            // Loop back to start or stop
            this.currentWaypointIndex = 0;
            this.progress = 0;
            this.state = 'STOPPED';
            this._startStopTimer();
            this.animationId = requestAnimationFrame(this._animate);
            return;
        }

        const currentWaypoint = this.waypoints[currentIndex];
        const nextWaypoint = this.waypoints[nextIndex];

        // Move bus along segment
        this.progress += this.moveSpeed;

        if (this.progress >= 1 || this._isNearWaypoint(
            this._interpolate(currentWaypoint.position, nextWaypoint.position, this.progress),
            nextWaypoint.position
        )) {
            // Arrived at next waypoint
            this.currentWaypointIndex = nextIndex;
            this.progress = 0;
            this.state = 'STOPPED';

            // Notify arrival
            if (this.onStopReached) {
                this.onStopReached(nextWaypoint, 'arrived');
            }

            // Start stop timer
            this._startStopTimer();
        }

        // Calculate current position
        const currentPosition = this._interpolate(
            currentWaypoint.position,
            nextWaypoint.position,
            Math.min(this.progress, 1)
        );

        // Notify position update
        if (this.onPositionUpdate) {
            this.onPositionUpdate(currentPosition, {
                ...nextWaypoint,
                state: this.state,
                progress: this.progress,
                segment: { from: currentIndex, to: nextIndex }
            });
        }

        this.animationId = requestAnimationFrame(this._animate);
    }

    /**
     * Get current animation state
     */
    getState() {
        return {
            isPlaying: this.isPlaying,
            state: this.state,
            currentWaypointIndex: this.currentWaypointIndex,
            progress: this.progress,
            totalWaypoints: this.waypoints.length,
            currentWaypoint: this.waypoints[this.currentWaypointIndex]
        };
    }
}