-- Responsable d'une équipe (users.id de la base sdp_dashboard — pas de clé étrangère inter-bases).
ALTER TABLE teams ADD COLUMN manager_user_id INT NULL AFTER color;
