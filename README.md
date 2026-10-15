# polux-back

Backend de Polux (gestion de projets/tâches), séparé de `sdp-dashboard`. Express + MySQL (mysql2) + S3, même style que les autres backends SDP (aglae-back, ninno backend).

## Stack

- Express + TypeScript (`tsx watch` en dev)
- MySQL dédié (`polux`), tables teams/projects/tasks/comments/attachments/notifications
- Lecture seule sur la base `sdp_dashboard` (table `users`) pour l'identité — pas de JWT dans ce système, auth par header `x-user-email` comme le reste du dashboard
- AWS S3 (même bucket que sdp-dashboard, préfixe `polux/`)
- `node-cron` pour l'envoi des rappels de deadline

## Setup

```sh
npm install
cp .env.example .env   # renseigner DB_*, SDP_DB_*, AWS_*
npm run migrate        # crée la base `polux` et les tables
npm run dev             # démarre sur le port 3002
```

## Endpoints

Toutes les routes `/api/*` nécessitent le header `x-user-email` d'un utilisateur actif de `sdp_dashboard`.

- `GET/POST /api/teams`, `POST /api/teams/:id/members`, `DELETE /api/teams/:id/members/:userId`
- `GET/POST/PUT /api/projects/:id?`
- `GET/POST/PUT/DELETE /api/tasks/:id?`
- `POST /api/tasks/:id/reminders`
- `POST /api/tasks/:id/comments` (body: `{ body, mentioned_user_ids }`)
- `POST /api/tasks/:id/notify-team` (body: `{ team_member_ids, comment_id }`)
- `POST /api/tasks/:id/attachments` (multipart, champ `file`) / `DELETE /api/attachments/:id`
- `GET /api/notifications`, `GET /api/notifications/unread-count`, `PUT /api/notifications/:id/read`, `PUT /api/notifications/read-all`
- `GET /api/users` (liste des users actifs de sdp_dashboard, pour peupler assignation/mentions)

## Côté front (sdp-dashboard)

Définir `VITE_POLUX_API_URL=http://localhost:3002/api` (ou l'URL de déploiement) dans `sdp-dashboard/.env` pour que `src/api/poluxClient.ts` bascule du mock vers ce backend.
