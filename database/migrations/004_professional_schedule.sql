ALTER TABLE service_professionals ADD COLUMN buffer_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE service_professionals ADD COLUMN days_off_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE service_professionals ADD COLUMN schedule_revision INTEGER NOT NULL DEFAULT 1;
