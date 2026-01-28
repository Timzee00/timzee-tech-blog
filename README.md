# 🚀 Timzee Tech Hub - Professional Tech Blog

A modern tech blog platform with professional team management, content curation bot, and volunteer moderator system built with Supabase and Netlify.

## ✨ Features

### 🎯 Core Features
- **Tech Blog** - Post articles, discussions, and news
- **Community** - Comments, discussions, engagement
- **User Profiles** - Customizable profiles with bios
- **Chat** - Private messaging
- **Notifications** - @mentions and activity feeds

### 👥 Team Management (NEW)
- **Moderator Role** - Manage content and authors
- **Author Role** - Volunteer writers
- **Admin Panel** - `/super/professional-panel.html`
- **Easy Promotion** - Promote volunteers with one click

### 🤖 Content Curation (NEW)
- **RSS Bot** - Auto-fetch articles
- **Approval Workflow** - Review before publishing
- **Auto-Post** - Schedule automatic posting
- **Quality Filters** - Filter unwanted content

### ✍️ Writing Features
- **Novels** - Serialized fiction
- **Chapters** - Organize content
- **Reading Progress** - Track readers

## 🚀 Quick Setup (5 Minutes)

### 1. Clone & Install
```bash
git clone https://github.com/YOUR_USERNAME/timzee-tech-blog.git
cd timzee-tech-blog
python -m http.server 5173
```

Then visit `http://localhost:5173`.

## Supabase setup

1. Run the SQL in `SUPABASE_SCHEMA.sql`.
2. Enable Realtime on:
   - `discussion_messages`
   - `direct_messages`
3. Create a Storage bucket named `media` and add policies for:
   - `covers/`, `comments/`, `post-media/`, `discussion/`, `topics/`, `direct-messages/`, `avatars/`, `ads/`, `themes/`
4. Create a super admin user in Supabase Auth and set:
   - `user_metadata.role = "super"`
5. In `assets/js/supabase.js`, set `SUPABASE_ANON_KEY` to the **anon/public** key from Supabase Settings → API.
   - Do **not** use the service_role key in frontend code.

## Netlify Functions

Functions live in `netlify/functions`.

Set these environment variables in Netlify:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional for the scout bot:
- `NEWS_FEEDS` (comma-separated RSS URLs)
- `NEWS_TIPS_FEEDS` (comma-separated RSS URLs)
- `NEWS_ENABLED` (true/false)
- `NEWS_POSTS_PER_RUN`
- `NEWS_AUTHOR_NAME`

## Deploy

Recommended: GitHub → Netlify (so functions run).
Drag-and-drop only deploys static files and will not run functions.
