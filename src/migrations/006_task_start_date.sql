-- Une tâche peut avoir une date de début optionnelle, en plus de l'échéance (deadline).
ALTER TABLE tasks ADD COLUMN start_date DATETIME NULL AFTER description;
