-- Sous-tâches (checklist) d'une tâche. Quand tous les items d'une tâche sont cochés,
-- la tâche passe automatiquement en statut 'termine' (voir routes/tasks.ts).
CREATE TABLE task_checklist_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  task_id INT NOT NULL,
  label VARCHAR(255) NOT NULL,
  done BOOLEAN NOT NULL DEFAULT FALSE,
  position INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  INDEX idx_task_checklist_items_task_id (task_id)
);
