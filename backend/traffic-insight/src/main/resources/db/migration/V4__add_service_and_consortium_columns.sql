ALTER TABLE traffic_records
ADD COLUMN service_id VARCHAR(20),
ADD COLUMN consortium VARCHAR(50);

CREATE INDEX idx_traffic_service_id ON traffic_records(service_id);
CREATE INDEX idx_traffic_consortium ON traffic_records(consortium);