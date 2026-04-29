package com.mtnrs.trafficinsight.controller;

import com.mtnrs.trafficinsight.dto.LineStopsDto;
import com.mtnrs.trafficinsight.dto.StopDto;
import com.mtnrs.trafficinsight.service.LineStopsService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * REST controller for traffic and stops endpoints
 */
@RestController
@RequestMapping("/api/traffic")
public class LineStopsController {

    private final LineStopsService service;

    public LineStopsController(LineStopsService service) {
        this.service = service;
    }

    /**
     * Returns all lines with their stops (full structure with directions)
     * @return List of LineStopsDto objects
     */
    @GetMapping("/lines-with-stops")
    public List<LineStopsDto> getAll() {
        return service.getAll();
    }

    /**
     * Returns stops for a specific line, optionally filtered by direction
     * @param line Line identifier (required)
     * @param direction Direction key "0" or "1" (optional)
     * @return List of StopDto objects
     */
    @GetMapping("/stops-by-line")
    public List<StopDto> getByLine(
            @RequestParam String line,
            @RequestParam(required = false) String direction
    ) {
        if (direction != null) {
            // Return stops for specific direction only
            return service.getStopsByLineAndDirection(line, direction);
        }
        // Return all stops (all directions) for backward compatibility
        return service.getStopsByLine(line);
    }
}