# GeoRumble

Collaborative Seterra-style geography quiz for Discord voice channels — everyone in the call
hunts the same region at once, with live cursors, a per-player scoreboard, and Seterra-style
helpers. Built as a [Discord Activity](https://docs.discord.com/developers/activities/overview);
also playable in a plain browser (solo practice, or shared rooms via join codes).

## Layout

- `client/` — Vite + TypeScript app (Discord iframe or browser)
- `worker/` — Cloudflare Worker: static assets, OAuth exchange, WebSocket relay
  (`GameRoom` Durable Object per voice channel, `RoomBroker` capacity gate)
- `shared/` — protocol + mappack contracts shared across the network boundary
- `assets/mappacks/` — quiz packs as pure data (`us-states`, `europe`)
- `docs/` — [architecture](docs/../ARCHITECTURE.md) and the [mappack contract](docs/mappack-contract.md)

## Gameplay

Co-op rounds: the host picks a pack (or everyone nominates one and the relay rolls a weighted
random winner with a reveal animation), the relay holds a deterministic shuffled order, and every
client derives the same prompt. Clicks echo live; the hosting client adjudicates and the relay
verifies. Found states tint by how many wrong attempts it took to find them, names flash on
click, tiny regions auto-frame, and hints fire after repeated misses (host can disable them per
round). Anyone can call a unanimous vote to bring the room back to the map picker. Victory shows
time, accuracy, a per-player scoreboard with Discord avatars, a weighted "who carried" wheel, and
personal bests per pack.

## Development (Docker, no local Node required)

```sh
copy example.env .env        # fill in your Discord app credentials
docker compose up --build
```

- App: http://localhost:8787 (Worker + built client)
- Public HTTPS for Discord: printed by the `tunnel` service (trycloudflare URL) — put it under
  Activities → URL Mappings in the [Developer Portal](https://discord.com/developers/applications)
- Browser play works immediately at the tunnel URL (solo, or share a join code)

Native WSL alternative: `npm run install:all && npm --prefix client run build && npm --prefix worker run dev`.

After changing the relay contract, prove it on the wire — unit tests can't
catch a field the snapshot serializer forgot:

```sh
npm run verify:room                          # against production
node scripts/verify-room.mjs ws://localhost:8787/api/room   # against local dev
```

## Map packs

```sh
npm run packs:build      # re-derive both packs from public-domain atlases
npm run packs:validate   # contract-check every pack
```

Adding a pack = a builder script's two artifacts plus one entry in `client/src/game/packs.ts`.
No engine changes. See `docs/mappack-contract.md`.

## Deploy

```sh
cd worker && wrangler deploy
```

Secrets: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`; optional `DISCORD_BOT_TOKEN` (enables
instance verification), `OPEN_ROOMS=1` (enables browser code rooms), `LIMITS_KV` +
`CF_ACCOUNT_ID`/`CF_API_TOKEN` (dynamic capacity ceiling). Legal pages for the Discord portal
live at `/privacy` and `/terms`.

### Discord portal requirements

- **OAuth2 → Redirects must list the activity URL** (e.g. `https://<activity-host>/`). The
  client's authorize bridge sends no `redirect_uri` of its own, and Discord rejects the
  sign-in with `invalid_request: Missing "redirect_uri" in request` when the app registers
  none.
- Scopes requested: `identify` + `guilds.members.read` (the latter resolves each player's
  server nickname and server-specific avatar; sign-in falls back to the global profile if
  it is declined).
- Store art lives in `assets/brand/store/` — see its README for which file uploads to which
  portal field.
