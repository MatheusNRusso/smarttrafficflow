package com.mtnrs.trafficinsight.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mtnrs.trafficinsight.dto.LineStopsDto;
import com.mtnrs.trafficinsight.dto.StopDto;
import jakarta.annotation.PostConstruct;
import org.springframework.stereotype.Service;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Service for managing bus line stops data
 */
@Service
public class LineStopsService {

    // Cache for fast lookup by lineId (lowercase)
    private Map<String, LineStopsDto> cache = new HashMap<>();

    /**
     * Loads stops data from JSON file on application startup
     */
    @PostConstruct
    public void loadData() {
        try {
            ObjectMapper mapper = new ObjectMapper();
            InputStream is = getClass()
                    .getResourceAsStream("/data/lines_with_stops_vfinal.json");

            LineStopsDto[] lines = mapper.readValue(is, LineStopsDto[].class);

            // Index lines by lineId for O(1) lookup
            for (LineStopsDto line : lines) {
                cache.put(line.lineId().toLowerCase(), line);
            }
        } catch (Exception e) {
            throw new RuntimeException("Error loading JSON", e);
        }
    }

    /**
     * Returns all lines with their stops
     * @return List of all LineStopsDto objects
     */
    public List<LineStopsDto> getAll() {
        return new ArrayList<>(cache.values());
    }

    /**
     * Returns line data by lineId (case-insensitive)
     * @param lineId Line identifier
     * @return LineStopsDto or null if not found
     */
    public LineStopsDto getByLine(String lineId) {
        return cache.get(lineId.toLowerCase());
    }

    /**
     * Returns stops for a specific line and direction
     * @param lineId Line identifier
     * @param direction Direction key ("0" or "1")
     * @return List of StopDto objects for the specified direction
     */
    public List<StopDto> getStopsByLineAndDirection(String lineId, String direction) {
        LineStopsDto line = cache.get(lineId.toLowerCase());
        if (line != null) {
            return line.getStopsByDirection(direction);
        }
        return List.of();
    }

    /**
     * Returns all stops for a line (all directions combined)
     * For backward compatibility with existing API consumers
     * @param lineId Line identifier
     * @return List of all StopDto objects for the line
     */
    public List<StopDto> getStopsByLine(String lineId) {
        LineStopsDto line = cache.get(lineId.toLowerCase());
        return line != null ? line.getAllStops() : List.of();
    }
}