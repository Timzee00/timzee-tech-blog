# Timzee Tech Hub - Implementation Guide

## Phase 1: Critical Fixes (URGENT)

### 1. Fix Search Bar
- **Issue**: Search not triggering properly
- **Solution**: Add `.slice()`  check to prevent partial results, ensure textSearch is properly configured
- **File**: `assets/js/app.js` - `performSearch()` function
- **Status**: Check if search_vector column is populated for all posts

### 2. Fix Real-Time Messaging (No Refresh Needed)
- **File**: `assets/js/chat.js`
- **Implementation**: 
  - Add Realtime subscription to `direct_messages` table
  - Subscribe on message load
  - Automatically append new messages to state
  - Auto-scroll to bottom
- **Code Location**: `subscribeToMessages()` function already exists but may need refinement

### 3. Fix Slow Loading & Mobile Performance
- **Issues**:
  - App loads ALL posts/comments at once (no pagination)
  - Mobile renders unnecessary elements
  - Realtime subscriptions not cleaned up
- **Solutions**:
  - Add `.range(offset, offset+limit-1)` to all list queries
  - Implement lazy loading
  - Load 10-20 items per page instead of 1000
  - Clean up subscriptions on navigation
- **Functions Added**: `fetchPostsWithPagination()`, `fetchCommentsWithPagination()` in data.js

### 4. Fix Scout Bot (News Not Working)
- **File**: `netlify/functions/scout-news.js`
- **Check**:
  - Environment variables set: `NEWS_FEEDS`, `NEWS_ENABLED`
  - Database table: `curator_sources` exists
  - Function deployed to Netlify
  - Check Netlify logs for errors
- **Test**: POST to `/.netlify/functions/scout-news` with `?manual=true`

### 5. Enhance Notifications
- **New Types to Add**:
  - Friend requests ✅ (function added)
  - Admin promotions ✅ (function added)
  - Mentions ✅ (function added)
  - Comment replies ✅ (function added)
  - Verification status ✅ (function added)
- **Functions**: Added to `data.js` - `notify*()` functions
- **Subscribe**: Listen to `notifications` table in UI

---

## Phase 2: Major Features (This Week)

### 1. Videos (TikTok-Style)
- **Database**: `videos`, `video_comments`, `video_likes` tables created
- **Functions**: `assets/js/videos-marketplace.js` - all functions implemented
- **Features**:
  - Upload video with thumbnail
  - Search videos by title/description
  - Like/unlike videos
  - Comment on videos with replies
  - Track views
- **TODO - UI**: Create `videos.html` page and video player component

### 2. Marketplace (Facebook-Style)
- **Database**: `marketplace_items`, `inquiries`, `transactions`, `reviews` created
- **Functions**: `assets/js/videos-marketplace.js` - all functions implemented
- **Features**:
  - Create/update/delete listings
  - Search by category and keywords
  - Buyer inquiries
  - Transaction management
  - Seller ratings and reviews
- **TODO - UI**: Create `marketplace.html` page and listing components

### 3. Mentions & Replies
- **Database**: Added `reply_to` and `mentions[]` columns to:
  - `comments` table
  - `direct_messages` table
  - `video_comments` table
- **Features**:
  - @mention users in comments
  - Reply to specific messages
  - Auto-notify mentioned users
  - Quote previous messages
- **TODO - Implementation**: 
  - Add mention parser (regex to find @username)
  - Add reply UI components
  - Auto-notify mentioned users

---

## Phase 3: AI & Verification (Next 2 Days)

### 1. Groq AI Integration
- **File**: `assets/js/groq.js` - Fully implemented
- **Setup Required**:
  ```javascript
  import { setGroqApiKey } from './groq.js';
  setGroqApiKey('your-groq-api-key');
  ```
- **Features**:
  - Chat with history
  - Generate content ideas
  - SEO optimization
  - Code help
  - Writing improvement
  - Content moderation
- **Usage Example**:
  ```javascript
  const response = await chat({
    message: "Help me write a blog post about Web3",
    systemPrompt: SYSTEM_PROMPTS.contentIdeas
  });
  ```

### 2. Verification System
- **Database**: 
  - `verification_badges` table
  - `verification_applications` table
  - New columns in `profiles`
- **Levels**: none, silver, gold, platinum, blue_check, business
- **Functions**: All added to `data.js`
- **Features**:
  - Users apply for verification
  - Admins review and approve
  - Badges show on profiles
  - Custom name colors
  - Special profile designs
  - Expiration handling
- **TODO - UI**: Create verification application form and badge display

### 3. Profile Privacy
- **Feature**: Users can make profiles private/public
- **Function**: `updateProfilePrivacy(userId, isPrivate)` in data.js
- **Effects**:
  - Private profiles not visible to non-followers
  - Private messages disabled unless friend
  - Private posts not in public feed

---

## Phase 4: Configuration & Deployment

### Environment Variables Needed

**For Scout Bot (Netlify Functions):**
```
SUPABASE_URL=your-url
SUPABASE_SERVICE_ROLE_KEY=your-key
NEWS_FEEDS=https://rss.feed.com/1,https://rss.feed.com/2
NEWS_ENABLED=true
NEWS_POSTS_PER_RUN=5
```

**For Frontend (localStorage):**
```javascript
// Groq API Key - Set in settings UI
localStorage.setItem('groq_api_key', 'gsk_...');
```

### Database Setup

1. **Run SCHEMA_EXTENSIONS.sql in Supabase SQL editor**
2. **Enable Realtime on new tables**:
   - videos
   - video_comments
   - video_likes
   - marketplace_items
   - direct_messages
   - notifications
   - ai_messages
3. **Create Storage Buckets** (if not exists):
   - media (for videos, marketplace photos)
   - Folders: videos/, video-thumbnails/, marketplace/

### Realtime Setup Example

```javascript
// Subscribe to new messages in real-time
const channel = supabase
  .channel(`direct-${threadId}`)
  .on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'direct_messages',
      filter: `thread_id=eq.${threadId}`
    },
    (payload) => {
      // Handle new message
      console.log('New message:', payload.new);
    }
  )
  .subscribe();
```

---

## Files Created

1. ✅ `SCHEMA_EXTENSIONS.sql` - Extended database schema
2. ✅ `assets/js/groq.js` - Groq AI integration
3. ✅ `assets/js/videos-marketplace.js` - Video and marketplace functions
4. ✅ Updated `assets/js/data.js` - Added notifications and verification

## Files To Create (UI)

- [ ] `videos.html` - Video discovery feed
- [ ] `video-upload.html` - Video upload
- [ ] `marketplace.html` - Marketplace listing
- [ ] `marketplace-create.html` - Create listing
- [ ] `verification.html` - Verification app
- [ ] `ai-chat.html` - AI chat interface

## What Still Needs Work

### High Priority
- [ ] Fix search bar (test and verify)
- [ ] Add pagination to all list queries
- [ ] Create video UI components
- [ ] Create marketplace UI
- [ ] Fix scout bot (debug Netlify function)
- [ ] Add Realtime message subscriptions

### Medium Priority
- [ ] Mention and reply UI components
- [ ] Verification badge UI
- [ ] Privacy settings in profile
- [ ] Groq AI chat UI

### Low Priority
- [ ] Message editing
- [ ] Message reactions
- [ ] Video recommendations
- [ ] Marketplace ratings display

---

## Testing Checklist

- [ ] Search works on home page
- [ ] Messages appear without page refresh
- [ ] App loads in <2 seconds on mobile
- [ ] Scout bot creates draft posts
- [ ] Notifications for friend requests
- [ ] Verification application works
- [ ] Groq AI responds to prompts
- [ ] Videos upload and play
- [ ] Marketplace listings appear

---

## Quick Start for User

1. **Add Groq API Key**:
   ```javascript
   import groq from './assets/js/groq.js';
   groq.setGroqApiKey('your-key-here');
   ```

2. **Run Database Schema**:
   - Copy `SCHEMA_EXTENSIONS.sql`
   - Paste into Supabase SQL Editor
   - Run

3. **Enable Realtime** in Supabase:
   - Go to Replication
   - Add tables: videos, direct_messages, notifications

4. **Test Search**:
   - Go to index.html
   - Type in search box
   - Should see results

5. **Check Scout Bot**:
   - Go to Netlify dashboard
   - Check function logs
   - Manually trigger function
