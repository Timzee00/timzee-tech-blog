---
version: alpha
name: Timzee Community Desk
description: Clear, approachable technology publishing and community tools.
colors:
  primary: "#076f64"
  background: "#f5f8f8"
  surface: "#ffffff"
  text: "#172b32"
  muted: "#536970"
  secondary: "#2368a2"
typography:
  sans:
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
  mono:
    fontFamily: 'JetBrains Mono, SFMono-Regular, Consolas, monospace'
rounded:
  DEFAULT: 9px
  sm: 6px
  md: 14px
  lg: 16px
spacing:
  section-gap: 48px
  page-max: 1200px
components:
  button: {}
  card: {}
  dialog: {}
---

## Overview

Timzee helps curious readers discover technology, exchange ideas, trade tools,
and follow community stories. Its public pages are an editorial product; chat,
forms, settings and staff tools are workspaces. English is the current UI locale.
Dates retain the existing browser locale/timezone behavior.

The design should make the next action clear without covering content or demanding
signup. The home page's numbered exploration index and small teal wordmark are
the signature. Reading and task screens stay quiet. Avoid decorative gradients,
persistent moving backgrounds, startup interstitials, fake activity counts,
competing floating controls and oversized blocks repeated across every section.

Runtime CSS is the canonical token source (Model B): `assets/css/variables.css`.
`assets/css/design-system.css` owns shared component finishes; `navbar.css` owns
navigation. `admin.css` maps staff tokens to the same semantic palette. Page CSS
owns only feature layout. Do not dynamically inject another copy of shared CSS.
This document maps the runtime tokens; it does not replace their implementation.

## Colors

`--color-primary` maps to `--accent` (teal); `--color-bg` to `--bg`;
`--color-surface` to `--card-solid`; `--color-text` to `--ink`;
`--color-text-muted` to `--muted`. Admin-configured branding may change `--accent`.
Maintain WCAG AA contrast when changing it. Muted text remains readable rather
than using opacity. Borders define regions; color never carries an error alone.

Dark mode uses navy `#101e24`, raised surface `#182a32`, mint `#69d3c1`, text
`#edf5f4`, and muted `#adc0c5`. Primary button text becomes dark in this theme.
The system preference is the default; a saved user choice overrides it.

## Typography

Use `--font-body` for controls and prose; `--font-display` for headings, with
system sans fallbacks. The site no longer depends on remote font requests.
Mono is reserved for short indices and overlines. Avoid serif/sans differences
between unrelated routes. Inputs use 16px text to avoid mobile browser zoom.
Headings are fluid; metadata stays legible at 12–14px.

## Layout

A 1200px maximum container has 32px gutters on desktop and 16px on phones.
Desktop navigation becomes a drawer at 960px; content columns collapse at
700px. The home feed uses a 300px supporting sidebar. Settings navigation becomes
a horizontally scrollable list on small screens. Visible scrollbars are allowed.
Do not hide page overflow to disguise fixed-width content. Images and long titles
must fit their container. Tables and media workspaces may own bounded scrolling.

## Elevation & Depth

Use borders for ordinary cards. Reserve shadows for dialogs, notifications and
the home exploration index. Avoid hover movement on reading cards; primary
buttons may move 1px. The only layered home accent is a quiet offset panel shadow.

## Shapes

Controls use 9px corners; content surfaces use 14–16px. Full pills are reserved
for tags and compact status labels. Avatars remain circular.

## Components

`theme-init.js` owns theme selection, toast, alert, confirmation and prompt.
Confirmations use native HTML dialogs styled by the application, default to
Cancel, contain focus, support Escape and restore the prior focus. Password
prompts use password inputs. Success notifications are supplemental; form errors
remain inline and preserve the user's draft.

`ui-controls.js` owns inline constraint validation, error associations, text area
autogrow, missing accessible field names, password toggles and search clear
controls. `search-input.js` owns the 300ms debounce and composition handling;
feature loaders own request sequencing and pagination. Clear acts immediately.
Native selects and date controls intentionally retain their accessible browser
pickers. Public, user and staff forms share these behaviors.

`nav.js` owns the drawer, current-page state and bottom navigation. Use real
links for destinations and buttons for actions. The drawer makes background
content inert, traps focus and restores its opener. `icons.js` supplies shared
outline icons with hidden SVG semantics and named controls. Footer ownership is
`site-shell.js`; support and policy links resolve from the site root.

Motion is short and optional. Content is visible before animation setup. Honor
both the operating-system reduced-motion setting and the user's saved preference.

## Dos and Don'ts

- Reuse semantic tokens and existing component owners before adding a new helper.
- Keep empty, loading, failure, disabled and populated states understandable.
- Label the result of an action; never imply a save succeeded before the server responds.
- Preserve permission checks and backend contracts during presentation work.
- Do not introduce anonymous promises of scale, uptime, verification or security.
