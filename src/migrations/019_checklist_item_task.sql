-- Une étape de checklist peut être confiée à une équipe ou à des personnes : elle devient alors
-- une tâche à part entière (linked_task_id), visible dans l'espace concerné. Terminer cette tâche
-- coche l'étape, et inversement (voir routes/tasks.ts).
ALTER TABLE task_checklist_items ADD COLUMN linked_task_id INT NULL AFTER done;
ALTER TABLE task_checklist_items ADD CONSTRAINT fk_checklist_linked_task FOREIGN KEY (linked_task_id) REFERENCES tasks(id) ON DELETE SET NULL;
