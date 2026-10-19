-- Trace les alertes de deadline déjà envoyées par tâche (J-1 et jour J), pour que le
-- cron ne renvoie pas le même email à chaque passage.
CREATE TABLE task_deadline_alerts_sent (
  task_id INT NOT NULL,
  alert_type ENUM('day_before', 'due_day') NOT NULL,
  sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (task_id, alert_type),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
