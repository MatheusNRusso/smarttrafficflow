package com.mtnrs.trafficinsight.dto;

import java.math.BigDecimal;

public record HeatmapPointDTO(
        BigDecimal latitude,
        BigDecimal longitude,
        Integer intensity,
        BigDecimal speed
) {}