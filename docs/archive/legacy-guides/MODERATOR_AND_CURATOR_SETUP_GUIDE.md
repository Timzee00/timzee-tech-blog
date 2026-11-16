# Professional Setup Guide - Moderators, Authors & Curator Bot

Welcome! This guide explains how to manage your team and automate content curation. Everything is designed to be easy - no technical knowledge required!

---

## 📋 TABLE OF CONTENTS

1. **Role System** - Understanding moderators and authors
2. **Managing Moderators** - Promote/demote team members
3. **Managing Authors** - Give users posting rights
4. **Curator Bot Setup** - Automate content from RSS feeds
5. **FAQ** - Common questions

---

## 🏛️ ROLE SYSTEM EXPLAINED

Your website has three levels of control:

### 1. **Super Admin** (That's you!)
- Full control of everything
- Can promote/demote moderators and authors
- Can configure bot settings
- Access to all admin features

### 2. **Moderators** (Team Members)
- **What they can do:**
  - Approve/reject comments
  - Manage content authors
  - Remove inappropriate posts
  - Moderate discussions
  
- **What they CANNOT do:**
  - Create posts themselves
  - Delete users
  - Access bot settings

- **Best for:** Trusted team members who help manage community

### 3. **Authors** (Content Creators)
- **What they can do:**
  - Create and publish posts
  - Write articles
  - Upload images/media
  - View analytics for their posts

- **What they CANNOT do:**
  - Moderate others' content
  - Delete posts from other authors
  - Access admin settings

- **Best for:** Writers, journalists, contributors

---

## 👮 MANAGING MODERATORS

### How to Promote Someone to Moderator

1. Go to **Admin Dashboard**
2. Click **"⬆️ Promote User"** tab
3. Search for the person by:
   - Username (e.g., "john_doe")
   - Full name
   - Email address
4. Click on their profile
5. Select **"👮 Moderator"** option
6. (Optional) Add notes like "Approves tech articles"
7. Click **"✓ Confirm Promotion"**

### Managing Active Moderators

1. In Admin Dashboard, click **"👮 Team Moderators"**
2. You'll see all moderators:

   For each moderator, you can:
   - **🟢 Active / ⚪ Inactive** - Temporarily pause their access
   - **✕ Demote** - Remove moderator status
   - View when they were promoted and by whom

### Best Practices

✅ **DO:**
- Promote trusted, active community members
- Give moderators a clear role (e.g., "Tech news moderator")
- Check in monthly on their activity
- Thank them regularly!

❌ **DON'T:**
- Promote too many people at once
- Give moderator access to inactive users
- Forget to remove access when someone leaves

---

## ✍️ MANAGING AUTHORS

### How to Promote Someone to Author

1. Go to **Admin Dashboard**
2. Click **"⬆️ Promote User"** tab
3. Search for the writer
4. Click their profile
5. Select **"✍️ Author"** option
6. Add notes like "Tech tutorials" (optional)
7. Click **"✓ Confirm Promotion"**

### Managing Active Authors

1. Click **"✍️ Content Authors"** tab
2. See all authors and their:
   - Number of posts published
   - Status (active/inactive)
   - When they were promoted

3. Actions:
   - **🟢 Active / ⚪ Inactive** - Pause posting temporarily
   - **✕ Demote** - Remove author status
   - View total posts they've created

### Best Practices

✅ **DO:**
- Promote writers who write consistently
- Create different "sections" for different authors
- Set expectations (2 posts/week, etc.)
- Highlight their best work

❌ **DON'T:**
- Give author access to inactive users
- Promote someone just to promote them
- Forget to remove access for writers who leave

---

## 🤖 CURATOR BOT - AUTOMATED CONTENT

Your Curator Bot automatically fetches articles from RSS feeds and other sources. Perfect for:
- Tech news updates
- Industry news aggregation
- Keeping content fresh without manual work

### 🚀 Quick Setup (5 minutes)

#### Step 1: Add Your First Source

1. Go to **Admin Dashboard**
2. Click **"📡 Manage Sources"**
3. Click **"+ Add Source"** button
4. Fill in:

   **Source Name:** (e.g., "TechCrunch News")
   
   **RSS/API URL:** (The web address of the feed)
   ```
   Example RSS feeds:
   - TechCrunch: https://techcrunch.com/feed/
   - Hacker News: https://news.ycombinator.com/rss
   - Medium Tech: https://medium.com/feed/tag/technology
   ```
   
   **Source Type:** RSS Feed
   
   **Category:** (What type of content? e.g., "Technology", "Startups")
   
   **Description:** Why is this important? (e.g., "Latest tech news for our community")

5. Click **"✓ Add Source"**
6. Bot automatically tests the connection ✓

#### Step 2: Configure Bot Settings

1. Click **"⚙️ Bot Settings"** tab
2. Choose your preferences:

   | Setting | What it means | Our recommendation |
   |---------|--------------|-------------------|
   | Auto-Post Mode | Automatically post approved articles | Turn ON for busy sites |
   | Post Time | What time to auto-post (if enabled) | 9:00 AM usually works well |
   | Quality Score | How good must articles be? (0-100) | Set to 60-70 |
   | Max Posts/Day | Limit daily posts to prevent spam | 5-10 is good |
   | Check Duplicates | Don't post same article twice | Keep ON |
   | Notify Admins | Ping you when posts go live | Keep ON |

3. Click **"💾 Save Settings"**

### 📰 Reviewing Articles

1. Click **"📰 Articles"** tab
2. You'll see pending articles from all sources
3. For each article:
   - **✓ Approve & Post** - Publishes it immediately
   - **✕ Reject** - Deletes it (no publishing)

4. Articles are sorted by newest first
5. Approval queue shows: Title, Source, Date

### 📊 Dashboard Overview

**At-a-glance stats:**
- **Active Sources:** How many RSS feeds are active
- **Pending Articles:** How many are waiting for approval
- **Last Sync:** When bot last checked for new articles
- **Total Posted:** How many articles published via bot

---

## 🔧 POPULAR RSS FEEDS TO ADD

Copy and paste these URLs:

### Tech News
```
TechCrunch:
https://techcrunch.com/feed/

Hacker News:
https://news.ycombinator.com/rss

Product Hunt:
https://www.producthunt.com/feed.xml

The Verge:
https://www.theverge.com/rss/index.xml
```

### Business/Startups
```
Medium - Startups:
https://medium.com/feed/tag/startup

Inc.com:
https://www.inc.com/feed

Entrepreneur:
https://www.entrepreneur.com/feed
```

### Design/UX
```
Designer Hangout:
https://feeds.designerhangout.co/all

Nielsen Norman:
https://www.nngroup.com/feed/rss/
```

---

## ❓ FAQ

### Q: Can I give someone multiple roles?
**A:** No. One user = one role. But you can:
- Demote them from one role
- Promote them to another
- Choose the best fit for them

### Q: What if I make a mistake promoting someone?
**A:** No problem! Just click **"✕ Demote"** to remove their role. They can be re-promoted later.

### Q: Can moderators see who promoted them?
**A:** Yes, it shows in their profile for transparency.

### Q: Why is the bot showing "Connection Error"?
**A:** The RSS feed URL might be:
- Incorrect or outdated
- No longer active
- Behind a paywall
- Changed location

**Fix:** Delete it and add a different source.

### Q: Can I schedule posts instead of auto-posting?
**A:** Currently auto-posts at set time. For custom scheduling:
- Turn OFF auto-post
- Review articles in queue
- Click "Approve & Post" when ready

### Q: How often does the bot check for new articles?
**A:** Every 60 minutes by default. You can change this per source if needed.

### Q: Do I need technical knowledge?
**A:** No! Everything is designed for non-technical users. Just:
- Add sources (copy/paste URLs)
- Approve articles (click buttons)
- Adjust settings (toggle switches)

### Q: What happens if I disable a moderator?
**A:** They keep their account but can't moderate. Re-enable them anytime.

---

## 📞 TROUBLESHOOTING

### Problem: "Access Denied"
- **Cause:** You're not logged in as Super Admin
- **Fix:** Log out and log back in with super admin account

### Problem: Source says "Inactive"
- **Cause:** Bot couldn't connect to that feed
- **Fix:** Check the URL is correct, or try a different source

### Problem: No new articles appearing
- **Cause:** 
  - Bot runs every hour (check back later)
  - No new articles in sources
  - Quality score too high
- **Fix:** Wait an hour, add more sources, or lower quality threshold

### Problem: Too many posts per day
- **Cause:** Quality score is too low (accepting bad articles)
- **Fix:** Increase Quality Score in settings to 70-80

---

## 💡 TIPS FOR SUCCESS

1. **Start small:** Add 2-3 sources first, then grow
2. **Review regularly:** Check articles queue daily
3. **Team communication:** Tell moderators what you expect
4. **Celebrate authors:** Highlight their best posts
5. **Monitor bot:** Check stats daily to ensure it's working
6. **Test sources:** When adding new feed, manually check it works
7. **Have backups:** Keep list of author/moderator names somewhere safe

---

## 🎯 NEXT STEPS

1. ✅ Promote your first moderator
2. ✅ Add 3-5 content authors
3. ✅ Add first RSS source
4. ✅ Configure bot settings
5. ✅ Approve first article
6. ✅ Check back tomorrow for new content

**You're all set!** Your website now runs with a team and automated content. Enjoy! 🚀
