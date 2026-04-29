package com.mtnrs.trafficinsight.repository;

import com.mtnrs.trafficinsight.dto.HeatmapPointDTO;
import com.mtnrs.trafficinsight.model.TrafficRecord;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface TrafficRepository extends JpaRepository<TrafficRecord, Long> {

    Page<TrafficRecord> findByRegionInAndHourBetween(
            List<String> regions,
            Integer startHour,
            Integer endHour,
            Pageable pageable
    );

    Page<TrafficRecord> findByTrafficLevel(String trafficLevel, Pageable pageable);

    // Query for Heatmap data: returns latitude, longitude, volume, and speed
    @Query("SELECT new com.mtnrs.trafficinsight.dto.HeatmapPointDTO(t.latitude, t.longitude, t.vehicleVolume, t.avgSpeed) " +
            "FROM TrafficRecord t WHERE t.region IN :regions AND t.hour BETWEEN :startHour AND :endHour")
    List<HeatmapPointDTO> findHeatmapDataByRegionAndTime(
            @Param("regions") List<String> regions,
            @Param("startHour") Integer startHour,
            @Param("endHour") Integer endHour
    );

    // Aggregation: Average speed and volume per region
    @Query("SELECT t.region, AVG(t.avgSpeed), AVG(t.vehicleVolume), COUNT(t) " +
            "FROM TrafficRecord t GROUP BY t.region")
    List<Object[]> getSummaryByRegion();

    // Aggregation: Count by traffic level
    @Query("SELECT t.trafficLevel, COUNT(t) FROM TrafficRecord t GROUP BY t.trafficLevel")
    List<Object[]> getCountByTrafficLevel();


    @Query(value = """
        SELECT 
            service_id, 
            consortium,
            CASE 
                WHEN MAX(CASE WHEN traffic_level = 'congested' THEN 4 WHEN traffic_level = 'high' THEN 3 WHEN traffic_level = 'medium' THEN 2 ELSE 1 END) = 4 THEN 'congested'
                WHEN MAX(CASE WHEN traffic_level = 'congested' THEN 4 WHEN traffic_level = 'high' THEN 3 WHEN traffic_level = 'medium' THEN 2 ELSE 1 END) = 3 THEN 'high'
                WHEN MAX(CASE WHEN traffic_level = 'congested' THEN 4 WHEN traffic_level = 'high' THEN 3 WHEN traffic_level = 'medium' THEN 2 ELSE 1 END) = 2 THEN 'medium'
                ELSE 'low' 
            END as traffic_level,
            AVG(avg_speed) as avg_speed,
            COUNT(*) as record_count
        FROM traffic_records
        WHERE hour = :hour
        GROUP BY service_id, consortium
        """, nativeQuery = true)
    List<Object[]> findRouteSummaryByHour(@Param("hour") Integer hour);

    @Query("SELECT DISTINCT t.serviceId FROM TrafficRecord t WHERE t.serviceId IS NOT NULL ORDER BY t.serviceId")
    List<String> findDistinctServiceIds();
}