# Discord Activities (Embedded App SDK) — Research Notes

Researched 2026-08-22 against official Discord developer docs (docs.discord.com — the old `discord.com/developers/docs` URLs 301-redirect there) and the `@discord/embedded-app-sdk` package itself (v2.5.0, inspected from the npm tarball). Each claim carries its source inline. Points where the docs are silent or self-contradictory are called out explicitly in [§9](#9-ambiguities-and-open-questions).

---

## 1. How Activities embed in voice channels

**An Activity is a web app in an iframe.** "Activities are web apps hosted in an iframe that use the Embedded App SDK to communicate with Discord clients." They run "in an iframe in Discord on desktop, mobile, and web." The iframe talks to the Discord client over the `postMessage` protocol; the SDK manages that protocol for you.
- <https://docs.discord.com/developers/activities/overview>
- <https://docs.discord.com/developers/activities/how-activities-work>

**Launch surfaces.** "They can be launched in channels, DMs, or from the App Launcher with no external window or separate download required." "Players can jump in together with friends already in a voice channel." The docs say "channels" generically (voice and text both work); group DMs are supported at the API level (`getChannel` returns GDMs) but need the `dm_channels.read` scope, which "requires approval from Discord."
- <https://docs.discord.com/developers/platform/activities>
- <https://docs.discord.com/developers/developer-tools/embedded-app-sdk> (getChannel scopes)

**Launch mechanisms (two):**
1. **Entry Point command** — "Activities are primarily opened when users invoke your app's Entry Point command in the App Launcher." Enabling Activities auto-creates a default command named "Launch", and Discord "automatically handles opening your Activity" when it runs.
2. **Interaction response** — from a command, message component, or modal submission interaction, respond with callback type `LAUNCH_ACTIVITY` (type `12`).
- <https://docs.discord.com/developers/activities/how-activities-work>

**Instances — the multiplayer unit.** When friends join the same activity they share "an **application instance**" (the same shared data). `discordSdk.instanceId` is "available as soon as the SDK is constructed" (no `ready()` needed). "Instance IDs are generated when a user launches an application"; everyone who joins that session "will receive the same `instanceId`". "Activities close when the last participant in the Activity leaves it"; a relaunch is "a different instance and could have different participants." Use `instanceId` "as a key to save and load the shared data."
- <https://docs.discord.com/developers/activities/development-guides/multiplayer-experience>
- <https://docs.discord.com/developers/activities/design-patterns>

**Who can see/join.** Anyone in the channel can open the App Launcher and join the running instance (mid-session joins are expected: "users will join mid-experience", and users "can leave without notice or become afk"). Users who are in the call but not playing should be able to "spectate". Multiple different Activities can run simultaneously in the same voice channel (official Discord blog).
- <https://docs.discord.com/developers/activities/design-patterns>
- <https://discord.com/blog/server-activities-games-voice-watch-together>

**How many players?** No hard-coded per-activity cap is documented: "While you can set a 'max participants' suggestion to users … the only real limit is the number of people who can join a Voice call." Design guidance: "Be aware of how your Activity will behave when there are 25 or more people in the call," and note "small group sessions (3–8 people) show more engagement and retention." The channel's own `user_limit` is exposed via `getChannel`.
- <https://docs.discord.com/developers/activities/design-patterns>
- <https://docs.discord.com/developers/developer-tools/embedded-app-sdk>

**Lifecycle (6 steps):** initialization (iframe loads with unique query params) → handshake (`ready()` resolves after the `[FRAME, {evt: 'READY'}]` payload) → authorization/authentication (scopes) → client interaction (commands/events; out-of-scope calls error) → disconnection/errors (client sends `[CLOSE, {message, code}]`) → app-initiated close (`discordSdk.close(code, message)`; a code other than `CLOSE_NORMAL` shows the message to the user).
- <https://docs.discord.com/developers/activities/how-activities-work>

---

## 2. OAuth2 flow for Embedded Apps

The embedded-app flow is the standard OAuth2 authorization-code grant, except the SDK performs the "redirect" internally (no browser navigation) and hands your app a `code` directly.

**Step 1 — client asks Discord for a code** (inside the iframe, after `ready()`):

```js
const { code } = await discordSdk.commands.authorize({
  client_id: DISCORD_CLIENT_ID,
  response_type: 'code',
  state: '',
  prompt: 'none',
  scope: ['identify', 'applications.commands'],
});
```

`prompt: 'none'` skips the consent screen for already-granted scopes. `AuthorizeRequest` also supports `code_challenge` / `code_challenge_method: 'S256'` (PKCE) per the SDK type definitions. `AuthorizeResponse` is `{ code: string }`.
- <https://docs.discord.com/developers/developer-tools/embedded-app-sdk> (authorize command)
- SDK v2.5.0 `Discord.d.ts` (`AuthorizeRequest`)

**Step 2 — your backend exchanges the code for a token.** Official starter code (`discord/getting-started-activity`, `server/server.js`):

```js
app.post("/api/token", async (req, res) => {
  const response = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.VITE_DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code: req.body.code,
    }),
  });
  const { access_token } = await response.json();
  res.send({ access_token });
});
```

OAuth2 reference details:
- The token URL is `https://discord.com/api/oauth2/token`; "the token and token revocation URLs will **only** accept a content type of `application/x-www-form-urlencoded`."
- "All calls to the OAuth2 endpoints require either HTTP Basic authentication or `client_id` and `client_secret` supplied in the form data body."
- Required fields for the code grant: `grant_type` ("must be set to `authorization_code`"), `code`, `redirect_uri` ("the `redirect_uri` associated with this authorization").
- <https://docs.discord.com/developers/topics/oauth2>
- <https://raw.githubusercontent.com/discord/getting-started-activity/main/server/server.js>

> **Discrepancy (documented, not a guess):** the OAuth2 reference lists `redirect_uri` as required, but Discord's own Activity starter omits it and still works. For an Activity, the redirect is handled by the SDK/portal rather than a real redirect, so treat `redirect_uri` as "send it if the API rejects the exchange" — the official Activity tutorial is the working reference. The tutorial also says to add a placeholder redirect URI (`https://127.0.0.1`) in the portal because "the Embedded App SDK handles the actual redirect when the `authorize` command is called."
> - <https://docs.discord.com/developers/topics/oauth2>
> - <https://docs.discord.com/developers/activities/building-an-activity>

**Step 3 — authenticate the SDK with the token:**

```js
const auth = await discordSdk.commands.authenticate({ access_token });
```

`AuthenticateResponse`: `{ access_token: string, user: User, scopes: string[], expires: string, application: { id, description, name, icon?, rpc_origins? } }`. The `user` object is the current user (`id`, `username`, `discriminator`, `global_name?`, `avatar?`, `public_flags`).
- <https://docs.discord.com/developers/developer-tools/embedded-app-sdk>
- SDK v2.5.0 `Discord.d.ts` (authenticate response)

**Token response shape** (from the token endpoint, per OAuth2 docs):

```json
{
  "access_token": "an-access-token",
  "token_type": "Bearer",
  "expires_in": 604800,
  "refresh_token": "a-refresh-token",
  "scope": "identify"
}
```

`expires_in` is seconds; the example shows 604800 (7 days). Refresh with `grant_type=refresh_token` + `refresh_token`. Revoke via `https://discord.com/api/oauth2/token/revoke`.
- <https://docs.discord.com/developers/topics/oauth2>

**Scopes relevant to GeoRush** (descriptions quoted from the OAuth2 scope table; scope list cross-checked against SDK v2.5.0's `OAuthScopes` union):
- `identify` — "allows /users/@me without email". Needed to identify the local player. Required by `userSettingsGetLocale` and `CURRENT_USER_UPDATE` event.
- `applications.commands` — "allows your app to add commands to a guild - included by default with the bot scope". Requested by the official Activity tutorial.
- `guilds` — "allows /users/@me/guilds …"; also the scope required by `getChannel` for guild channels.
- `guilds.members.read` — guild-specific nickname/avatar; note it "only grants the information for that instance of the application's user".
- `rpc.voice.read` — needed for `VOICE_STATE_UPDATE` / `SPEAKING_START` / `SPEAKING_STOP`; per the OAuth2 docs this is "only available to approved partners" — do not rely on it.
- `dm_channels.read` — needed for `getChannel` in GDMs; "requires approval from Discord".
- `activities.write` is "NOT REQUIRED FOR GAMESDK ACTIVITY MANAGER" — you do not need activity scopes just to run an Activity.
- <https://docs.discord.com/developers/topics/oauth2>
- <https://docs.discord.com/developers/developer-tools/embedded-app-sdk> (per-command scope table)
- <https://docs.discord.com/developers/activities/development-guides/multiplayer-experience>

---

## 3. @discord/embedded-app-sdk

Version inspected: **2.5.0** (npm, 2026-08-22). All type shapes below were read from the package's `.d.ts` files, cross-checked with the official reference page.

**Setup:**

```bash
npm install @discord/embedded-app-sdk
```

```js
import { DiscordSDK, Events, type Types } from '@discord/embedded-app-sdk';

const discordSdk = new DiscordSDK(import.meta.env.VITE_DISCORD_CLIENT_ID);
await discordSdk.ready(); // resolves when the app has connected to the Discord client
```

Constructor options (SDK v2.5.0): `{ disableConsoleLogOverride: boolean }` — set `true` to stop the SDK forwarding `console.*` to the Discord client (avoids log loops inside `handleMessage`).
- <https://docs.discord.com/developers/developer-tools/embedded-app-sdk>
- <https://docs.discord.com/developers/activities/development-guides/local-development>
- SDK v2.5.0 `Discord.d.ts`

**Properties available immediately after construction** (before `ready()`): `clientId`, `instanceId`, `customId`, `referrerId`, `platform` (`'web' | 'ios' | 'android'`), `guildId`, `channelId`, `locationId`, `sdkVersion`, `mobileAppVersion`, `configuration`, `commands`.
- SDK v2.5.0 `Discord.d.ts` / `interface.d.ts`

**Key commands** (full table in the reference; the ones GeoRush needs):

| Command | Args → Response | Scopes | Notes |
|---|---|---|---|
| `authenticate` | `{access_token?}` → `{access_token, user, scopes, expires, application}` | none | call after token exchange |
| `authorize` | `{client_id, scope, response_type?, state?, prompt?, code_challenge?, code_challenge_method?}` → `{code}` | none | opens the consent modal |
| `getInstanceConnectedParticipants` | `void` → `{participants: User[]}` | none | everyone connected to *this instance* |
| `getChannel` | `{channel_id}` → channel incl. `voice_states: UserVoiceState[]` | `guilds` (guild channels); `+ dm_channels.read` for GDMs | `voice_states` covers **everyone in the voice channel**, not just activity players |
| `getChannelPermissions` | `void` → `permissions: bigint \| string` | `guilds.members.read` | |
| `openInviteDialog` | `void` → `void` | none | invite UI "without requiring additional OAuth scopes" |
| `captureLog` | `{level, message}` → `void` | none | forwards a log line to Discord |
| `openShareMomentDialog` | `{mediaUrl}` → `void` | none | **Web only** |
| `setActivity` | `{activity}` → `Activity` | `rpc.activities.write` | rich presence, not needed for the game itself |
| `getEntitlements` / `getSkus` / `startPurchase` | — | none / none / — | monetization; `startPurchase` is Web only |

- <https://docs.discord.com/developers/developer-tools/embedded-app-sdk>
- SDK v2.5.0 `Discord.d.ts`

**Enumerating other players (the important one for GeoRush).**

The current, documented API is `getInstanceConnectedParticipants()`:

```js
const { participants } = await discordSdk.commands.getInstanceConnectedParticipants();
```

"Instance Participants are any Discord user actively connected to the same Application Instance." Requires **no scopes**. Real-time updates come from the event:

```js
discordSdk.subscribe(Events.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE, updateParticipants);
// later: discordSdk.unsubscribe(Events.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE, updateParticipants);
```

The event payload is `{ participants: [User] }` (typed `GetActivityInstanceConnectedParticipantsResponse`).
- <https://docs.discord.com/developers/activities/development-guides/multiplayer-experience>
- <https://docs.discord.com/developers/developer-tools/embedded-app-sdk>

Participant `User` shape (exact, from SDK v2.5.0 `generated/schemas.d.ts`):

```
{ id: string, username: string, discriminator: string, bot: boolean, flags: number,
  avatar?: string | null, global_name?: string | null,
  avatar_decoration_data?: { asset?, skuId?, expiresAt? } | null,
  premium_type?: number | null, nickname?: string }
```

Limits of this API, as documented:
- It returns only users **connected to the same activity instance** — not the whole voice channel. For the whole channel use `getChannel({channel_id: discordSdk.channelId}).voice_states` (needs the `guilds` scope).
- No pagination or documented maximum size on `participants`; the practical bound is the voice call size ([§1](#1-how-activities-embed-in-voice-channels)).
- It carries no per-user game identity beyond the `User` object; guild-specific nicknames are not included unless you use `guilds.members.read` (which "only grants the information for that instance of the application's user") — for everyone's nick, share it through your own server.
- <https://docs.discord.com/developers/activities/development-guides/multiplayer-experience>

**`getActivities` is gone.** The SDK v2.5.0 package contains **no** `getActivities` command (verified by grep over the shipped `.d.ts` files), and the current SDK reference does not list it. Older examples/tutorials used `discordSdk.commands.getActivities()` to find peers; the replacement is `getInstanceConnectedParticipants()` + `ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE`. (v2.5.0 does ship a near-duplicate `getActivityInstanceConnectedParticipants` alongside `getInstanceConnectedParticipants`; prefer the documented name.) Do not build against `getActivities`.
- <https://docs.discord.com/developers/developer-tools/embedded-app-sdk>
- SDK v2.5.0 `Discord.d.ts` (grep for `getActivities` → no matches)

**Events** (via `discordSdk.subscribe(event, listener)`), with required scopes:

| Event | Payload | Scopes |
|---|---|---|
| `ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE` | `{participants: [User]}` | none |
| `CURRENT_USER_UPDATE` | current user object | `identify` |
| `VOICE_STATE_UPDATE` | `{voice_state{deaf,mute,self_mute,self_deaf,suppress}, user, nick, volume, mute, pan{left,right}}` | `rpc.voice.read` (partner-approved) |
| `SPEAKING_START` / `SPEAKING_STOP` | `{channel_id, user_id}` | `rpc.voice.read` |
| `ACTIVITY_LAYOUT_MODE_UPDATE` | layout mode (FOCUSED=0, PIP=1, GRID=2) | none |
| `CURRENT_GUILD_MEMBER_UPDATE` | `{user_id, nick, guild_id, avatar, …}` | `identify` + `guilds.members.read` |
| `ORIENTATION_UPDATE`, `THERMAL_STATE_UPDATE` | mobile | none |
| `RELATIONSHIP_UPDATE` | `{type, user}` | `relationships.read` (Social SDK-gated) |

- <https://docs.discord.com/developers/developer-tools/embedded-app-sdk>

**SPA requirement:** "This SDK is intended for use by a single-page application." Non-SPA frameworks must be nested inside the Activity's top-level SPA. GeoRush's Vite client qualifies.
- <https://docs.discord.com/developers/activities/how-activities-work>

**Server-side verification (anti-spoofing).** Anything the client sends (user ids, channel, participants) can be mocked. To verify an instance server-side:

```
GET https://discord.com/api/applications/<application_id>/activity-instances/<instance_id>
Authorization: Bot <token>
```

A valid instance returns `{application_id, instance_id, launch_id, location: {kind, channel_id, guild_id}, users: [...]}`; an invalid one 404s. Optionally, the proxy forwards `X-Signature-Ed25519`, `X-Signature-Timestamp`, `X-Discord-Proxy-Payload` headers you can verify (tweetnacl) and reject with 401.
- <https://docs.discord.com/developers/activities/development-guides/multiplayer-experience>

---

## 4. Transport: WebSockets inside Activities

- **All traffic is proxied:** "All network traffic is routed through the Discord Proxy for various security reasons." "Under the hood we utilize Cloudflare Workers, which brings some restrictions." The proxy exists "to hide the users' IP addresses as well as block URLs from known malicious endpoints."
  - <https://docs.discord.com/developers/activities/development-guides/networking>
- **WebSockets are allowed; WebRTC is not.** "While we currently only support websockets, we're working with our upstream providers to enable WebTransport." "WebRTC is not supported." (The phrasing is about newer transports — WebSocket is the supported real-time transport.)
  - <https://docs.discord.com/developers/activities/development-guides/networking>
- **`wss://` requirement: not stated in current docs.** The networking page does not spell out a `wss`-only rule; since the whole activity origin is `https://{clientId}.discordsays.com`, mixed-content rules mean `ws://` will be blocked by the browser anyway. Treat `wss://` as mandatory in practice but note the docs are silent.
- **WebSocket URLs go through the same mapping machinery as fetch:** the SDK's `patchUrlMappings` has a `patchWebSocket` option and "is modifying your browser's `fetch`, `WebSocket`, and `XMLHttpRequest.prototype.open` global variables" — i.e., WebSocket connects must target mapped/proxied URLs like everything else.
  - <https://docs.discord.com/developers/activities/development-guides/networking>
  - <https://raw.githubusercontent.com/discord/embedded-app-sdk/main/patch-url-mappings.md>
  - SDK v2.5.0 `utils/patchUrlMappings.d.ts`: `patchUrlMappings(mappings, {patchFetch?, patchWebSocket?, patchXhr?, patchSrcAttributes?})`
- **Cookies** (if you use session cookies): domain must match `{clientId}.discordsays.com` and you must "explicitly set `SameSite=None Partitioned`" — browsers refuse stricter cookies inside third-party iframes.
  - <https://docs.discord.com/developers/activities/development-guides/networking>

For GeoRush this means the Vite client opens a `wss://` connection back through the proxied origin (URL-mapped prefix → the Cloudflare Worker), and the Worker/DO fan out state. No direct client↔Worker bypass is possible from inside the iframe.

---

## 5. URL structure, proxying, and CSP

**Public origin.** The activity loads from `https://{CLIENT_ID}.discordsays.com/{path}`:

```js
const url = new URL(`https://${clientId}.discordsays.com${resourcePath}`);
```

**URL Mappings** (Developer Portal → Activities → URL Mappings) map path prefixes on that origin to your backend targets. Rules, quoted from the local-development guide:
- Targets omit protocol: `your-url.com`, never `https://your-url.com`.
- Targets "must point to a directory" — file targets like `example.com/index.html` are unsupported.
- Supports `{subdomain}`-style parameters: prefix `/google/{subdomain}` → target `{subdomain}.google.com`.
- Ordering: with shared prefixes (`/foo`, `/foo/bar`), "place the shortest (`/foo`) last."
- Tutorial example: prefix `/` → target `funky-jogging-bunny.trycloudflare.com`.
  - <https://docs.discord.com/developers/activities/development-guides/local-development>
  - <https://docs.discord.com/developers/activities/building-an-activity>
  - <https://docs.discord.com/developers/activities/development-guides/networking>

**The `/.proxy` path prefix.** Official client-side examples still fetch `/.proxy/api/token` (SDK README, how-activities-work), while the current networking page describes only the `{clientId}.discordsays.com` + URL-mappings model and does not document `/.proxy` explicitly. Reading the two together: with a root mapping (`/` → your target), your backend is reachable at `/.proxy/*` under the proxied origin, and the SDK ships `patchUrlMappings([{prefix, target}])` to rewrite third-party code's absolute URLs into that form. The docs are not fully explicit about the `/.proxy` mechanics today; the safest pattern (used by Discord's own tutorial) is relative paths (`fetch('/api/token')`) with a Vite dev proxy locally and a URL mapping / Worker route in production.
- <https://github.com/discord/embedded-app-sdk> (README)
- <https://docs.discord.com/developers/activities/how-activities-work>
- <https://docs.discord.com/developers/activities/development-guides/networking>

**CSP / blocked requests.** Requests to domains you have not mapped "will fail with a `blocked:csp` error." A small allowlist needs no mapping: `https://discord.com/api/` (plus canary/ptb), and `cdn.discordapp.com` / `media.discordapp.net` for `/attachments/`, `/avatars/`, `/icons/` paths.
- <https://docs.discord.com/developers/activities/development-guides/networking>
- <https://docs.discord.com/developers/activities/development-guides/local-development>

**frame-ancestors / being iframed.** Your app is rendered inside Discord's iframe, so your server must not refuse framing. The official docs **do not document a required `frame-ancestors` list**, and Discord's official starter sets no `X-Frame-Options`/CSP headers at all (verified in `getting-started-activity/server/server.js`). The practical rule (consistent with MDN header semantics): never send `X-Frame-Options: DENY/SAMEORIGIN` or `Content-Security-Policy: frame-ancestors 'none'` from the activity's responses — either will blank the activity. Community reports confirm `frame-ancestors 'none'` breaks embedding and that allowing `https://*.discordsays.com` fixes it (non-official source, treat as anecdote).
- <https://raw.githubusercontent.com/discord/getting-started-activity/main/server/server.js>
- <https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/frame-ancestors>

**Caching.** "Discord's application proxy will remove any cache headers for assets whose `content-type` headers include `text/html`." For non-HTML assets, supply your own cache-busting (hashed filenames from the Vite build).
- <https://docs.discord.com/developers/activities/development-guides/production-readiness>

**Static egress IP (matters for serverless backends).** Dynamically assigned IPs (cloud functions) risk inheriting "an IP address which has been banned by Cloudflare", after which egress toward Discord's API "will be banned for up-to an hour"; the docs recommend routing server egress through a static IP.
- <https://docs.discord.com/developers/activities/development-guides/production-readiness>

---

## 6. Dev workflow (tunnel + portal)

**Portal setup** (from the official tutorial):
1. Create the application in the Developer Portal; pick a development team ("non-distributed Activities are limited to team members").
2. Installation contexts: enable **both** "User Install" and "Guild Install".
3. OAuth2 → Redirect URI: add placeholder `https://127.0.0.1` (the SDK handles the real redirect).
4. Copy Client ID → `VITE_DISCORD_CLIENT_ID`; Client Secret → `DISCORD_CLIENT_SECRET` (server-only; "Never share either secrets or check them into any kind of version control").
5. Activities → Settings → check **"Enable Activities"** (auto-creates the "Launch" Entry Point command).
6. Activities → URL Mappings: prefix/target rows (see [§5](#5-url-structure-proxying-and-csp)).
- <https://docs.discord.com/developers/activities/building-an-activity>

**Tunnel (cloudflared — the tutorial's default; ngrok is the listed alternative):**

```bash
cloudflared tunnel --url http://localhost:5173
# -> https://funky-jogging-bunny.trycloudflare.com
```

Then set URL Mapping `/` → `funky-jogging-bunny.trycloudflare.com` and save. "Your web server can be HTTP and your network tunnel can upgrade the connection to HTTPS." Security warning: on a tunnel domain you don't own (ngrok free tier), "someone else could claim that domain and host a malicious site in its place" — reset the URL mapping afterwards.
- <https://docs.discord.com/developers/activities/building-an-activity>
- <https://docs.discord.com/developers/activities/development-guides/local-development>

This matches GeoRush's Docker setup with a cloudflared sidecar: map the Worker/Vite port through the tunnel, point the portal mapping at the `*.trycloudflare.com` host.

**Launching in dev:** enable Developer Mode (User Settings → Advanced), join a voice channel, click the rocket button — owned/team apps appear in the **Developer Activity Shelf** (web/desktop; mobile has its own Developer Mode toggle). Alternative: "Application URL Override" loads a dev server directly, bypassing the proxy (then full URLs are needed and HTTPS is required on web/desktop; "HTTPS is not required for mobile").
- <https://docs.discord.com/developers/activities/development-guides/local-development>
- <https://docs.discord.com/developers/activities/building-an-activity>

**Debugging:** the SDK forwards console logs to Discord by default (filter by `RpcApplicationLogger` or your application ID); desktop PTB has DevTools (View → Developer → Toggle Developer Tools); mobile shows `Debug Logs` in settings; `captureLog` sends explicit lines; `new DiscordSDK(clientId, {disableConsoleLogOverride: true})` disables forwarding.
- <https://docs.discord.com/developers/activities/development-guides/local-development>

**Team pattern:** "each developer to have their own 'development-only' application."
- <https://docs.discord.com/developers/activities/development-guides/local-development>

---

## 7. Rate limits / quotas relevant to a small app

From the official rate-limits page (HTTP API; there is **no Activities-specific quota documented**):
- Limits are per-token (per bot/user), per-route and global; do not hardcode them — "your app should parse response headers."
- **Global:** "All bots can make up to 50 requests per second to our API." Without an `Authorization` header the limit is per IP. Interaction endpoints are exempt.
- **429s** return `{message, retry_after (float seconds), global, code?}` plus headers `X-RateLimit-Limit/Remaining/Reset/Reset-After/Bucket`, and on 429 `X-RateLimit-Global` and `X-RateLimit-Scope` (`user` | `global` | `shared`). Honor `Retry-After`/`retry_after` before retrying.
- **Invalid-request (Cloudflare) ban:** "10,000 per 10 minutes", counting responses with **401, 403, or 429** — enough to matter for chatty apps; avoid auth errors and don't hammer exhausted buckets. 429s with `X-RateLimit-Scope: shared` don't count.
- Increase requests: <https://dis.gd/rate-limit>.
- <https://docs.discord.com/developers/topics/rate-limits>
- Production-readiness adds: respect `retry_after` (example in the Activity starter repo), and new SDK commands may be missing on old clients → catch error code `INVALID_COMMAND`.
- <https://docs.discord.com/developers/activities/development-guides/production-readiness>

For GeoRush: game traffic should flow over the WebSocket to the Durable Object, not through Discord's HTTP API; Discord API calls (token exchange, activity-instance verification, `users/@me`) are low-volume and well inside the 50 req/s global limit.

---

## 8. GeoRush-relevant synthesis

- Client = Vite SPA; SDK init → `ready()` → `authorize({scope: ['identify','applications.commands','guilds'], prompt: 'none'})` → POST code to Worker `/api/token` → `authenticate({access_token})`.
- Roster = `getInstanceConnectedParticipants()` on load + `ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE` subscription; `discordSdk.channelId` / `instanceId` identify the room server-side (verify via the Activity Instance API with a bot token).
- Real-time game state = `wss://` through the proxied origin (URL mapping prefix → Worker), Durable Objects as the room authority; WebRTC is not supported, and `rpc.voice.read` (speaking events) is partner-gated, so don't depend on it.
- Dev = `cloudflared tunnel --url http://<vite-or-worker-port>` + URL Mapping `/` → tunnel host; production = URL Mapping `/` → the Workers domain.
- Never send `X-Frame-Options`/`frame-ancestors 'none'`; hash asset filenames for cache busting; cookies (if any) need `SameSite=None; Partitioned` on `{clientId}.discordsays.com`.

## 9. Ambiguities and open questions

1. **`redirect_uri` in the token exchange** — required per the OAuth2 reference, omitted by Discord's own Activity starter. Send it only if the exchange 4xx's without it. ([§2](#2-oauth2-flow-for-embedded-apps))
2. **`/.proxy` path prefix** — still used in official example code but no longer explained by the networking page. Prefer relative URLs + portal mappings; treat `/.proxy` as legacy-but-working. ([§5](#5-url-structure-proxying-and-csp))
3. **`wss` vs `ws`** — no explicit doc statement; https-only origin makes `wss` mandatory in practice. ([§4](#4-transport-websockets-inside-activities))
4. **frame-ancestors allowlist** — not documented; the starter sends no framing headers at all. ([§5](#5-url-structure-proxying-and-csp))
5. **Participant cap** — none documented for Activities; design for 25+ per the design-patterns guide; the voice channel's `user_limit` is the real ceiling. ([§1](#1-how-activities-embed-in-voice-channels))
6. **Token lifetime** — `expires_in: 604800` appears only as an example value; treat as ~7 days but parse the field. ([§2](#2-oauth2-flow-for-embedded-apps))
7. **`getActivities`** — removed from the current SDK (absent in v2.5.0); all current docs use `getInstanceConnectedParticipants`. ([§3](#3-discordembedded-app-sdk))
8. **`rpc.voice.read`** — listed as an SDK event scope but "only available to approved partners" in the OAuth2 docs; assume unavailable. ([§2](#2-oauth2-flow-for-embedded-apps))

## 10. Sources

- Activities overview: <https://docs.discord.com/developers/activities/overview>
- Platform → Activities: <https://docs.discord.com/developers/platform/activities>
- How Activities Work: <https://docs.discord.com/developers/activities/how-activities-work>
- Building Your First Activity: <https://docs.discord.com/developers/activities/building-an-activity>
- Multiplayer Experience guide: <https://docs.discord.com/developers/activities/development-guides/multiplayer-experience>
- Networking guide: <https://docs.discord.com/developers/activities/development-guides/networking>
- Local Development guide: <https://docs.discord.com/developers/activities/development-guides/local-development>
- Production Readiness: <https://docs.discord.com/developers/activities/development-guides/production-readiness>
- Activity Design Patterns: <https://docs.discord.com/developers/activities/design-patterns>
- Embedded App SDK reference: <https://docs.discord.com/developers/developer-tools/embedded-app-sdk>
- Embedded App SDK repo (README, patch-url-mappings.md): <https://github.com/discord/embedded-app-sdk>
- OAuth2: <https://docs.discord.com/developers/topics/oauth2>
- Rate Limits: <https://docs.discord.com/developers/topics/rate-limits>
- Official starter (token exchange server): <https://github.com/discord/getting-started-activity>
- Official Activities blog post: <https://discord.com/blog/server-activities-games-voice-watch-together>
- SDK package v2.5.0 type definitions (npm tarball, inspected directly)
- MDN frame-ancestors (header semantics only): <https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/frame-ancestors>
