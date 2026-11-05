-- Track delivery attempts so failed chaser notifications can retry safely.
ALTER TABLE chaser_queue ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
