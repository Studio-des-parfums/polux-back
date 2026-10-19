-- Une tâche peut être assignée à plusieurs personnes — remplace la colonne assigned_to
-- unique par une table de liaison.
CREATE TABLE task_assignees (
  task_id INT NOT NULL,
  user_id INT NOT NULL,
  PRIMARY KEY (task_id, user_id),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

INSERT INTO task_assignees (task_id, user_id)
SELECT id, assigned_to FROM tasks WHERE assigned_to IS NOT NULL;

ALTER TABLE tasks DROP COLUMN assigned_to;
