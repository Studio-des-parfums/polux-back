-- Équipes "officielles" (ex: Informatique) : créées par défaut, ne peuvent pas être
-- supprimées même par qui les a créées (voir DELETE /teams/:id).
ALTER TABLE teams ADD COLUMN is_official BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE teams SET name = 'Informatique', slug = 'informatique', is_official = TRUE WHERE slug = 'developpement-web';
