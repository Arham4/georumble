# Map-Quiz Genre Mechanics — Design Synthesis for GeoRumble

Date: 2026-08-22
Status: research deliverable; proposals only — no code changed.

## Scope and legal framing

This document synthesizes the well-known public mechanics of the "identify the region on a map"
quiz genre (found in many independent products: clickable-map quiz sites, classroom labeling tools,
and mobile geography trainers). It is written in our own words as an original game-design synthesis.
GeoRumble may reference the genre descriptively in marketing copy only — never in title, logo, or
branding — and we do not copy any third party's maps, color schemes, wording, or assets. Everything
below describes mechanics we implement ourselves against our own map data and visual identity.

## 1. Core click-loop

The genre's fundamental loop, common to essentially every product in this space:

1. **Prompt**: the game names one region ("find X") — sometimes a country, state, capital, river,
   flag, or other feature class.
2. **Aim and click**: the player moves the mouse over an outlined map and clicks a region.
3. **Verdict feedback**: instant, on the map itself — the clicked region visibly confirms (right) or
   denies (wrong). Common conventions: a distinct fill/flash per outcome, and after repeated misses
   on the same prompt, briefly highlighting the correct answer so play never stalls.
4. **Found-state accumulation**: correctly identified regions stay visually marked for the rest of
   the round, giving a satisfying "filling in the map" progress readout.
5. **Next prompt** until every region in the round's set is found; the whole round is timed.

Two properties make the loop feel good and are worth treating as requirements:

- **Feedback latency near zero** — verdict rendering must be immediate (client-predicted), with the
  authoritative confirmation arriving asynchronously.
- **Never dead-end** — after enough misses on one prompt the game reveals or strongly hints the
  answer, keeping momentum (important for a social voice-channel setting where stalling kills the
  vibe).

## 2. Scoring and grading families seen across the genre

| Family | How it works | Trade-offs |
| --- | --- | --- |
| **Accuracy percentage** | First-attempt hits ÷ prompts, shown as %. Wrong *first* clicks cost; later attempts to find the right answer usually don't re-penalize. Rewards care over speed. | Simple, legible, forgiving of slow-but-careful players. |
| **Time-based score** | Completion time is the score; fastest run wins. Leaderboards are typically top-N times and/or points. | Highly competitive, drives speedrunning; brutal for beginners. |
| **Combined points with time decay** | Points per correct answer decay the longer the player takes (e.g., a fixed max per question). Total blends accuracy and pace into one number. | Single comparable number; harder to explain. |
| **Miss counting / color grading** | Each region records how many attempts it took; the finished map doubles as a heat map of what you don't know. | Great learning signal, not a competitive score by itself. |
| **Star / grade thresholds** | Finish a round, get graded (stars, letter grade, badges) from combined accuracy + speed thresholds; bronze/silver/gold-style badge ladders reward repeat play. | Motivating progression; thresholds are arbitrary and need tuning. |
| **Local/personal best tracking** | Per-quiz high scores saved locally or to a profile; unlimited retakes are the norm. | Cheap to build; strong retention driver. |

Genre consensus worth copying in spirit: show **two numbers** (accuracy and time) rather than
collapsing everything into one opaque figure, penalize only **first attempts**, allow unlimited
retakes, and let the completed map itself display per-region miss counts.

## 3. Game modes

Four interaction modes recur across the genre:

- **Learn / browse mode**: labels are visible on the map (or revealed on hover/click-to-reveal);
  untimed, ungraded. Often paired with a **review mode** that re-drills only previously missed
  items. This is the on-ramp for beginners and the classroom standby.
- **Strict quiz mode**: labels hidden; timed and graded; the canonical experience.
- **Type-in mode**: the player types the name instead of clicking — spelling counts, difficulty
  jumps sharply. Usually an option layered onto the same maps.
- **Pin/place mode**: match a set of name labels to pinned locations (drag-and-drop placement),
  turning the quiz into a labeling exercise.

Additional cross-cutting options: read-aloud of place names (accessibility + younger players),
custom quizzes built from subsets of an existing question bank, and zoomable/pannable maps with a
labels-on-off toggle.

## 4. Content structure

Content is organized as a catalog of quizzes ("packs" in our terms) along two axes:

- **Category**: continents → countries → capitals; flags; oceans/seas; rivers/mountains/deserts;
  first-level administrative divisions (e.g., US states, other countries' states/provinces); major
  cities. Packs nest geographically (world → continent → country).
- **Difficulty variant**: the same area appears in variants with more or fewer regions per round
  (e.g., all ~50 vs. a starter subset; full Europe vs. western Europe). Subset selection is also
  exposed directly as "custom quiz" — pick any subset of an existing pack's questions. This is both
  the main difficulty dial and the main curriculum-scaffolding tool: start small, grow as mastery
  shows.

Implication for GeoRumble: model a pack as `(area, featureClass, featureIds[])` with derived
variants (full/starter/custom subsets) so one map asset serves many difficulties.

## 5. Session shape

- **Round = one pack instance**: N prompts covering the pack's regions exactly once (plus repeats
  for misses, below).
- **Ordering**: shuffled each round is the common default; some products offer fixed (curriculum)
  order or configurable traditional-vs-random modes. Shuffling prevents memorizing positions.
- **Retry-on-miss vs miss-penalty** form a spectrum:
  - *Forgiving*: a missed prompt returns to the queue until answered correctly (optionally after a
    brief hint/reveal), and only first attempts hurt the accuracy grade. This is the standard
    learning-oriented behavior.
  - *Punishing*: wrong clicks simply count against score/time and the prompt moves on; the strictest
    variants cap attempts before revealing.
  - Most products land on: keep going until correct, count first-attempt misses, optionally replay
    misses at the end via a review pass.
- **End of session**: results screen with accuracy %, time, per-region miss map, personal-best
  comparison, and one-click restart. Unlimited retakes.

## 6. Multiplayer co-op adaptation (primary design target)

### What the existing protocol already gives us

From `shared/protocol.ts`: phases `lobby | playing | victory`; `RoomSnapshot` carries
`hostId, players, phase, packId, found[], target, startedAt`; clients send
`hello / start / guess(featureId) / verdict(outcome) / advance(target) / win(seconds, guesses)`;
server echoes `guess` with attribution (`byPlayer`) and `verdict` with a `GuessOutcome`
(`featureId, byPlayer, remaining`), plus `rejected(reason)`. The architecture is **host-relay**: a
player's client acts as authority, the relay distributes snapshots.

Mapping the genre mechanics onto it:

| Genre mechanic | Protocol realization |
| --- | --- |
| One shared prompt | `snapshot.target` — everyone hunts the same region simultaneously. |
| Click → verdict | Any player sends `guess{featureId}`; host compares to `target` and emits `verdict{outcome}`; server rebroadcasts to all. |
| Team scores for anyone's hit | `outcome.byPlayer` attributes credit; `found[]` accumulates team-wide; `remaining` is the shared countdown. |
| Found-state accumulation | `found[]` already renders the "map filling up" progress view identically for all clients. |
| Round timing | `startedAt` + host's final `win{seconds, guesses}`. |
| Victory | When `remaining === 0`, host transitions phase to `victory`. |

The co-op twist on the genre: the click-loop stays individual (everyone aims their own mouse), but
scoring, found-state, and the clock become **shared**. This converts the genre's solo speedrun into
a conversation engine — exactly the property we want in a voice channel.

### Concrete proposals (not yet implemented)

All additions below are additive members on existing tagged unions — old fields keep working, and
the union style keeps forward compatibility.

1. **Miss visibility.** Today `verdict` appears to mean "correct hit" (`remaining` decrements).
   Add an explicit miss broadcast so wrong clicks give everyone feedback and feed accuracy stats:
   either extend `GuessOutcome` with `correct: boolean`, or add
   `{ t: "miss"; featureId: string; byPlayer: string }` to both unions. Prefer the boolean — fewer
   message kinds, and clients that ignore unknown fields stay compatible.

2. **Team scoreboard.** Add to `RoomSnapshot`:
   `scores: Record<PlayerId, { hits: number; misses: number }>` (or parallel arrays to keep JSON
   lean). The host updates it on each verdict. This implements §2's accuracy family co-operatively
   without changing the win condition.

3. **Prompt ordering made deterministic.** Replace free-form `start{packId, target}` /
   `advance{target}` drift risk with a host-generated shuffled sequence agreed once:
   `start{packId, order: string[]}` and `advance{index: number}`, where `target` becomes derived
   (`order[index]`). All clients then agree on ordering and can pre-render "regions remaining"
   without extra messages. Keep `target` in the snapshot as the derived convenience field.

4. **Victory computed, not asserted.** Since `remaining === 0` is derivable, have the relay validate
   the host's `win` against its own `found.length === packSize` and reject stale/wrong wins with
   `rejected`. Also stamp the authoritative `win{seconds, guesses}` from `startedAt` server-side if
   the relay ever grows state (see 7).

5. **Host handoff.** If `hostId` disconnects mid-round, the relay promotes another player and
   announces it via `snapshot` alone (clients treat `hostId` changes as implicit). No new message
   type needed; document the invariant "only `hostId`'s client may send `start/advance/win/verdict`,
   others get `rejected`."

6. **Learn mode needs no protocol.** Label reveal is a purely local render toggle; add nothing to the
   wire. Optional future nicety: `{ t: "pointer"; x: number; y: number }` presence cursors so
   players can point at the map while talking — high value in voice, zero coupling to scoring.

7. **Eventual trust boundary.** Host-relay is fine for friends-in-a-voice-channel, but the relay
   should still sanity-check (host membership, monotonic `advance`, `remaining >= 0`) so a buggy or
   hostile host can't corrupt the room. Moving verdict computation into the Worker/Durable Object
   later requires no client-visible protocol change — that's the payoff of the current shape.

## 7. Versus-mode extensions (keeping the protocol extensible)

Sketch for two teams racing on the same pack, added without breaking co-op:

- **Mode + teams on the room**: `Phase` unchanged; add
  `mode: "co-op" | "versus"` and `teamOf: Record<PlayerId, "a" | "b">` to the snapshot (set at
  `start`). Existing co-op rooms just omit them.
- **Shared target, split credit**: both teams hunt the same `target`; the first correct `verdict`
  scores the point *for that player's team* (`byPlayer` → `teamOf`), then `advance` fires. Misses
  are free but timed (§2's time-decay family adapted: per-target first-hit time sums to team time).
- **Win conditions**: first team to clear the pack, or higher score when a shared timer expires
  (add optional `endsAt` alongside `startedAt`; expiry enforced by the relay).
- **Anti-spoil detail**: `found[]` must become per-team (`foundByTeam`) in versus, since seeing the
  other team's discoveries is itself information.
- Because every message is already attributed by `byPlayer` and teams are a pure function of
  player id, none of the existing `guess/verdict/advance/win` shapes change — versus is a
  scoring-policy layer, not a wire redesign.

## 8. Accessibility and UX notes for a Discord Activity viewport

Constraints: embedded iframe, commonly small (~800×500 up to popped-out larger), ~16:9-ish, mouse
(or trackpad/touch) only, players are also in voice chat and possibly watching a busy Discord UI
around the frame.

- **Design for ~900×560 first**: prompt banner + timer on top, map fills the rest. Every HUD element
  must survive a narrow frame; test at 640×360 too.
- **Mouse-only input**: no keyboard-required actions; all controls are visible buttons. Don't rely
  on drag for anything essential (click-only fallback for any pin/place mode).
- **Click targets**: tiny regions (microstates, island nations, small provinces) are the core UX
  hazard. Provide wheel/buttons zoom + pan, generous hit areas (union of polygon bounds, minimum
  ~24 px effective radius), and nearest-region tolerance snapping with a visible confirm flash so
  accidental near-misses feel fair.
- **Redundant feedback coding**: never signal right/wrong by hue alone — pair color with a check/cross
  glyph, outline pulse, and label text (colorblind-safe by construction). Keep flashes brief and
  offer reduced-motion (steady fill change instead of animation).
- **Contrast and text size**: prompt text ≥ 20 px equivalent at default zoom; map fills must hold
  contrast against both light and dark Discord themes (theme-aware palette of our own design).
- **Social readability**: state must be glanceable from across a stream — big current-prompt text,
  prominent "X/N found" counter, per-player recent-hit ticker rather than dense tables.
- **Latency honesty**: predict the click highlight locally; reconcile on `verdict`; on `rejected`
  roll back visibly. In a voice channel, a silent swallowed click reads as lag.
- **Reconnect safety**: `welcome{you, snapshot}` lets a mid-game joiner resume instantly — render
  the full found-map from the snapshot, never assume they saw prior messages.

## General sources consulted

Mechanics synthesized from publicly available descriptions of several products in the genre
(described above in our own words):

- GeoGuessr support documentation — quiz point system (points per question decaying with answer
  time): https://geoguessr.zendesk.com/hc/en-us/articles/5110411056017-How-does-the-point-system-in-quizzes-work
- Lizard Point Quizzes (clickable-map quizzes; first-guess accuracy scoring, learn/test modes):
  https://lizardpoint.com/geography/
- Seterra product listings and independent reviews (pin/type/label modes, learn vs quiz, review of
  missed items, attempt-based color grading): https://www.geoguessr.com/quiz/seterra ,
  https://apps.apple.com/ca/app/seterra-geography-full/id1093460065 ,
  https://thecurriculumchoice.com/seterra-geography-program/ ,
  https://hanaringo.com/en/seterra-geography-app-review/
- GeoTrainer (learn-mode label reveal, growing region sets, spaced repetition of misses):
  https://neutrinosys.com/
- Quizlet Diagrams classroom guidance (hotspot labeling, instant-feedback study modes):
  https://learninginhand.com/blog/quizlet-diagrams
- GeoGuessr multiplayer formats (Duels damage race; Team Duels where only a team's best result
  counts; private lobbies): https://geoguessr.zendesk.com/hc/en-us/articles/4407930336145-What-is-Play-with-Friends
- Academic analysis of team-hedging strategies in cooperative geography games (Larsen, 2023):
  https://michael.szell.net/downloads/pliesslarsen2023ehs.pdf
- Speedrun community context for time-weighted scoring: https://www.speedrun.com/seterra/forums/xr4ej
