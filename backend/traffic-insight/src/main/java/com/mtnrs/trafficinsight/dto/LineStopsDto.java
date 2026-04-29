package com.mtnrs.trafficinsight.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;
import java.util.Map;

/**
 * Data Transfer Object for bus line stops grouped by direction
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record LineStopsDto(
        @JsonProperty("lineId")
        String lineId,

        @JsonProperty("directions")
        Map<String, DirectionStops> directions,

        @JsonProperty("stops")
        List<StopDto> legacyStops
) {
    /**
     * Inner record representing stops for a single direction
     */
    public record DirectionStops(
            @JsonProperty("stops")
            List<StopDto> stops,
            @JsonProperty("stopCount")
            Integer stopCount,
            List<List<Double>> path
    ) {}

    /**
     * Returns all stops from all directions (for backward compatibility)
     */
    public List<StopDto> getAllStops() {
        if (directions != null && !directions.isEmpty()) {
            return directions.values().stream()
                    .flatMap(ds -> ds.stops().stream())
                    .toList();
        }
        return legacyStops != null ? legacyStops : List.of();
    }

    /**
     * Returns stops for a specific direction
     */
    public List<StopDto> getStopsByDirection(String direction) {
        if (directions != null && directions.containsKey(direction)) {
            return directions.get(direction).stops();
        }
        return List.of();
    }
}