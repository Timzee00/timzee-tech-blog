# 🔧 TECHNICAL REFERENCE - Developers

Complete technical documentation for developers working with the new moderator and curator systems.

---

## 📁 MODULE STRUCTURE

### moderator.js
Core moderator and author management functions.

```javascript
// Fetching
export async function getAllModerators()
export async function getAllAuthors()

// Moderators
export async function promoteToModerator(userId, userData)
export async function demoteModerator(moderatorUserId)
export async function toggleModeratorStatus(moderatorUserId, isActive)
export async function getModeratorPermissions(moderatorUserId)
export async function updateModeratorPermissions(moderatorUserId, permissions)

// Authors
export async function promoteToAuthor(userId, userData)
export async function demoteAuthor(authorUserId)
export async function toggleAuthorStatus(authorUserId, isActive)

// Utilities
export async function getUserForPromotion(userId)
export async function searchUsersForPromotion(query)
```

### moderator-ui.js
User interface component for team management.

```javascript
class ModeratorManager {
  async init(containerId)           // Initialize in a container
  async load()                       // Load data from database
  renderModerators()                 // Render moderators list
  renderAuthors()                    // Render authors list
  async handleModeratorAction()      // Handle moderator actions
  async handleAuthorAction()         // Handle author actions
  async handlePromoteSearch()        // Search for users to promote
  async showPromoteForm()            // Display promotion form
}

// Usage:
import ModeratorManager from "./moderator-ui.js";
const manager = new ModeratorManager();
await manager.init("container-id");
```

### curator.js
Core curator bot functions.

```javascript
// Sources
export async function getAllCuratorSources()
export async function getActiveCuratorSources()
export async function createCuratorSource(sourceData)
export async function updateCuratorSource(sourceId, sourceData)
export async function deleteCuratorSource(sourceId)
export async function toggleCuratorSourceStatus(sourceId, isActive)

// Posts
export async function getAllCuratorPosts(limit, offset)
export async function getUnpostedCuratorPosts(limit)
export async function createCuratorPost(postData)
export async function markCuratorPostAsPosted(curatorPostId, postId)
export async function deleteCuratorPost(curatorPostId)

// Settings
export async function getCuratorSettings()
export async function updateCuratorSettings(settingsData)
export async function getCuratorStats()

// Utilities
export async function testCuratorSource(sourceUrl, sourceType)
export async function importCuratorPostsFromSource(sourceId)
```

### curator-ui.js
User interface component for bot management.

```javascript
class CuratorManager {
  async init(containerId)           // Initialize in a container
  async load()                       // Load all data
  renderStats()                      // Render statistics
  renderSources()                    // Render source list
  renderPosts()                      // Render article queue
  async handleSourceAction()         // Handle source actions
  async handlePostAction()           // Handle article actions
  async handleAddSource()            // Process new source
  loadSettings()                     // Load settings into form
  async handleSaveSettings()         // Save settings changes
}

// Usage:
import CuratorManager from "./curator-ui.js";
const manager = new CuratorManager();
await manager.init("container-id");
```

---

## 🗄️ DATABASE SCHEMA

### moderators table
```sql
CREATE TABLE moderators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  username text,
  full_name text,
  email text,
  permissions text[] DEFAULT '{"manage_authors","manage_posts","moderate_comments"}'::text[],
  promoted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  promoted_at timestamp DEFAULT now(),
  is_active boolean DEFAULT true,
  created_at timestamp DEFAULT now(),
  notes text
);

-- Indexes
CREATE INDEX moderators_user_idx ON moderators(user_id);
CREATE INDEX moderators_active_idx ON moderators(is_active);

-- RLS Policies
-- Only super admin can manage
-- Moderators can view own profile
```

### authors table
```sql
CREATE TABLE authors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  username text,
  full_name text,
  email text,
  bio text,
  avatar_url text,
  post_count integer DEFAULT 0,
  promoted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  promoted_at timestamp DEFAULT now(),
  is_active boolean DEFAULT true,
  created_at timestamp DEFAULT now(),
  notes text
);

-- Indexes
CREATE INDEX authors_user_idx ON authors(user_id);
CREATE INDEX authors_active_idx ON authors(is_active);

-- RLS Policies
-- Admins/moderators can manage
-- Authors can view own profile
```

### curator_sources table
```sql
CREATE TABLE curator_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  url text UNIQUE NOT NULL,
  source_type text DEFAULT 'rss',  -- 'rss', 'api', 'webhook'
  description text,
  category text,
  is_active boolean DEFAULT true,
  last_fetched_at timestamp,
  fetch_frequency_minutes integer DEFAULT 60,
  api_key text,
  headers jsonb DEFAULT '{}'::jsonb,
  filter_keywords text[] DEFAULT '{}'::text[],
  exclude_keywords text[] DEFAULT '{}'::text[],
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamp DEFAULT now(),
  updated_at timestamp
);

-- Indexes
CREATE INDEX curator_sources_active_idx ON curator_sources(is_active);
CREATE INDEX curator_sources_type_idx ON curator_sources(source_type);
CREATE INDEX curator_sources_last_fetch_idx ON curator_sources(last_fetched_at);

-- RLS Policies
-- Admins/moderators can read
-- Super admin/admin can write
```

### curator_posts table
```sql
CREATE TABLE curator_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES curator_sources(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  content text,
  url text UNIQUE,
  author text,
  published_at timestamp,
  fetched_at timestamp DEFAULT now(),
  image_url text,
  tags text[] DEFAULT '{}'::text[],
  is_posted boolean DEFAULT false,
  post_id uuid REFERENCES posts(id) ON DELETE SET NULL,
  created_at timestamp DEFAULT now()
);

-- Indexes
CREATE INDEX curator_posts_source_idx ON curator_posts(source_id);
CREATE INDEX curator_posts_is_posted_idx ON curator_posts(is_posted);
CREATE INDEX curator_posts_published_idx ON curator_posts(published_at);

-- RLS Policies
-- Admins/moderators can read and write
```

### curator_settings table
```sql
CREATE TABLE curator_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_name text DEFAULT 'Timzee Tech Hub',
  api_key text NOT NULL,
  auto_post boolean DEFAULT false,
  auto_post_hour integer DEFAULT 9,        -- 0-23
  min_quality_score integer DEFAULT 60,    -- 0-100
  duplicate_check boolean DEFAULT true,
  notify_admins boolean DEFAULT true,
  max_posts_per_day integer DEFAULT 5,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

-- RLS Policies
-- Admin/super can read
-- Super admin only can write
```

---

## 🔐 SECURITY & RLS POLICIES

### Permission Hierarchy
```
SUPER ADMIN (auth.jwt() -> 'user_metadata' ->> 'role' = 'super')
├─ Full access to all tables
├─ Can manage moderators
├─ Can manage authors
├─ Can manage bot settings
└─ Enforced by RLS policies

ADMIN (auth.jwt() -> 'user_metadata' ->> 'role' = 'admin')
├─ Can read moderators/authors
├─ Can manage authors
├─ Can read bot sources/posts
└─ Cannot modify bot settings

MODERATOR (auth.jwt() -> 'user_metadata' ->> 'role' = 'moderator')
├─ Can read sources/posts
├─ Can manage authors
├─ Cannot access settings
└─ Cannot delete users

AUTHOR (In authors table with is_active=true)
├─ Can create posts
├─ Can upload media
└─ Cannot moderate anything

MEMBER (Regular user)
├─ Can comment
├─ Can participate
└─ Cannot access admin features
```

### RLS Policy Examples

```sql
-- Only super admin can manage moderators
CREATE POLICY "Super admins manage moderators" ON moderators
  FOR ALL
  USING ((auth.jwt() -> 'user_metadata' ->> 'role') = 'super')
  WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'role') = 'super');

-- Moderators see their own profile
CREATE POLICY "Moderators see own profile" ON moderators
  FOR SELECT
  USING (auth.uid() = user_id);

-- Admins can manage authors
CREATE POLICY "Admins manage authors" ON authors
  FOR ALL
  USING ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super','moderator'))
  WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super','moderator'));
```

---

## 🔗 INTEGRATION EXAMPLES

### Checking if User is Moderator
```javascript
import { getCurrentUser } from "./supabase.js";
import { getAllModerators } from "./moderator.js";

const user = await getCurrentUser();
const moderators = await getAllModerators();
const isModerator = moderators.some(m => m.user_id === user.id);
```

### Checking if User is Author
```javascript
import { getAllAuthors } from "./moderator.js";

const authors = await getAllAuthors();
const isAuthor = authors.some(a => a.user_id === user.id);

// Use in permissions check:
if (isAuthor) {
  showPostButton();
} else {
  showJoinAsAuthorButton();
}
```

### Fetching Unposted Articles
```javascript
import { getUnpostedCuratorPosts } from "./curator.js";

const articles = await getUnpostedCuratorPosts(20);
articles.forEach(article => {
  console.log(`${article.title} from ${article.curator_sources.name}`);
});
```

### Creating New RSS Source
```javascript
import { createCuratorSource } from "./curator.js";

const newSource = await createCuratorSource({
  name: "TechCrunch",
  url: "https://techcrunch.com/feed/",
  source_type: "rss",
  category: "Technology",
  description: "Latest tech news"
});
```

---

## 🧪 TESTING

### Unit Test Example
```javascript
import { getAllModerators, promoteToModerator } from "./moderator.js";

describe("Moderator Functions", () => {
  test("promoteToModerator creates new moderator", async () => {
    const userId = "test-user-id";
    const result = await promoteToModerator(userId, {
      username: "testuser",
      full_name: "Test User",
      email: "test@example.com"
    });
    
    expect(result).toBeDefined();
    expect(result[0].user_id).toBe(userId);
  });

  test("getAllModerators returns all moderators", async () => {
    const moderators = await getAllModerators();
    expect(Array.isArray(moderators)).toBe(true);
  });
});
```

### Integration Test Example
```javascript
import CuratorManager from "./curator-ui.js";

describe("CuratorManager", () => {
  test("CuratorManager initializes in container", async () => {
    const container = document.createElement("div");
    container.id = "test-curator";
    document.body.appendChild(container);

    const manager = new CuratorManager();
    await manager.init("test-curator");

    expect(container.innerHTML).toBeTruthy();
    expect(container.querySelector(".curator-manager")).toBeTruthy();
  });
});
```

---

## 🐛 DEBUGGING

### Enable Detailed Logging
```javascript
// Add to modules for debugging
const DEBUG = true;

function log(...args) {
  if (DEBUG) {
    console.log("[Moderator System]", ...args);
  }
}

// Usage in functions:
log("Promoting user:", userId);
```

### Common Issues & Solutions

**Issue:** RLS policy blocking queries
```javascript
// Check if user has correct role
const user = await supabase.auth.getUser();
console.log("Current role:", user.user.user_metadata?.role);

// Verify policies in Supabase dashboard
```

**Issue:** Empty results from database
```javascript
// Check if data exists
const { data, error, status } = await supabase
  .from("moderators")
  .select("*");

console.log("Status:", status);
console.log("Error:", error);
console.log("Data:", data);
```

**Issue:** UI not updating after action
```javascript
// Make sure to call load() after changes
await promoteToModerator(userId, data);
await this.load();  // Refresh all data
this.renderModerators();  // Re-render UI
```

---

## 📊 QUERY EXAMPLES

### Get Active Moderators with Details
```sql
SELECT 
  m.*,
  p.display_name,
  p.avatar_url
FROM moderators m
LEFT JOIN profiles p ON m.user_id = p.id
WHERE m.is_active = true
ORDER BY m.promoted_at DESC;
```

### Get Articles Pending Review
```sql
SELECT 
  cp.*,
  cs.name as source_name,
  cs.category
FROM curator_posts cp
LEFT JOIN curator_sources cs ON cp.source_id = cs.id
WHERE cp.is_posted = false
ORDER BY cp.published_at DESC
LIMIT 20;
```

### Get Author Statistics
```sql
SELECT 
  a.id,
  a.full_name,
  a.username,
  COUNT(p.id) as total_posts,
  MAX(p.created_at) as last_post_date
FROM authors a
LEFT JOIN posts p ON a.user_id = p.author_id
WHERE a.is_active = true
GROUP BY a.id, a.full_name, a.username
ORDER BY total_posts DESC;
```

### Get Bot Activity Summary
```sql
SELECT 
  DATE(cp.fetched_at) as date,
  COUNT(*) as total_fetched,
  SUM(CASE WHEN is_posted THEN 1 ELSE 0 END) as posted_count,
  cs.name as source
FROM curator_posts cp
LEFT JOIN curator_sources cs ON cp.source_id = cs.id
GROUP BY DATE(cp.fetched_at), cs.name
ORDER BY date DESC;
```

---

## 🚀 PERFORMANCE TIPS

### Optimize Queries
```javascript
// ❌ Inefficient - fetches everything
const all = await getAllModerators();
const active = all.filter(m => m.is_active);

// ✅ Better - filters at database
const active = await supabase
  .from("moderators")
  .select("*")
  .eq("is_active", true);
```

### Use Pagination
```javascript
// Get 50 at a time
const page1 = await getAllCuratorPosts(50, 0);
const page2 = await getAllCuratorPosts(50, 50);
```

### Cache Results
```javascript
class CuratorManager {
  constructor() {
    this.cache = {
      sources: null,
      posts: null,
      lastUpdate: 0
    };
  }

  async getSources(forceRefresh = false) {
    if (!forceRefresh && this.cache.sources && Date.now() - this.cache.lastUpdate < 60000) {
      return this.cache.sources;
    }
    this.cache.sources = await getAllCuratorSources();
    this.cache.lastUpdate = Date.now();
    return this.cache.sources;
  }
}
```

---

## 📝 CODE CONVENTIONS

### Naming
- Use camelCase for functions: `promoteToModerator()`
- Use PascalCase for classes: `ModeratorManager`
- Use UPPER_SNAKE_CASE for constants: `DEFAULT_FETCH_INTERVAL`

### Comments
```javascript
/**
 * Promote a user to moderator
 * @param {string} userId - The user ID to promote
 * @param {Object} userData - User data (username, email, etc)
 * @returns {Promise<Array>} Updated moderator record
 * @throws {Error} If promotion fails
 */
export async function promoteToModerator(userId, userData) {
  // Implementation
}
```

### Error Handling
```javascript
try {
  const result = await promoteToModerator(userId, data);
  console.log("✓ Promoted successfully");
  return result;
} catch (error) {
  console.error("✗ Promotion failed:", error);
  throw new Error(`Failed to promote user: ${error.message}`);
}
```

---

## 📚 FURTHER READING

- Supabase Documentation: https://supabase.com/docs
- JavaScript Async/Await: https://developer.mozilla.org/en-US/docs/Learn/JavaScript/Asynchronous
- Database Design: https://en.wikipedia.org/wiki/Database_design
- Row Level Security: https://supabase.com/docs/guides/auth/row-level-security

---

## 🤝 CONTRIBUTING

When adding new features:
1. Follow naming conventions above
2. Add JSDoc comments
3. Include error handling
4. Add RLS policies to database
5. Update this documentation
6. Test thoroughly

---

**For support, see MODERATOR_AND_CURATOR_SETUP_GUIDE.md**
