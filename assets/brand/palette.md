# GeoRush Palette

Dark-mode-first, tuned against Discord's dark background `#23272A`. All ratios are WCAG
contrast ratios computed with the relative-luminance formula; "AA-normal" is ≥ 4.5:1,
"AA-large / UI" is ≥ 3:1 (WCAG 1.4.3 large text and 1.4.11 non-text components).

## Core

| Token | Hex | Role |
| --- | --- | --- |
| `bg` | `#23272A` | App background; also region-border stroke color |
| `surface` | `#2C2F33` | Elevated panels, cards, modals |
| `text-primary` | `#FFFFFF` | Headings, primary copy — 15.05:1 on `bg`, AA-normal |
| `text-muted` | `#B5BAC1` | Secondary copy, hints — 7.71:1 on `bg`, 6.89:1 on `surface`, AA-normal |

## Map states

| Token | Hex | On `#23272A` | White text on it | Usage |
| --- | --- | --- | --- | --- |
| `map-fill` | `#66738C` | 3.15 (AA-large/UI pass) | 4.78 (AA-normal) | Unfound/clickable regions |
| `map-hover` | `#8EA1E1` | 5.97 (AA-normal) | 2.52 (do not put text on it) | Hover/press highlight |
| `correct` | `#248046` | 3.05 (AA-large/UI pass) | 4.94 (AA-normal) | Solved regions, success chips |
| `wrong` | `#D83C3E` | 3.32 (AA-large/UI pass) | 4.53 (AA-normal) | Wrong-guess flash; as error text on `bg`: 3.32 — large text only |

Region borders use `bg` (`#23272A`) as the stroke so adjacent regions separate by shape;
region-vs-background visibility is carried by `map-fill` at 3.15:1.

## Accents & brand

| Token | Hex | On `#23272A` | White text on it | Usage |
| --- | --- | --- | --- | --- |
| `accent` | `#5865F2` | 3.27 (large/UI only — never body text on `bg`) | 4.61 (AA-normal) | Primary buttons, CTA fills |
| `accent-light` | `#98A7F8` | 6.61 (AA-normal) | 2.28 (never put white text on it) | Links, timer, brand highlight wedge, "Rumble" in wordmark |
| `brand-line` | `#8EA1E1` | 5.97 (AA-normal) | — | Globe glyph strokes in `assets/brand/*.svg` |

## Rules

- Text-bearing pairs must be one of: white or `text-muted` on `bg`/`surface`/`map-fill`/
  `correct`/`wrong`/`accent`, or `accent-light` as text on `bg`. Everything else above is
  decorative only.
- The logo lockup ("Geo" in white + "Rumble" in `accent-light`) is valid on `bg`,
  `surface`, and the dark tile used by `icon.svg` / `favicon.svg`. It is not
  light-theme-safe; if a light surface is ever needed, invert to a dark tile behind it.
