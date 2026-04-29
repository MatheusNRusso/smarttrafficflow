package com.mtnrs.trafficinsight.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.mtnrs.trafficinsight.dto.HeatmapPointDTO;
import com.mtnrs.trafficinsight.dto.RouteStatusDTO;
import com.mtnrs.trafficinsight.dto.TrafficSummaryDTO;
import com.mtnrs.trafficinsight.model.DayOfWeek;
import com.mtnrs.trafficinsight.model.TrafficLevel;
import com.mtnrs.trafficinsight.model.TrafficRecord;
import com.mtnrs.trafficinsight.model.Weather;
import com.mtnrs.trafficinsight.repository.TrafficRepository;
import com.mtnrs.trafficinsight.model.Route;
import com.mtnrs.trafficinsight.repository.RouteRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.BufferedReader;
import java.io.FileNotFoundException;
import java.io.InputStreamReader;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;

@Service
public class TrafficService {

    private final TrafficRepository repository;
    private final RouteRepository   routeRepository;
    private final ObjectMapper      objectMapper;

    private static final DateTimeFormatter FORMATTER = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    // GeoJSON paths — optional in production (routes served from DB).
    // Set in application-local.yaml or via environment variables.
    @Value("${traffic.geojson.routes:}")
    private String routesGeoJsonPath;

    @Value("${traffic.geojson.stops:}")
    private String stopsGeoJsonPath;

    public TrafficService(TrafficRepository repository,
                          RouteRepository routeRepository,
                          ObjectMapper objectMapper) {
        this.repository      = repository;
        this.routeRepository = routeRepository;
        this.objectMapper    = objectMapper;
    }

    public Page<TrafficRecord> getRecords(List<String> regions, Integer startHour, Integer endHour, Pageable pageable) {
        if (regions != null && !regions.isEmpty() && startHour != null && endHour != null) {
            return repository.findByRegionInAndHourBetween(regions, startHour, endHour, pageable);
        }
        return repository.findAll(pageable);
    }

    public List<TrafficSummaryDTO> getRegionalSummary() {
        List<Object[]> results = repository.getSummaryByRegion();
        List<TrafficSummaryDTO> dtos = new ArrayList<>();
        for (Object[] row : results) {
            dtos.add(new TrafficSummaryDTO(
                    (String) row[0],
                    new BigDecimal(row[1].toString()),
                    new BigDecimal(row[2].toString()).longValue(),
                    ((Number) row[3]).longValue()
            ));
        }
        return dtos;
    }

    public List<Object[]> getTrafficLevelDistribution() {
        return repository.getCountByTrafficLevel();
    }

    public List<HeatmapPointDTO> getHeatmapData(List<String> regions, Integer startHour, Integer endHour) {
        List<String> targetRegions = (regions != null && !regions.isEmpty())
                ? regions
                : List.of("zona_sul", "centro", "barra_da_tijuca", "tijuca", "zona_norte");

        int start = (startHour != null) ? startHour : 0;
        int end   = (endHour   != null) ? endHour   : 23;

        List<HeatmapPointDTO> rawResults = repository.findHeatmapDataByRegionAndTime(targetRegions, start, end);

        return rawResults.stream()
                .map(dto -> new HeatmapPointDTO(
                        dto.latitude(),
                        dto.longitude(),
                        Math.min(dto.intensity() / 10, 100),
                        dto.speed()
                ))
                .toList();
    }

    @Transactional
    public long importFromCsv(MultipartFile file) throws Exception {
        List<TrafficRecord> records = new ArrayList<>();
        int batchSize  = 100;
        long count     = 0;
        long savedCount = 0;

        try (BufferedReader br = new BufferedReader(
                new InputStreamReader(file.getInputStream(), StandardCharsets.UTF_8))) {

            String line = br.readLine();
            if (line == null) return 0;

            String[] headers = line.split(",");
            Map<String, Integer> columnIndexMap = new HashMap<>();
            for (int i = 0; i < headers.length; i++) {
                columnIndexMap.put(headers[i].trim().toLowerCase(), i);
            }

            if (!columnIndexMap.containsKey("day_of_week") ||
                    !columnIndexMap.containsKey("traffic_level") ||
                    !columnIndexMap.containsKey("speed_limit")) {
                throw new IllegalArgumentException("Invalid CSV: missing required columns.");
            }

            int idxRoadName    = columnIndexMap.get("road_name");
            int idxRoadType    = columnIndexMap.get("road_type");
            int idxRegion      = columnIndexMap.get("region");
            int idxDayOfWeek   = columnIndexMap.get("day_of_week");
            int idxHour        = columnIndexMap.get("hour");
            int idxServiceId   = columnIndexMap.getOrDefault("service_id", -1);
            int idxConsortium  = columnIndexMap.getOrDefault("consortium", -1);
            int idxBusLineCount = columnIndexMap.get("bus_line_count");
            int idxVehicleVolume = columnIndexMap.get("vehicle_volume");
            int idxAvgSpeed    = columnIndexMap.get("avg_speed");
            int idxSpeedLimit  = columnIndexMap.get("speed_limit");
            int idxTrafficLevel = columnIndexMap.get("traffic_level");
            int idxEventNearby = columnIndexMap.get("event_nearby");
            int idxWeather     = columnIndexMap.get("weather");
            int idxTimestamp   = columnIndexMap.get("timestamp");
            int idxLatitude    = columnIndexMap.get("latitude");
            int idxLongitude   = columnIndexMap.get("longitude");

            while ((line = br.readLine()) != null) {
                String[] columns = line.split(",", -1);
                if (columns.length < headers.length) continue;

                try {
                    String roadName    = columns[idxRoadName].trim();
                    String roadTypeStr = columns[idxRoadType].trim();
                    String region      = columns[idxRegion].trim();

                    DayOfWeek dayOfWeek;
                    try {
                        dayOfWeek = DayOfWeek.valueOf(columns[idxDayOfWeek].trim().toUpperCase());
                    } catch (Exception e) { dayOfWeek = DayOfWeek.MONDAY; }

                    int hour = Integer.parseInt(columns[idxHour].trim());

                    String serviceId  = (idxServiceId  != -1 && idxServiceId  < columns.length) ? columns[idxServiceId].trim()  : null;
                    String consortium = (idxConsortium != -1 && idxConsortium < columns.length) ? columns[idxConsortium].trim() : null;

                    int        busLineCount  = Integer.parseInt(columns[idxBusLineCount].trim());
                    int        vehicleVolume = Integer.parseInt(columns[idxVehicleVolume].trim());
                    BigDecimal avgSpeed      = new BigDecimal(columns[idxAvgSpeed].trim());
                    int        speedLimit    = Integer.parseInt(columns[idxSpeedLimit].trim());

                    TrafficLevel trafficLevel;
                    try {
                        trafficLevel = TrafficLevel.valueOf(columns[idxTrafficLevel].trim().toUpperCase());
                    } catch (Exception e) { trafficLevel = TrafficLevel.MEDIUM; }

                    boolean eventNearby = Boolean.parseBoolean(columns[idxEventNearby].trim());

                    Weather weather;
                    try {
                        weather = Weather.valueOf(columns[idxWeather].trim().toUpperCase());
                    } catch (Exception e) { weather = Weather.SUNNY; }

                    LocalDateTime timestamp = null;
                    if (idxTimestamp != -1 && !columns[idxTimestamp].isBlank()) {
                        timestamp = LocalDateTime.parse(columns[idxTimestamp].trim(), FORMATTER);
                    }

                    BigDecimal latitude  = new BigDecimal(columns[idxLatitude].trim());
                    BigDecimal longitude = new BigDecimal(columns[idxLongitude].trim());

                    TrafficRecord record = TrafficRecord.of(
                            roadName, hour, roadTypeStr, region, dayOfWeek,
                            busLineCount, vehicleVolume, avgSpeed, speedLimit,
                            trafficLevel, eventNearby, weather,
                            latitude, longitude, serviceId, consortium
                    );

                    if (timestamp != null) record.setTimestamp(timestamp);

                    records.add(record);
                    count++;

                    if (records.size() >= batchSize) {
                        repository.saveAll(records);
                        savedCount += records.size();
                        records.clear();
                    }

                } catch (Exception e) {
                    if (count < 5) {
                        System.err.println("Error on line " + (count + 1) + ": " + e.getMessage());
                    }
                }
            }

            if (!records.isEmpty()) {
                repository.saveAll(records);
                savedCount += records.size();
            }
        }

        System.out.println("Import completed. Processed: " + count + " | Saved: " + savedCount);
        return savedCount;
    }

    public List<TrafficRecord> getUniqueStops() {
        return repository.findAll();
    }

    /**
     * Loads route geometries from GeoJSON file.
     * Used only as fallback when routes table is empty (local dev).
     */
    private JsonNode loadGeoJsonRoot() throws Exception {
        if (routesGeoJsonPath == null || routesGeoJsonPath.isBlank()) {
            throw new FileNotFoundException("No GeoJSON path configured.");
        }
        Resource resource = new FileSystemResource(routesGeoJsonPath);
        if (!resource.exists()) {
            throw new FileNotFoundException("Routes GeoJSON not found at: " + routesGeoJsonPath);
        }
        String fileContent = new String(resource.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        return objectMapper.readTree(fileContent);
    }

    public JsonNode getBusStops() throws Exception {
        Resource resource = new FileSystemResource(stopsGeoJsonPath);
        if (!resource.exists()) {
            throw new FileNotFoundException("Stops GeoJSON not found at: " + stopsGeoJsonPath);
        }
        String content = new String(resource.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        return objectMapper.readTree(content);
    }

    public List<String> getAvailableBusLines() {
        // Use DB if routes are imported
        if (routeRepository.count() > 0) {
            return routeRepository.findAll().stream()
                    .map(Route::getServico)
                    .distinct()
                    .sorted()
                    .toList();
        }
        // Fallback to GeoJSON file
        Set<String> uniqueServices = new HashSet<>();
        try {
            JsonNode root     = loadGeoJsonRoot();
            JsonNode features = root.get("features");
            if (features != null && features.isArray()) {
                for (JsonNode feature : features) {
                    JsonNode props = feature.get("properties");
                    if (props != null && props.has("servico")) {
                        String service = props.get("servico").asText();
                        if (service != null && !service.isBlank()) {
                            uniqueServices.add(service);
                        }
                    }
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
        return new ArrayList<>(uniqueServices).stream().sorted().toList();
    }

    /**
     * Returns route geometries as GeoJSON FeatureCollection.
     * Reads from the routes table in PostgreSQL.
     * Falls back to the GeoJSON file if the table is empty (local dev without import).
     */
    public ObjectNode getFilteredRoutes(String line, Integer hour) throws Exception {
        // Try database first
        long routeCount = routeRepository.count();
        if (routeCount > 0) {
            return getFilteredRoutesFromDb(line);
        }
        // Fallback to GeoJSON file (local dev)
        return getFilteredRoutesFromFile(line);
    }

    private ObjectNode getFilteredRoutesFromDb(String line) throws Exception {
        List<Route> routes = (line != null && !line.isEmpty())
                ? routeRepository.findByServico(line)
                : routeRepository.findAll();

        ArrayNode filteredFeatures = objectMapper.createArrayNode();

        for (Route route : routes) {
            ObjectNode feature    = objectMapper.createObjectNode();
            ObjectNode properties = objectMapper.createObjectNode();
            ObjectNode geometry   = objectMapper.createObjectNode();

            properties.put("servico",   route.getServico());
            properties.put("direcao",   route.getDirecao());
            properties.put("destino",   route.getDestino()   != null ? route.getDestino()   : "");
            properties.put("consorcio", route.getConsorcio() != null ? route.getConsorcio() : "");
            properties.put("tipo_rota", route.getTipoRota()  != null ? route.getTipoRota()  : "");

            geometry.put("type", "LineString");
            geometry.set("coordinates", objectMapper.readTree(route.getGeometry()));

            feature.put("type", "Feature");
            feature.set("properties", properties);
            feature.set("geometry",   geometry);

            filteredFeatures.add(feature);
        }

        ObjectNode responseRoot = objectMapper.createObjectNode();
        responseRoot.put("type", "FeatureCollection");
        responseRoot.set("features", filteredFeatures);
        return responseRoot;
    }

    private ObjectNode getFilteredRoutesFromFile(String line) throws Exception {
        if (routesGeoJsonPath == null || routesGeoJsonPath.isBlank()) {
            ObjectNode empty = objectMapper.createObjectNode();
            empty.put("type", "FeatureCollection");
            empty.set("features", objectMapper.createArrayNode());
            return empty;
        }
        JsonNode root     = loadGeoJsonRoot();
        JsonNode features = root.get("features");
        if (features == null || !features.isArray()) {
            throw new IllegalStateException("Invalid GeoJSON structure");
        }
        ArrayNode filteredFeatures = objectMapper.createArrayNode();
        for (JsonNode feature : features) {
            JsonNode props = feature.get("properties");
            if (props == null) continue;
            String serviceId = props.has("servico") ? props.get("servico").asText() : "";
            if (line != null && !line.isEmpty() && !serviceId.equals(line)) continue;
            filteredFeatures.add(feature);
        }
        ObjectNode responseRoot = objectMapper.createObjectNode();
        responseRoot.put("type", "FeatureCollection");
        responseRoot.set("features", filteredFeatures);
        return responseRoot;
    }

    @Transactional(readOnly = true)
    public List<RouteStatusDTO> getRouteStatusByHour(Integer hour) {
        List<Object[]> results = repository.findRouteSummaryByHour(hour);
        return results.stream().map(row -> new RouteStatusDTO(
                (String) row[0],
                (String) row[1],
                (String) row[2],
                (BigDecimal) row[3],
                (Number) row[4]
        )).toList();
    }

    public List<String> getDistinctServiceIds() {
        return repository.findDistinctServiceIds();
    }
}