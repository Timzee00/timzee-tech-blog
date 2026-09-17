# Timzee Tech Hub — Production Community Platform

Timzee Tech Hub is a modern community platform with a tech blog, discussions, profiles, direct messaging, marketplace, videos, novels, content curation, and an authenticated AI assistant, built with Supabase and Netlify.

> **Production source of truth:** See `PRODUCTION_READINESS.md` for the current deployment, security, migration, and verification workflow. Older status/report documents are historical snapshots and may contain superseded setup instructions.

## Core features

- Tech blog, posts, comments, likes, bookmarks, follows, and notifications
- Live discussions and direct/group chat
- User profiles and verification
- Marketplace listings and inquiries
- Videos, novels, and chapters
- RSS/content curation with moderation workflow
- Authenticated AI assistant through a server-side provider proxy
- Moderator/admin/super-admin controls

## Local setup

Clone the repository and serve the static site from the repository root:

```bash
git clone https://github.com/Timzee00/timzee-tech-blog.git
cd timzee-tech-blog
python -m http.server 5173
```

Then visit `http://localhost:5173`.

For serverless functions, use a Netlify-compatible local workflow rather than a plain static server.

## Supabase

The production database uses tracked migrations under `supabase/migrations/`.

When provisioning a new environment, apply the migration history rather than manually running the old root-level SQL snapshots. Reconcile the remote schema before creating new migrations.

Enable Realtime only for the tables that require it, including the discussion and messaging tables used by the application.

Create the required `media` storage bucket and apply the repository's current storage policies for covers, comments, post media, discussions, topics, direct messages, avatars, ads, and themes.

### Roles

Authorization is based on trusted `app_metadata` / database-backed role mappings. Do **not** use `user_metadata.role` for authorization decisions. The browser may contain a publishable Supabase key, but it must never contain a service or secret key.

## AI provider configuration

AI provider API keys are server-side Netlify environment variables. Users do not enter or store provider secrets in browser storage.

Required environment variables for the AI proxy include:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GROQ_API_KEY`
- `OPENAI_API_KEY` (when OpenAI is enabled)
- `ANTHROPIC_API_KEY` (when Anthropic is enabled)

The AI endpoint authenticates the user, validates the request, enforces per-user rate limits, and applies input/output bounds before forwarding to a provider.

## Content curation

Optional scout settings:

- `NEWS_FEEDS`
- `NEWS_TIPS_FEEDS`
- `NEWS_ENABLED`
- `NEWS_POSTS_PER_RUN`
- `NEWS_AUTHOR_NAME`

## Deploy

Recommended deployment path: **GitHub → Netlify** so both static pages and Netlify Functions are deployed.

Before a production release:

1. Verify GitHub `main` is the intended release commit.
2. Run `npm run check`.
3. Confirm the Netlify deployment points to that commit.
4. Run the public smoke-test URLs and authenticated E2E tests where credentials are available.
5. Run Supabase security and performance advisors after schema changes.
