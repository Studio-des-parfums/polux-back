-- Tâches personnelles : non rattachées à une équipe, visibles uniquement par qui les a
-- créées (voir GET /tasks, filtré par owner_id côté serveur).
ALTER TABLE tasks DROP FOREIGN KEY tasks_ibfk_2;
ALTER TABLE tasks MODIFY team_id INT NULL;
ALTER TABLE tasks ADD CONSTRAINT tasks_team_fk FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
ALTER TABLE tasks ADD COLUMN owner_id INT NULL AFTER created_by;
ALTER TABLE tasks ADD INDEX idx_tasks_owner_id (owner_id);
