package com.mtnrs.trafficinsight.model;

import jakarta.persistence.*;
import lombok.*;

import java.math.BigDecimal;
import java.time.LocalDateTime;

@Getter
@Entity
@Table(
        name = "traffic_records",
        indexes = {
                @Index(name = "idx_road_hour", columnList = "road_name, hour")
        }
)
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@Builder
public class TrafficRecord {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "road_name", nullable = false, length = 255)
    private String roadName;

    @Column(name = "road_type", length = 50)
    private String roadType;

    @Column(length = 100)
    private String region;

    @Column(name = "day_of_week", length = 20)
    private String  dayOfWeek;

    @Column(nullable = false)
    private Integer hour;

    @Column(name = "bus_line_count")
    private Integer busLineCount;

    @Column(name = "vehicle_volume")
    private Integer vehicleVolume;

    @Column(name = "avg_speed", precision = 10, scale = 2)
    private BigDecimal avgSpeed;

    @Column(name = "speed_limit")
    private Integer speedLimit;

    @Column(name = "traffic_level", length = 20, nullable = false)
    private String  trafficLevel;

    @Column(name = "event_nearby")
    private Boolean eventNearby;

    @Column(length = 50)
    private String  weather;

    @Column(nullable = false)
    private LocalDateTime timestamp;

    // Adding latitude and longitude for geospatial analysis
    @Column(name = "latitude", precision = 9, scale = 6)
    private BigDecimal latitude;

    @Column(name = "longitude", precision = 9, scale = 6)
    private BigDecimal longitude;

    // Add new features
    @Column(name = "service_id", length = 100)
    private String serviceId;

    @Column(name = "consortium", length = 100)
    private String consortium;


    /**
     * Factory method to create a new TrafficRecord with validation.
     */
    public static TrafficRecord of(
            String roadName,
            Integer hour,
            String roadType,
            String region,
            DayOfWeek dayOfWeek,
            Integer busLineCount,
            Integer vehicleVolume,
            BigDecimal avgSpeed,
            Integer speedLimit,
            TrafficLevel trafficLevel,
            Boolean eventNearby,
            Weather weather,
            BigDecimal latitude,
            BigDecimal longitude,
            String serviceId,
            String consortium
    ) {
        if (roadName == null || roadName.isBlank()) {
            throw new IllegalArgumentException("roadName must not be null or blank");
        }

        if (hour == null || hour < 0 || hour > 23) {
            throw new IllegalArgumentException("hour must be between 0 and 23");
        }

        if (trafficLevel == null) {
            throw new IllegalArgumentException("trafficLevel must not be null");
        }

        if (vehicleVolume != null && vehicleVolume < 0) {
            throw new IllegalArgumentException("vehicleVolume cannot be negative");
        }

        if (avgSpeed != null && avgSpeed.compareTo(BigDecimal.ZERO) < 0) {
            throw new IllegalArgumentException("avgSpeed cannot be negative");
        }

        String dayOfWeekStr = (dayOfWeek != null) ? dayOfWeek.name().toLowerCase() : null;

        String weatherStr = (weather != null) ? weather.name().toLowerCase() : null;

        String trafficLevelStr = trafficLevel.name().toLowerCase();

        return TrafficRecord.builder()
                .roadName(roadName)
                .hour(hour)
                .roadType(roadType)
                .region(region)
                .dayOfWeek(dayOfWeekStr)
                .busLineCount(busLineCount)
                .vehicleVolume(vehicleVolume)
                .avgSpeed(avgSpeed)
                .speedLimit(speedLimit)
                .trafficLevel(trafficLevelStr)
                .eventNearby(eventNearby)
                .weather(weatherStr)
                .latitude(latitude)
                .longitude(longitude)
                .serviceId(serviceId)
                .consortium(consortium)
                .build();
    }

    @PrePersist
    void prePersist() {
        if (timestamp == null) {
            timestamp = LocalDateTime.now();
        }
    }


    public void setTimestamp(LocalDateTime timestamp) {
        this.timestamp = timestamp;
    }

}