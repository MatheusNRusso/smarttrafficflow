# ─── Build stage ──────────────────────────────────────────────────────────────
FROM eclipse-temurin:21-jdk-alpine AS build

WORKDIR /app

# Copy Maven wrapper and pom first for layer caching
COPY backend/traffic-insight/mvnw         ./mvnw
COPY backend/traffic-insight/.mvn         ./.mvn
COPY backend/traffic-insight/pom.xml      ./pom.xml

RUN chmod +x mvnw && ./mvnw dependency:go-offline -q

# Copy source
COPY backend/traffic-insight/src ./src

# Build — skip tests for faster deploy
RUN ./mvnw package -DskipTests -q

# ─── Runtime stage ────────────────────────────────────────────────────────────
FROM eclipse-temurin:21-jre-alpine

WORKDIR /app

# Copy jar from build stage
COPY --from=build /app/target/*.jar app.jar

# Expose port
EXPOSE 8080

# Run with production profile
ENTRYPOINT ["java", "-jar", "app.jar", "--spring.profiles.active=prod"]
