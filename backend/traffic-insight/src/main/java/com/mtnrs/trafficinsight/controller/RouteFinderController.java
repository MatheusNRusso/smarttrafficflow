package com.mtnrs.trafficinsight.controller;

import com.mtnrs.trafficinsight.dto.RouteOptionDto;
import com.mtnrs.trafficinsight.service.RouteFinderService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * REST controller for route planning between two geographic points.
 */
@RestController
@RequestMapping("/api/traffic/routes")
public class RouteFinderController {

    private final RouteFinderService routeFinderService;

    public RouteFinderController(RouteFinderService routeFinderService) {
        this.routeFinderService = routeFinderService;
    }

    /**
     * Finds viable bus routes between two geographic points.
     *
     * Returns up to 5 ranked route options. Results are ordered by:
     *   1. Traffic level (low → congested)
     *   2. Total walking distance (distanceToA + distanceToB)
     *
     * Example:
     *   GET /api/traffic/routes/between
     *       ?latA=-22.9068&lngA=-43.1729
     *       &latB=-22.9500&lngB=-43.2000
     *       &radius=500&hour=8
     *
     * @param latA    Latitude of departure point
     * @param lngA    Longitude of departure point
     * @param latB    Latitude of destination point
     * @param lngB    Longitude of destination point
     * @param radius  Search radius in metres around each point (default: 500)
     * @param hour    Hour of day for traffic level lookup (default: 8)
     * @return List of up to 5 RouteOptionDto ranked by viability
     */
    @GetMapping("/between")
    public List<RouteOptionDto> findRoutesBetween(
            @RequestParam double latA,
            @RequestParam double lngA,
            @RequestParam double latB,
            @RequestParam double lngB,
            @RequestParam(defaultValue = "500") double radius,
            @RequestParam(defaultValue = "8")   int    hour
    ) {
        return routeFinderService
                .findRoutes(latA, lngA, latB, lngB, radius, hour)
                .stream()
                .limit(5)
                .toList();
    }

    /**
     * Returns all line IDs that have at least one stop within the given radius
     * of a single geographic point. Useful for single-point proximity queries.
     *
     * Example:
     *   GET /api/traffic/routes/nearby?lat=-22.9068&lng=-43.1729&radius=500
     *
     * @param lat    Latitude of the point
     * @param lng    Longitude of the point
     * @param radius Search radius in metres (default: 500)
     * @return List of line IDs with nearby stops
     */
    @GetMapping("/nearby")
    public List<String> findLinesNearPoint(
            @RequestParam double lat,
            @RequestParam double lng,
            @RequestParam(defaultValue = "500") double radius
    ) {
        return routeFinderService.findLinesNearPoint(lat, lng, radius);
    }
}
