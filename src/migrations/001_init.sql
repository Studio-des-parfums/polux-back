-- Schéma initial de la base polux. Les user_id référencés ici (team_members.user_id,
-- tasks.assigned_to/created_by, comments.user_id, attachments.uploaded_by) pointent vers
-- la table `users` de la base sdp_dashboard — pas de clé étrangère inter-bases, juste une
-- convention d'id partagée, vérifiée côté applicatif via requireUser.ts.

CREATE TABLE teams (
  id INT AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(100) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  color VARCHAR(7) NOT NULL DEFAULT '#6366f1',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE team_members (
  team_id INT NOT NULL,
  user_id INT NOT NULL,
  added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (team_id, user_id),
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
);

CREATE TABLE projects (
  id INT AUTO_INCREMENT PRIMARY KEY,
  team_id INT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  color VARCHAR(7) NOT NULL DEFAULT '#6366f1',
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL
);

CREATE TABLE tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  project_id INT NULL,
  team_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  assigned_to INT NULL,
  created_by INT NOT NULL,
  priority ENUM('basse', 'moyenne', 'haute', 'urgente') NOT NULL DEFAULT 'moyenne',
  status ENUM('a_faire', 'en_cours', 'en_revision', 'termine') NOT NULL DEFAULT 'a_faire',
  deadline DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  INDEX idx_tasks_assigned_to (assigned_to),
  INDEX idx_tasks_team_id (team_id),
  INDEX idx_tasks_project_id (project_id),
  INDEX idx_tasks_deadline (deadline)
);

CREATE TABLE task_reminders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  task_id INT NOT NULL,
  remind_at DATETIME NOT NULL,
  sent BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  INDEX idx_reminders_pending (sent, remind_at)
);

CREATE TABLE task_attachments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  task_id INT NOT NULL,
  filename VARCHAR(255) NOT NULL,
  s3_key VARCHAR(500) NOT NULL,
  url VARCHAR(1000) NOT NULL,
  content_type VARCHAR(150) NOT NULL,
  size INT NOT NULL,
  uploaded_by INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE task_comments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  task_id INT NOT NULL,
  user_id INT NOT NULL,
  body TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE task_comment_mentions (
  comment_id INT NOT NULL,
  mentioned_user_id INT NOT NULL,
  PRIMARY KEY (comment_id, mentioned_user_id),
  FOREIGN KEY (comment_id) REFERENCES task_comments(id) ON DELETE CASCADE
);

-- Notifications internes à Polux (mention en commentaire, ou "notifier toute l'équipe").
-- Reste séparé de la table `notifications` de sdp_dashboard pour ne pas coupler les deux
-- bases en écriture ; une passerelle optionnelle pourra miroiter ces lignes plus tard
-- vers sdp_dashboard.notifications (type 'polux_mention') pour remonter dans la cloche globale.
CREATE TABLE task_notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  task_id INT NOT NULL,
  comment_id INT NULL,
  recipient_user_id INT NOT NULL,
  from_user_id INT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (comment_id) REFERENCES task_comments(id) ON DELETE CASCADE,
  INDEX idx_notifications_recipient (recipient_user_id, is_read)
);
