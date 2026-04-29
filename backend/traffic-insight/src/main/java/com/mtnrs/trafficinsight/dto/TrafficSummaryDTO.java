package com.mtnrs.trafficinsight.dto;

import java.math.BigDecimal;

public record TrafficSummaryDTO(
        String region,
        BigDecimal avgSpeed,
        Long avgVolume,
        Long totalRecords
) {}