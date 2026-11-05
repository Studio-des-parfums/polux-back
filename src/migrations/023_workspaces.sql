-- Espaces Polux : plusieurs instances de Polux (équipes, tâches, leads) dans une même base.
-- Chaque espace correspond à un projet de sdp_dashboard de même slug (projects.kind = 'polux') :
-- l'accès à un espace = l'accès à ce projet (user_projects, géré dans Admin → Utilisateurs).
-- Le Polux existant devient l'espace n°1, slug 'polux'. Une tâche ne change jamais d'espace.
CREATE TABLE workspaces (
  id INT AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(100) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  color VARCHAR(7) NOT NULL DEFAULT '#6366f1',
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO workspaces (id, slug, name) VALUES (1, 'polux', 'Polux');

-- Équipes : le slug n'est plus unique que dans son espace.
ALTER TABLE teams ADD COLUMN workspace_id INT NOT NULL DEFAULT 1 AFTER id;
ALTER TABLE teams DROP INDEX slug;
ALTER TABLE teams ADD UNIQUE KEY uq_teams_workspace_slug (workspace_id, slug);
ALTER TABLE teams ADD CONSTRAINT fk_teams_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE teams ALTER COLUMN workspace_id DROP DEFAULT;

ALTER TABLE tasks ADD COLUMN workspace_id INT NOT NULL DEFAULT 1 AFTER id;
ALTER TABLE tasks ADD CONSTRAINT fk_tasks_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE tasks ADD INDEX idx_tasks_workspace (workspace_id);
ALTER TABLE tasks ALTER COLUMN workspace_id DROP DEFAULT;

ALTER TABLE leads ADD COLUMN workspace_id INT NOT NULL DEFAULT 1 AFTER id;
ALTER TABLE leads ADD CONSTRAINT fk_leads_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE leads ADD INDEX idx_leads_workspace (workspace_id);
ALTER TABLE leads ALTER COLUMN workspace_id DROP DEFAULT;

-- Accès aux leads : par espace.
ALTER TABLE leads_access ADD COLUMN workspace_id INT NOT NULL DEFAULT 1 FIRST;
ALTER TABLE leads_access DROP PRIMARY KEY, ADD PRIMARY KEY (workspace_id, user_id);
ALTER TABLE leads_access ADD CONSTRAINT fk_leads_access_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE leads_access ALTER COLUMN workspace_id DROP DEFAULT;
