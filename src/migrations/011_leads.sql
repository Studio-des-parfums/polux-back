-- Suivi des appels entrants (particuliers et professionnels), de l'appel initial jusqu'à
-- la venue sur place ou l'abandon. Pipeline indépendant de celui des tâches (tasks.status).

CREATE TABLE leads (
  id INT AUTO_INCREMENT PRIMARY KEY,
  contact_type ENUM('particulier', 'professionnel') NOT NULL DEFAULT 'particulier',
  last_name VARCHAR(150) NOT NULL,
  first_name VARCHAR(150) NOT NULL,
  phone VARCHAR(50) NOT NULL,
  email VARCHAR(255) NOT NULL DEFAULT '',
  company VARCHAR(200) NULL,
  info TEXT,
  project_name VARCHAR(200) NOT NULL DEFAULT '',
  project_date DATETIME NULL,
  first_deposit_date DATETIME NULL,
  second_deposit_date DATETIME NULL,
  status ENUM('nouveau', 'a_relancer', 'acompte_1_recu', 'acompte_2_recu', 'confirme', 'realise', 'perdu') NOT NULL DEFAULT 'nouveau',
  call_date DATETIME NOT NULL,
  next_follow_up_at DATETIME NULL,
  assigned_to_id INT NULL,
  created_by INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_leads_status (status),
  INDEX idx_leads_assigned_to (assigned_to_id),
  INDEX idx_leads_next_follow_up (next_follow_up_at)
);

CREATE TABLE lead_interactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  lead_id INT NOT NULL,
  author_id INT NOT NULL,
  body TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
);

-- Qui peut accéder à l'espace Leads/Prospects, sur le même principe que team_members
-- mais pour un espace unique (pas de notion d'équipe). Les admins y ont accès de toute
-- façon (vérifié côté applicatif via req.sdpUser.role_name, pas stocké ici).
CREATE TABLE leads_access (
  user_id INT NOT NULL PRIMARY KEY,
  added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
