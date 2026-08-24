# Discord store art

Original GeoRumble artwork for the Developer Portal's **Activities → Art Assets** and
**Settings → General Information**. The `*.html` files are the masters — edit and re-render
with a headless browser at the exact viewport size (see each file's `width`/`height`).

| File | Portal field | Spec |
| --- | --- | --- |
| `icon-1024.png` | Application icon (Settings → General Information) | 1024×1024; Discord circle-crops — art stays inside the center circle |
| `cover-1920x1080.png` | Cover Art (Activities → Art Assets) | 16:9, ≥1024px wide; also displayed center-cropped to 13:11 (detail page header), so the wordmark stays inside the middle 1274px |
| `embedded-background-1920x1080.png` | Embedded Background (Activities → Art Assets) | 16:9, ≥1024px wide; art hugs the edges, center stays calm because the live map and HUD render on top |
| `preview-cover-13x11-crop.png` | — | Not for upload; preview of how the cover survives the 13:11 detail-page crop |

Style: toy board-game map — saturated sea, chunky outlined landmasses, gameplay motifs
(helper circles, found-green pops, hint ring, pin) around a heavy-outlined wordmark.
Palette per `../palette.md` plus decorative map fills (`#5BC878`, `#F2C94C`, `#F27E63`,
sea `#54ACDD→#3B87BE`).

## Hover video (not yet produced)

The detail page plays a looping **Video Preview** on hover: **640×360, mp4, under 10
seconds, under 1 MB**, with a poster image. Captured gameplay would fit; still to do.
