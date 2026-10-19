-- Seul le créateur d'une équipe peut la supprimer — on garde une trace de qui l'a créée,
-- sans l'exposer dans l'API publique (voir routes/teams.ts, champ volontairement omis
-- des réponses GET).
ALTER TABLE teams ADD COLUMN created_by INT NULL AFTER color;
