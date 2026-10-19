-- Le "projet" d'une tâche redevient un simple texte libre (étiquette), pas une entité
-- gérée séparément — remplace la relation project_id (table projects) par un champ texte.
ALTER TABLE tasks DROP FOREIGN KEY tasks_project_fk;
ALTER TABLE tasks DROP COLUMN project_id;
ALTER TABLE tasks ADD COLUMN project_name VARCHAR(200) NULL AFTER team_id;
