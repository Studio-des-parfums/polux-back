-- Notifications typées avec un message lisible (affichées dans la cloche du dashboard).
-- from_user_id devient optionnel (notifications automatiques : échéances, rappels).
-- Conservation : 30 jours (purge quotidienne, voir services/notify.ts).
ALTER TABLE task_notifications
  MODIFY from_user_id INT NULL,
  ADD COLUMN type VARCHAR(40) NOT NULL DEFAULT 'assigned' AFTER from_user_id,
  ADD COLUMN message VARCHAR(500) NOT NULL DEFAULT '' AFTER type,
  ADD INDEX idx_notifications_created (created_at);

UPDATE task_notifications SET type = 'mention' WHERE comment_id IS NOT NULL;
UPDATE task_notifications n JOIN tasks t ON t.id = n.task_id
SET n.message = CONCAT(IF(n.type = 'mention', 'Mention dans « ', 'Tâche « '), t.title, ' »')
WHERE n.message = '';
