# UI and iOS home-screen research

Date: 2026-11-21

Scope: recommendations for the two remaining proposal items in `plan.md`. Sibling apps reviewed: Splitarr (`/home/michaelpeele/ai-projects/splitarr`) and Curatarr (`/home/michaelpeele/ai-projects/Curatarr`). No application code changed in this batch.

## UI grouping: sidebar navigation versus all-on-one-page layout

### Current Looparr structure

`public/index.html` is one page with three top-level areas: hosted summary strip, Settings, and Projects. Each project opens a modal drawer (`#drawer`) containing plan.md status, checklist, editor, and logs. `public/app.js` drives everything from one SSE connection (`EventSource('/api/events')`) plus `fetch('/api/state')`. `public/styles.css` has no sidebar or navigation rules. There is no URL routing.

### Sibling patterns

Splitarr:

- `frontend/src/components/organisms/Layout.tsx` keeps a `drawerOpen` React state.
- A `mobile-menu-button` with `aria-label="Open navigation"` opens a `<nav className="sidebar open">`; a `button.drawer-scrim` with `aria-label="Close navigation"` closes it.
- `frontend/src/navigation.ts` defines six routed destinations: Library, Review, Settings, Updates, Activity, Log.
- `frontend/src/styles.css` keeps the sidebar visible on desktop and slides it off-canvas behind the scrim under the mobile media query (lines 374-376).
- `frontend/src/components/molecules/BottomBar.tsx` always renders a bottom action for the primary route.

Curatarr:

- `Curatarr.Web/src/components/Sidebar.tsx` uses `isMobile`/`isTablet` plus `sidebarOpen` state, with widths 190px (mobile open / desktop) and 156px (tablet), a toggle button (`aria-label="Toggle navigation"`, ☰ / ✕), and active-view highlighting.
- `Curatarr.Web/src/App.tsx:339` passes `active={view}` and `onChange={setView}`; `App.tsx:248` notes the sidebar hides unauthorized items.
- Navigation is state-driven, not URL-driven.

### Recommendation

Keep Looparr all on one page now. Three top-level areas plus a per-project drawer do not justify a persistent sidebar; adding one would introduce routing or view state without reducing user steps. Preserve the single SSE-driven page so live card, summary, and drawer updates stay in one render path.

If section count grows, add lightweight in-page jump links (anchor links to the existing `#host-strip`, settings panel, and `#project-grid`) before adding a sidebar. When a fourth genuine top-level area appears (for example a global activity log or queue), adopt Splitarr's pattern: desktop `<nav>`; mobile hamburger plus scrim; `aria-label` on both controls; reuse the existing `.drawer`/`.drawer-backdrop` accessibility conventions rather than inventing a new overlay. Curatarr's role-aware item filtering is only relevant if Looparr later adds authorization.

No HTML, CSS, or JS change is part of this recommendation.

## iOS web-app icon support

### Current Looparr assets

- `public/favicon.svg` exists and is linked from `public/index.html` as `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />`.
- `public/logo.svg` also exists.
- `public/index.html` has no `apple-touch-icon` link and no Apple mobile web-app meta tags.
- Docker serves `public/` directly; no font or icon dependency is present.

### Sibling patterns

Splitarr (`frontend/index.html:7-12`):

```
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
<meta name="theme-color" content="#0d0d0d" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="Splitarr" />
```

Splitarr's progress notes specify a 180 × 180, 8-bit RGB, opaque full-canvas tile with no alpha; transparent corners are removed so iOS does not add a white border.

Curatarr (`Curatarr.Web/index.html:7-8`) links `/logo.svg` as the SVG favicon and `/apple-touch-icon.png` at `sizes="180x180"`, but does not add the Apple web-app meta tags in that head.

### Recommendation

Add iOS home-screen support in a future asset batch:

1. Generate `public/apple-touch-icon.png` as a 180 × 180 opaque RGB PNG from `public/favicon.svg`: full-bleed background `#0d1421`, no alpha, mark centered, corners filled (not transparent).
2. Keep the existing SVG favicon link in `public/index.html`.
3. Add these head tags, using Looparr colors and name:

```
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
<meta name="theme-color" content="#080c13" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="looparr" />
```

`#080c13` matches `--bg` in `public/styles.css`; `#0d1421` matches the favicon tile. Do not add an image library dependency; render the SVG once with an available local tool and commit the resulting PNG as a static asset. After implementation, verify `GET /apple-touch-icon.png` through `http://127.0.0.1:4188/` and rebuild the image with `docker compose up -d --build looparr`.

No asset or HTML change is part of this recommendation.
