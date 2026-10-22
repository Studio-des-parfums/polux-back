-- Design devient Graphisme (slug compris, pour rester cohérent avec slugify()).
UPDATE teams SET name = 'Graphisme', slug = 'graphisme' WHERE slug = 'design';

-- Nouvelles équipes officielles. Si un espace temporaire portait déjà ce slug, il devient officiel.
INSERT INTO teams (slug, name, color, is_official)
VALUES
  ('communication-marketing', 'Communication/Marketing', '#f59e0b', TRUE),
  ('laboratoire', 'Laboratoire', '#06b6d4', TRUE),
  ('accueil', 'Accueil', '#a855f7', TRUE),
  ('comptabilite-finance', 'Comptabilité/Finance', '#64748b', TRUE),
  ('commercial', 'Commercial', '#ef4444', TRUE)
ON DUPLICATE KEY UPDATE name = VALUES(name), is_official = TRUE, end_date = NULL;
