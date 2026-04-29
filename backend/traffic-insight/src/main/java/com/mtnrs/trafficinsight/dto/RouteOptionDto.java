package com.mtnrs.trafficinsight.dto;

/**
 * Represents a viable bus route option between two geographic points.
 *
 * @param lineId        Bus line identifier
 * @param direction     Direction key ("0" = outbound, "1" = return)
 * @param trafficLevel  Current traffic level: low | medium | high | congested | unknown
 * @param distanceToA   Walking distance in metres from departure point to boarding stop
 * @param distanceToB   Walking distance in metres from alighting stop to destination
 * @param stopsBetween  Number of stops between boarding and alighting
 * @param boardingStop  Name of the stop closest to point A
 * @param alightingStop Name of the stop closest to point B
 */
public record RouteOptionDto(
        String lineId,
        String direction,
        String trafficLevel,
        long   distanceToA,
        long   distanceToB,
        int    stopsBetween,
        String boardingStop,
        String alightingStop
) {}
