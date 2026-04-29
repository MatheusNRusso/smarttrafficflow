package com.mtnrs.trafficinsight.service;

import com.mtnrs.trafficinsight.dto.LineStopsDto;
import com.mtnrs.trafficinsight.dto.RouteOptionDto;
import com.mtnrs.trafficinsight.dto.StopDto;
import org.springframework.stereotype.Service;

import java.util.*;

/**
 * Service responsible for finding viable bus routes between two geographic points.
 *
 * Strategy:
 *   1. For each point (A and B), find all stops within the search radius.
 *   2. Find bus lines that serve BOTH points (intersection).
 *   3. Rank results by traffic level and proximity to the requested points.
 */
@Service
public class RouteFinderService {

    private final LineStopsService lineStopsService;
    private final TrafficService trafficService;

    // Earth radius in metres — used for Haversine distance calculation
    private static final double EARTH_RADIUS_METRES = 6_371_000.0;

    // Traffic level ranking — lower is better
    private static final Map<String, Integer> TRAFFIC_RANK = Map.of(
            "low",       1,
            "medium",    2,
            "high",      3,
            "congested", 4,
            "unknown",   5
    );

    public RouteFinderService(LineStopsService lineStopsService,
                              TrafficService trafficService) {
        this.lineStopsService = lineStopsService;
        this.trafficService   = trafficService;
    }

    /**
     * Finds viable bus routes between two geographic points.
     *
     * @param latA      Latitude of departure point
     * @param lngA      Longitude of departure point
     * @param latB      Latitude of destination point
     * @param lngB      Longitude of destination point
     * @param radiusM   Search radius in metres around each point
     * @param hour      Hour of day for traffic level lookup
     * @return List of RouteOptionDto ranked by viability (best first)
     */
    public List<RouteOptionDto> findRoutes(double latA, double lngA,
                                           double latB, double lngB,
                                           double radiusM, int hour) {

        // Build traffic level map for the requested hour
        Map<String, String> trafficLevelMap = buildTrafficLevelMap(hour);

        List<RouteOptionDto> results = new ArrayList<>();

        for (LineStopsDto line : lineStopsService.getAll()) {
            for (Map.Entry<String, LineStopsDto.DirectionStops> entry : line.directions().entrySet()) {
                String directionKey       = entry.getKey();
                LineStopsDto.DirectionStops dirData = entry.getValue();
                List<StopDto> stops       = dirData.stops();

                if (stops == null || stops.isEmpty()) continue;

                // Find closest stop to point A within radius
                StopDto closestToA = findClosestStop(stops, latA, lngA, radiusM);
                if (closestToA == null) continue;

                // Find closest stop to point B within radius
                StopDto closestToB = findClosestStop(stops, latB, lngB, radiusM);
                if (closestToB == null) continue;

                // Ensure A comes before B along the route (stop index order)
                int idxA = stops.indexOf(closestToA);
                int idxB = stops.indexOf(closestToB);
                if (idxA >= idxB) continue; // wrong direction for this line

                double distA = haversineMetres(latA, lngA,
                        closestToA.lat(), closestToA.lng());
                double distB = haversineMetres(latB, lngB,
                        closestToB.lat(), closestToB.lng());

                String trafficLevel = trafficLevelMap.getOrDefault(
                        line.lineId().toLowerCase(), "unknown");

                int stopsBetween = idxB - idxA;

                results.add(new RouteOptionDto(
                        line.lineId(),
                        directionKey,
                        trafficLevel,
                        Math.round(distA),
                        Math.round(distB),
                        stopsBetween,
                        closestToA.stopName(),
                        closestToB.stopName()
                ));
            }
        }

        // Rank: traffic level first, then total walk distance
        results.sort(Comparator
                .comparingInt((RouteOptionDto r) ->
                        TRAFFIC_RANK.getOrDefault(r.trafficLevel(), 5))
                .thenComparingLong(r -> r.distanceToA() + r.distanceToB()));

        return results;
    }

    /**
     * Returns all bus lines that have at least one stop within the given radius
     * of the specified point. Used for single-point proximity queries.
     *
     * @param lat     Latitude of the point
     * @param lng     Longitude of the point
     * @param radiusM Search radius in metres
     * @return List of line IDs with nearby stops
     */
    public List<String> findLinesNearPoint(double lat, double lng, double radiusM) {
        List<String> nearbyLines = new ArrayList<>();

        for (LineStopsDto line : lineStopsService.getAll()) {
            for (LineStopsDto.DirectionStops dirData : line.directions().values()) {
                List<StopDto> stops = dirData.stops();
                if (stops == null) continue;

                boolean hasNearbyStop = stops.stream().anyMatch(stop ->
                        haversineMetres(lat, lng, stop.lat(), stop.lng()) <= radiusM);

                if (hasNearbyStop) {
                    nearbyLines.add(line.lineId());
                    break; // one direction match is enough
                }
            }
        }

        return nearbyLines;
    }

    // ─── Private helpers ──────────────────────────────────────────────────────

    /**
     * Finds the closest stop to a point within the given radius.
     * Returns null if no stop is within the radius.
     */
    private StopDto findClosestStop(List<StopDto> stops,
                                    double lat, double lng,
                                    double radiusM) {
        StopDto closest  = null;
        double  minDist  = radiusM; // only consider stops within radius

        for (StopDto stop : stops) {
            double dist = haversineMetres(lat, lng, stop.lat(), stop.lng());
            if (dist < minDist) {
                minDist = dist;
                closest = stop;
            }
        }
        return closest;
    }

    /**
     * Builds a map of lineId → trafficLevel for the given hour.
     * Falls back to "unknown" if the line has no traffic data.
     */
    private Map<String, String> buildTrafficLevelMap(int hour) {
        Map<String, String> map = new HashMap<>();
        try {
            trafficService.getRouteStatusByHour(hour)
                    .forEach(dto -> map.put(dto.routeId().toLowerCase(), dto.trafficLevel()));
        } catch (Exception e) {
            // Non-critical — proceed without traffic data
        }
        return map;
    }

    /**
     * Calculates the great-circle distance between two points in metres
     * using the Haversine formula.
     */
    private double haversineMetres(double lat1, double lng1,
                                   double lat2, double lng2) {
        double dLat = Math.toRadians(lat2 - lat1);
        double dLng = Math.toRadians(lng2 - lng1);
        double a    = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                    + Math.cos(Math.toRadians(lat1))
                    * Math.cos(Math.toRadians(lat2))
                    * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return EARTH_RADIUS_METRES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
}
