package com.mtnrs.trafficinsight.dto;

import java.math.BigDecimal;

public record RouteStatusDTO(
        String routeId,
        String consortium,
        String trafficLevel,
        BigDecimal avgSpeed,
        Number recordCount

) {
}
