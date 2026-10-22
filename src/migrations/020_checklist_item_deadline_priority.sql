-- Échéance et priorité propres à chaque étape de checklist (NULL : non renseignées).
-- Si l'étape est confiée (linked_task_id), elles sont synchronisées avec la tâche liée.
ALTER TABLE task_checklist_items
  ADD COLUMN deadline DATETIME NULL AFTER done,
  ADD COLUMN priority ENUM('basse', 'moyenne', 'haute', 'urgente') NULL AFTER deadline;
