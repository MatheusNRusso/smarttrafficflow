# SmartTrafficFlow — Visualização de Tráfego de Ônibus do Rio de Janeiro

Aplicação web geoespacial full-stack para visualizar e simular o tráfego em tempo real das 511 linhas de ônibus do Rio de Janeiro. Desenvolvida com Java/Spring Boot, PostgreSQL, Deck.gl, MapLibre GL e Leaflet.

---

## Demo

**Landing:** https://smarttrafficflow-production.up.railway.app

**Mapa 3D:** https://smarttrafficflow-production.up.railway.app/index-3d.html

**Mapa 2D:** https://smarttrafficflow-production.up.railway.app/index-2d.html

---

## Screenshots

![Landing Page](docs/screenshot-landing-page.png)
*Landing page — visão geral do projeto com links para os dois mapas*

![Landing Page Features](docs/screenshot-landing-page-2.png)
*Seção de features — animação parada a parada, planejador de rotas e traffic insights*

![Landing Page Stack](docs/screenshot-landing-page-3.png)
*Stack tecnológica — Java, Spring Boot, PostgreSQL, Deck.gl, MapLibre, Leaflet e Python*

---

## Funcionalidades

- **Mapas 3D e 2D** — MapLibre GL + Deck.gl (3D) e Leaflet (2D)
- **Animação parada a parada** — ônibus percorre o trajeto real com pausas em cada parada
- **Câmera que acompanha** — o mapa segue o ônibus, libera ao arrastar manualmente
- **Planejador de rota (A a B)** — encontra linhas viáveis entre dois pontos por busca de texto ou clique no mapa
- **Painel de insights** — distribuição de níveis de tráfego e linhas mais congestionadas
- **Filtros por consórcio e linha** — Internorte, Intersul, Transcarioca, Santa Cruz, MobiRio
- **Modo escuro** — ambos os mapas suportam alternância entre tiles claro/escuro
- **Posicionamento correto das paradas** — filtro geométrico por produto vetorial garante paradas no lado correto do embarque
- **Suporte mobile** — layout responsivo, gestos de toque, botão de seguir ônibus

---

## Stack Tecnológica

| Camada | Tecnologia |
|---|---|
| Backend | Java 21, Spring Boot 3.5, PostgreSQL 15, Flyway |
| Frontend 3D | MapLibre GL, Deck.gl 8.9, JavaScript ES Modules |
| Frontend 2D | Leaflet 1.9, JavaScript ES Modules |
| Pipeline de dados | Python 3.11, GeoPandas, Shapely, NumPy |
| Geocodificação | Nominatim (OpenStreetMap) |
| Deploy | Docker, Railway |

---

## Arquitetura

```
┌─────────────────────────────────────────────────────┐
│                   Backend Spring Boot               │
│                                                     │
│  TrafficService      ← rotas + níveis de tráfego    │
│  LineStopsService    ← 511 linhas em cache memória  │
│  RouteFinderService  ← busca A→B com Haversine      │
│                                                     │
│  PostgreSQL ← dataset de tráfego enriquecido        │
│  GeoJSON    ← geometrias de rotas + paradas         │
└──────────────────────┬──────────────────────────────┘
                       │ REST API
        ┌──────────────┴──────────────┐
        │                             │
   Mapa 3D (MapLibre + Deck.gl)  Mapa 2D (Leaflet)
   main.js                       main-2d.js
   route-planner-3d.js           route-planner-2d.js
```

---

## Pipeline de Dados

O dataset foi construído a partir de dados abertos oficiais do Rio de Janeiro:

```
Datasets base (data/clean/):
  Rotas_Regulares_CLEAN.geojson    ← 989 geometrias de rotas com IDs de serviço
  Pontos_Paradas_CLEAN.geojson     ← 7.679 pontos de parada
  Logradouros_CLEAN.geojson        ← 242MB rede de ruas (limites de velocidade, bairros)

scripts/generate_lines_stops_vfinal.py
  ├── Buffer simétrico de 15m → 90.450 pares parada-rota candidatos
  ├── Filtro lado direito por produto vetorial → 30,4% removidos
  ├── Remoção de contaminação cross-line → 2.972 duplicatas removidas
  └── Paradas ordenadas pelo path → lines_with_stops_vfinal.json (~60.000 paradas)

scripts/generate_dataset.py
  ├── Usa os 3 datasets base
  ├── Infere bairro por correspondência de nome de rua (Logradouros)
  ├── Atribui níveis de tráfego por simulação de velocidade + volume
  └── CSV enriquecido → importado no PostgreSQL via /api/traffic/import
```

**Resultado:** 511 linhas (57 circulares, 454 ida/volta), ~60.000 paradas

---

## Decisões Técnicas

**Por que dois mapas?**
O mapa 3D com Deck.gl oferece visualização mais imersiva com inclinação e perspectiva. O 2D com Leaflet é mais leve e acessível em dispositivos móveis. Ambos compartilham o mesmo backend e lógica de negócio.

**Por que o filtro de lado direito?**
No Brasil o tráfego é pela mão direita. Sem o filtro, paradas do lado oposto da rua eram incluídas no dataset, fazendo o ônibus parar no lado errado. O produto vetorial entre o vetor de direção da rota e o vetor da parada determina o lado correto.

**Por que cache em memória para as paradas?**
O arquivo lines_with_stops_vfinal.json tem ~60.000 paradas. Carregar em memória no startup via @PostConstruct elimina latência de I/O por requisição e permite busca O(1) por linha.

**Por que migrar as rotas do GeoJSON para o PostgreSQL?**
O arquivo GeoJSON original tinha 32MB. Servir esse arquivo em cada requisição era inviável em produção. A migração para uma tabela routes no PostgreSQL com migração Flyway reduziu o tempo de resposta e viabilizou o deploy no Railway.

---

## Como Executar

### Pré-requisitos

- Java 21+
- Maven 3.9+
- PostgreSQL 15+
- Python 3.11+ com GeoPandas, Shapely, NumPy

### 1. Clonar o repositório

```bash
git clone https://github.com/MatheusNRusso/smarttrafficflow.git
cd smarttrafficflow
```

### 2. Configurar propriedades locais

Criar `backend/traffic-insight/src/main/resources/application-local.yaml` (não versionado):

```yaml
spring:
  datasource:
    url: jdbc:postgresql://localhost:5432/your_db_name
    username: seu_usuario
    password: sua_senha

traffic:
  geojson:
    routes: /caminho/para/Rotas_Regulares_CLEAN.geojson
    stops:  /caminho/para/Pontos_Paradas_CLEAN.geojson
```

### 3. Gerar o dataset de paradas

```bash
cd scripts/
python generate_lines_stops_vfinal.py \
  --routes /caminho/para/Rotas_Regulares_CLEAN.geojson \
  --stops  /caminho/para/Pontos_Paradas_CLEAN.geojson \
  --output ../backend/traffic-insight/src/main/resources/data/lines_with_stops_vfinal.json
```

### 4. Executar o backend

```bash
cd backend/traffic-insight
mvn spring-boot:run -Dspring-boot.run.profiles=local
```

### 5. Acessar a aplicação

| Mapa | URL |
|---|---|
| 3D (MapLibre + Deck.gl) | http://localhost:8080 |
| 2D (Leaflet) | http://localhost:8080/index-2d.html |

---

## Endpoints da API

| Método | Endpoint | Descrição |
|---|---|---|
| GET | `/api/traffic/routes` | Geometrias de todas as rotas (GeoJSON) |
| GET | `/api/traffic/status-by-hour?hour=8` | Níveis de tráfego por hora |
| GET | `/api/traffic/stops-by-line?line=232&direction=0` | Paradas ordenadas por linha/direção |
| GET | `/api/traffic/routes/between?latA=&lngA=&latB=&lngB=` | Planejador de rota A a B |
| GET | `/api/traffic/routes/nearby?lat=&lng=&radius=500` | Linhas próximas a um ponto |
| GET | `/api/traffic/summary/levels` | Distribuição de níveis de tráfego |

---

## Estrutura do Projeto

```
traffic-insight/
├── backend/
│   └── traffic-insight/
│       ├── src/main/java/          ← Aplicação Spring Boot
│       │   └── .../
│       │       ├── controller/     ← Controllers REST
│       │       ├── service/        ← Lógica de negócio
│       │       ├── dto/            ← Data Transfer Objects
│       │       ├── model/          ← Entidades JPA
│       │       └── repository/     ← Repositórios Spring Data
│       └── src/main/resources/
│           ├── static/             ← Frontend (HTML, CSS, JS)
│           │   ├── js/3d/          ← Módulos do mapa 3D
│           │   ├── js/2d/          ← Módulos do mapa 2D
│           │   └── js/core/        ← Módulos compartilhados
│           └── db/migration/       ← Migrações SQL do Flyway
├── docs/                           ← Screenshots
└── scripts/                        ← Pipeline de dados Python
    ├── generate_lines_stops_vfinal.py
    └── generate_dataset.py
```

---

## Licença

MIT