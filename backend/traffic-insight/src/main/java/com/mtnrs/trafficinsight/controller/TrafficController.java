package com.mtnrs.trafficinsight.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.mtnrs.trafficinsight.dto.HeatmapPointDTO;
import com.mtnrs.trafficinsight.dto.TrafficSummaryDTO;
import com.mtnrs.trafficinsight.dto.RouteStatusDTO;

import com.mtnrs.trafficinsight.model.TrafficRecord;
import com.mtnrs.trafficinsight.service.TrafficService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;

@RestController
@RequestMapping("/api/traffic")
@CrossOrigin(origins = "*")
public class TrafficController {

    private final TrafficService service;

    public TrafficController(TrafficService service) {
        this.service = service;
    }

    /**
     * Get traffic records with optional filtering and pagination.
     * Example: GET /api/traffic?regions=Centro,Zona%20Sul&startHour=7&endHour=9&page=0&size=20
     */
    @GetMapping
    public ResponseEntity<Page<TrafficRecord>> getRecords(
            @RequestParam(required = false) List<String> regions,
            @RequestParam(required = false) Integer startHour,
            @RequestParam(required = false) Integer endHour,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        var pageable = PageRequest.of(page, size, Sort.by("timestamp").descending());
        return ResponseEntity.ok(service.getRecords(regions, startHour, endHour, pageable));
    }

    /**
     * Get statistical summary by region.
     */
    @GetMapping("/summary/regions")
    public ResponseEntity<List<TrafficSummaryDTO>> getRegionalSummary() {
        return ResponseEntity.ok(service.getRegionalSummary());
    }

    /**
     * Get route geometry filtered by line and hour.
     * URL: GET /api/traffic/routes
     */
    @GetMapping("/routes")
    public ResponseEntity<?> getRoutes(
            @RequestParam(required = false) String line,
            @RequestParam(required = false) Integer hour
    ) {
        try {
            ObjectNode filteredGeoJson = service.getFilteredRoutes(line, hour);
            return ResponseEntity.ok(filteredGeoJson);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.internalServerError().body("Error: " + e.getMessage());
        }
    }

    /**
     * Get distribution of traffic levels (for pie charts).
     */
    @GetMapping("/summary/levels")
    public ResponseEntity<List<Object[]>> getTrafficLevels() {
        return ResponseEntity.ok(service.getTrafficLevelDistribution());
    }

    /**
     * Get data specifically formatted for Heatmap visualization.
     * Example: GET /api/traffic/heatmap?regions=Centro&startHour=18&endHour=19
     */
    @GetMapping("/heatmap")
    public ResponseEntity<List<HeatmapPointDTO>> getHeatmap(
            @RequestParam(required = false) List<String> regions,
            @RequestParam(required = false) Integer startHour,
            @RequestParam(required = false) Integer endHour
    ) {
        return ResponseEntity.ok(service.getHeatmapData(regions, startHour, endHour));
    }

    /**
     * Import traffic data from a CSV file.
     */
    @PostMapping(value = "/import", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Operation(
            summary = "Import Traffic Data",
            description = "Upload a CSV file containing traffic records to be persisted in the database."
    )
    @ApiResponse(responseCode = "200", description = "Successfully imported records")
    @ApiResponse(responseCode = "400", description = "File is empty or invalid")
    @ApiResponse(responseCode = "500", description = "Internal server error during import")
    public ResponseEntity<String> importData(
            @Parameter(
                    description = "CSV file containing traffic records",
                    content = @Content(mediaType = "text/csv", schema = @Schema(type = "string", format = "binary"))
            )
            @RequestParam("file") MultipartFile file
    ) {
        if (file.isEmpty()) {
            return ResponseEntity.badRequest().body("File is empty.");
        }
        try {
            long count = service.importFromCsv(file);
            return ResponseEntity.ok("Successfully imported " + count + " records.");
        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.internalServerError().body("Import error: " + e.getMessage());
        }
    }

    /**
     * Get unique stops (simplified).
     */
    @GetMapping("/stops")
    public ResponseEntity<List<TrafficRecord>> getStops() {
        return ResponseEntity.ok(service.getUniqueStops());
    }

    /**
     * Get list of all unique bus line numbers available in the system.
     */
    @GetMapping("/bus-lines")
    public ResponseEntity<List<String>> getAvailableBusLines() {
        List<String> lines = service.getDistinctServiceIds();
        return ResponseEntity.ok(lines);
    }

   /**
     * Get traffic status for all routes at a specific hour.
     * Example: GET /api/traffic/status-by-hour?hour=8
     */
    @GetMapping("/status-by-hour")
    public ResponseEntity<List<RouteStatusDTO>> getRoutesStatusByHour(
            @RequestParam Integer hour
    ) {
        if (hour < 0 || hour > 23) {
            return ResponseEntity.badRequest().build();
        }
        return ResponseEntity.ok(service.getRouteStatusByHour(hour));
    }

    @GetMapping("/bus-stops")
    public ResponseEntity<?> getBusStops() {
        try {
            JsonNode geoJson = service.getBusStops();
            return ResponseEntity.ok(geoJson);
        }
        catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.internalServerError().body("Error: " + e.getMessage());
        }
    }



}