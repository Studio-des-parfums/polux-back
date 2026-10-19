-- Une tâche peut être créée directement sur une équipe, sans projet (texte libre,
-- pas de projet imposé) — le projet reste disponible pour qui veut grouper ses tâches.
ALTER TABLE tasks DROP FOREIGN KEY tasks_ibfk_1;
ALTER TABLE tasks MODIFY project_id INT NULL;
ALTER TABLE tasks ADD CONSTRAINT tasks_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
