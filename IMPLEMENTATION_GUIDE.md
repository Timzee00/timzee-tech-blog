# Timzee Tech Hub — Current Implementation & Release Guide

This document describes the current production architecture. Older setup notes that suggested storing provider API keys in browser storage are obsolete and must not be followed.

## Runtime architecture

- Static frontend: HTML, CSS, ES modules under `assets/`.
- Database/auth/realtime/storage: Supabase project.
- Server-side integrations: Netlify Functions under `netlify/functions/`.
- AI provider keys: server-side environment variables only.
- Public community media: `media` storage bucket.
- Direct-message media: currently tracked as a dedicated privacy work item; do not assume the public `media` bucket provides private chat-media access.
- Scheduled automation: `automation-maintenance` every 5 minutes; Scout/news collection runs hourly.
- Dynamic sitemap: `/sitemap.xml` is served through the Netlify sitemap function.

## Notifications and automation

Notifications are database-driven. Common events are produced by backend triggers so a browser-side helper failure does not silently remove the notification side effect.

The frontend provides:

- realtime notification badge updates;
- realtime notification popups;
- a dismissible sitewide announcement banner;
- branded toast feedback replacing legacy browser `alert()` dialogs on pages that load the shared client hardening module;
- an online/offline connectivity banner.

Scheduled maintenance handles published/scheduled announcements, announcement notifications, transient story cleanup, read-notification retention, and its own job-health record.

## AI

AI calls go through `/.netlify/functions/llm-proxy`.

Required server environment variables are configured in Netlify, never in frontend storage:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
GROQ_API_KEY
OPENAI_API_KEY (optional)
ANTHROPIC_API_KEY (optional)
```

The proxy requires an authenticated Supabase access token, validates model/provider choices, caps input size and output tokens, and enforces per-user rate limits.

## Production pages and UX fallbacks

- `404.html` — branded not-found experience.
- `action-result.html` — reusable success/error/warning/info/pending state page.
- `offline.html` — branded connectivity fallback.
- `maintenance.html` — controlled maintenance experience.

Use the shared browser helper when a new feature needs an action result:

```javascript
window.goToActionResult({
  status: "success",
  title: "Saved",
  message: "Your changes are now live.",
  next: "profile.html",
  nextLabel: "View profile"
});
```

For lightweight feedback:

```javascript
window.siteToast?.("Saved successfully.", { type: "success", title: "Done" });
```

## Database changes

All production DDL changes must be represented in `supabase/migrations/` using timestamped migration files. Do not rely on a loose SQL document being applied manually and then forgotten.

The current migration history includes:

- runtime schema compatibility;
- compatibility sync triggers;
- trigger search-path hardening;
- event-driven notifications and automation;
- realtime/storage privilege hardening;
- internal RPC execute restrictions;
- public submission validation/idempotency;
- announcement lifecycle and scheduled publishing;
- job-health observability;
- backend-owned friend-request notifications;
- duplicate storage-policy cleanup.

## Release gates

The repository contains `.github/workflows/production-gate.yml`.

The gate checks Netlify Function syntax, repository validation, required production configuration, and runtime security assumptions. A red gate is a release blocker; do not bypass it simply to deploy.

The connected GitHub integration currently does not expose the underlying Action log blob, so a failed run must not be described as green without a successful run visible from GitHub.

## Supabase security review

The most important remaining dashboard-level item is enabling leaked-password protection under Supabase Auth.

Supabase performance advisors still report multiple-permissive-policy combinations and historically unused indexes. These should be cleaned semantically, not removed indiscriminately.

## Current release blockers

1. Complete private direct-message media migration to a private bucket with signed retrieval and membership checks.
2. Diagnose and turn the GitHub production gate green without weakening its checks.
3. Deploy the current `main` revision to Netlify only after the above blockers are clear.
4. Run a real browser/end-to-end verification against the resulting deployment.
5. Enable Supabase leaked-password protection.

## Maintenance principle

Before adding a feature, trace the complete lifecycle:

`user action → database mutation → side effect → notification → realtime update → cleanup → observability → recovery`

A feature is not considered production-complete merely because its primary screen renders.