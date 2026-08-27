# Sparxie Staff Applications

Discord OAuth staff application website.

## Render environment variables

- `PUBLIC_URL` — deployed site URL, e.g. `https://your-service.onrender.com`
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `SESSION_SECRET` — long random secret
- `DATABASE_URL` — optional PostgreSQL/Neon connection string for persistent applications and reviewer settings
- `OWNER_IDS` — optional comma-separated Discord user IDs with permanent owner access

## Discord OAuth redirect URL

`https://YOUR_PUBLIC_URL/oauth/callback`

The app uses Discord `identify` and `guilds` OAuth scopes. Server owners and members with Manage Server can open reviewer settings and choose which Discord user IDs can review applications.

## Render

Build command: `npm install`

Start command: `npm start`

Health check: `/health`

Without `DATABASE_URL`, data is temporary and may reset after a Render restart/redeploy. Use Neon/Postgres for persistence.