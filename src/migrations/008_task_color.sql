-- Couleur libre sur la tâche (palette fixe côté front), affichée dans le calendrier
-- (fond de la barre) et en rond dans le tableau.
ALTER TABLE tasks ADD COLUMN color VARCHAR(7) NULL AFTER priority;
