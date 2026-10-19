-- La notion de projet géré séparément est abandonnée au profit d'un simple champ texte
-- libre sur la tâche (tasks.project_name, voir 004) — la table n'a plus de référence.
DROP TABLE IF EXISTS projects;
