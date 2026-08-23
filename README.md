# GeoRumble

Collaborative geography quiz for Discord voice channels — a multiplayer map game where players
identify regions together. Built as a [Discord Activity](https://docs.discord.com/developers/activities/overview).

## Layout

- `client/` — Vite + TypeScript app rendered inside the Discord Activity iframe
- `worker/` — Cloudflare Worker serving the app, OAuth token exchange, future multiplayer relay
- `shared/` — protocol types shared across the network boundary

## Development (Docker, no local Node required)

```sh
copy example.env .env        # fill in your Discord app credentials
docker compose up --build
```

- App: http://localhost:8787 (Worker + built client)
- Public HTTPS for Discord: printed by the `tunnel` service (trycloudflare URL) — put it under
  Activities → URL Mappings in the [Developer Portal](https://discord.com/developers/applications)

## Deploy

```sh
cd worker && wrangler deploy
```
