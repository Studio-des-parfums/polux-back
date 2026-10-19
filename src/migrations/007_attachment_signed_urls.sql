-- L'URL publique fixe n'a plus de sens : le préfixe polux/ n'est pas public, les URLs
-- sont désormais générées à la demande (pré-signées, durée limitée) depuis s3_key.
ALTER TABLE task_attachments DROP COLUMN url;
