package com.mtnrs.trafficinsight.repository;

import com.mtnrs.trafficinsight.model.Route;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * Spring Data repository for bus route geometries.
 */
@Repository
public interface RouteRepository extends JpaRepository<Route, Long> {

    /** Returns all route geometries for a given service ID (line number). */
    List<Route> findByServico(String servico);

    /** Returns all routes for a service ID and specific direction. */
    List<Route> findByServicoAndDirecao(String servico, Integer direcao);
}
