-- Client (lead/prospect) rattaché à une tâche — optionnel. Supprimer le lead détache la tâche.
ALTER TABLE tasks ADD COLUMN lead_id INT NULL AFTER team_id;
ALTER TABLE tasks ADD CONSTRAINT fk_tasks_lead FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;
