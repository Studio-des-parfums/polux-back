-- Date de fin des espaces créés à la volée (NULL pour les équipes officielles) — à
-- expiration le front propose de prolonger (PATCH end_date) ou de supprimer (DELETE /teams/:id).
ALTER TABLE teams ADD COLUMN end_date DATE NULL AFTER color;
