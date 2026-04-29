package com.mtnrs.trafficinsight.model;

import jakarta.persistence.*;

/**
 * JPA entity for bus route geometries.
 * Replaces the GeoJSON file dependency — routes are stored in PostgreSQL
 * for cloud deployment compatibility.
 */
@Entity
@Table(name = "routes", indexes = {
        @Index(name = "idx_routes_servico",   columnList = "servico"),
        @Index(name = "idx_routes_direcao",   columnList = "direcao"),
        @Index(name = "idx_routes_consorcio", columnList = "consorcio")
})
public class Route {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "servico", nullable = false, length = 20)
    private String servico;

    @Column(name = "direcao", nullable = false)
    private Integer direcao = 0;

    @Column(name = "destino", length = 255)
    private String destino;

    @Column(name = "consorcio", length = 50)
    private String consorcio;

    @Column(name = "tipo_rota", length = 50)
    private String tipoRota;

    @Column(name = "extensao", precision = 12, scale = 2)
    private java.math.BigDecimal extensao;

    @Column(name = "shape_id", length = 50)
    private String shapeId;

    // GeoJSON LineString coordinates stored as compact JSON string
    // Example: [[-43.17,−22.90],[-43.18,−22.91],...]
    @Column(name = "geometry", nullable = false, columnDefinition = "TEXT")
    private String geometry;

    // ─── Constructors ─────────────────────────────────────────────────────────
    public Route() {}

    // ─── Getters ──────────────────────────────────────────────────────────────
    public Long    getId()       { return id; }
    public String  getServico()  { return servico; }
    public Integer getDirecao()  { return direcao; }
    public String  getDestino()  { return destino; }
    public String  getConsorcio(){ return consorcio; }
    public String  getTipoRota() { return tipoRota; }
    public java.math.BigDecimal getExtensao() { return extensao; }
    public String  getShapeId()  { return shapeId; }
    public String  getGeometry() { return geometry; }

    // ─── Setters ──────────────────────────────────────────────────────────────
    public void setId(Long id)             { this.id = id; }
    public void setServico(String s)       { this.servico = s; }
    public void setDirecao(Integer d)      { this.direcao = d; }
    public void setDestino(String d)       { this.destino = d; }
    public void setConsorcio(String c)     { this.consorcio = c; }
    public void setTipoRota(String t)      { this.tipoRota = t; }
    public void setExtensao(java.math.BigDecimal e) { this.extensao = e; }
    public void setShapeId(String s)       { this.shapeId = s; }
    public void setGeometry(String g)      { this.geometry = g; }
}
