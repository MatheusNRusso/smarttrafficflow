package com.mtnrs.trafficinsight.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Data Transfer Object for bus stop information
 */
public record StopDto(
        @JsonProperty("stop_id")
        String stopId,

        @JsonProperty("stop_name")
        String stopName,

        double lat,
        double lng,

        // Direction of the stop: 0 = outbound, 1 = inbound
        @JsonProperty("direction")
        Integer direction
) {
        /**
         * Convenience constructor for backward compatibility
         * Defaults direction to 0 (outbound)
         */
        public StopDto(String stopId, String stopName, double lat, double lng) {
                this(stopId, stopName, lat, lng, 0);
        }
}