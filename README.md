# Sparxie Forms

A Discord-connected web app for staff applications, appeals and custom server forms.

## Features

- Discord OAuth login
- Server owner/admin dashboard
- Staff Application, Appeal and Custom form types
- Default questions that can be edited, removed or expanded
- Public shareable form links
- Discord-linked member submissions
- Per-form reviewer user permissions
- Optional reviewer role permissions when `DISCORD_BOT_TOKEN` is configured
- Pending / approved / denied review workflow
- PostgreSQL persistence when `DATABASE_URL` is configured

## Render environment variables

Required:

- `PUBLIC_URL` — your deployed HTTPS URL, for example `https://your-app.onrender.com`
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `SESSION_SECRET` — a long random string

Recommended:

- `DATABASE_URL` — Render/Neon PostgreSQL connection URL for persistent forms and submissions
- `DISCORD_BOT_TOKEN` — enables selecting Discord roles as reviewers and checking role membership

## Discord OAuth redirect URL

In the Discord Developer Portal, add exactly:

`https://YOUR-APP.onrender.com/oauth/callback`

The value must match `PUBLIC_URL`.
