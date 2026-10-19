-- Nouvelles équipes officielles : Design (webdesign/graphistes) et Logistique.
INSERT INTO teams (slug, name, color, is_official)
VALUES ('design', 'Design', '#ec4899', TRUE)
ON DUPLICATE KEY UPDATE name = VALUES(name), is_official = TRUE;

INSERT INTO teams (slug, name, color, is_official)
VALUES ('logistique', 'Logistique', '#22c55e', TRUE)
ON DUPLICATE KEY UPDATE name = VALUES(name), is_official = TRUE;
