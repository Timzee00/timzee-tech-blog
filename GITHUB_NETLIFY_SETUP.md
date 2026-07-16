# 🚀 GitHub & Netlify Auto-Deployment Setup Guide

**Goal:** Push code to GitHub → Netlify automatically deploys → Your site is live  
**Time Required:** 15 minutes

---

## Step 1: Create GitHub Repository

### If you DON'T have GitHub yet:
1. Go to https://github.com/signup
2. Create a free account
3. Choose a username (e.g., `yourusername`)
4. Verify email

### Create a New Repository:
1. Click **"+"** → **"New repository"**
2. **Name:** `timzee-tech-blog` (or whatever you want)
3. **Description:** "Tech blog with moderators and curator bot"
4. **Public** (so Netlify can access it)
5. **Add .gitignore:** Select "Node" from dropdown
6. Click **"Create repository"**

---

## Step 2: Prepare Your Code

### Create .gitignore (if not already there)
Create file: `.gitignore`
```
# Dependencies
node_modules/
package-lock.json

# Environment variables (DO NOT COMMIT SECRETS)
.env
.env.local
.env.*.local
netlify/.env

# Build outputs
dist/
build/
.cache/

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Netlify
.netlify/

# Groq API Key and other secrets
SECURITY_FIXES.md  # Remove this after implementation
groq_api_key.txt
secrets.json
```

### Create .env.example (template for team)
Create file: `.env.example`
```
# Environment Variables Template
# Copy this to .env and fill in real values (locally only)

GROQ_API_KEY=paste_your_actual_key_here
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_public_key
```

**IMPORTANT:** Don't add the actual `.env` file to GitHub!

---

## Step 3: Setup Local Git

### In VS Code Terminal:

```bash
# Navigate to your project
cd "c:/Users/USER-PC/Desktop/Vs Code/timzee-tech-blog-main"

# Initialize git (if not done)
git init

# Add all files
git add .

# Make first commit
git commit -m "Initial commit: Tech blog with moderators, curator bot, and security fixes"

# Add GitHub remote
git remote add origin https://github.com/YOUR_USERNAME/timzee-tech-blog.git

# Rename branch to main (GitHub default)
git branch -M main

# Push to GitHub
git push -u origin main
```

After running `git push`, it will ask for credentials:
- **Username:** Your GitHub username
- **Password:** Your GitHub personal access token (see below)

### Create GitHub Personal Access Token:
1. Go to https://github.com/settings/tokens
2. Click **"Generate new token (classic)"**
3. **Name:** "Netlify Deployment"
4. **Expiration:** 90 days
5. **Scopes:** Check `repo` (full control of private repos)
6. Click **"Generate token"**
7. **COPY IT** (you'll only see it once!)
8. Use this token when Git asks for password

---

## Step 4: Connect Netlify to GitHub

### Login to Netlify:
1. Go to https://netlify.com
2. Click **"Sign up"** → **"Sign up with GitHub"**
3. Authorize Netlify to access GitHub

### Create New Site:
1. Click **"Add new site"** → **"Import an existing project"**
2. Select **"GitHub"**
3. **Authorize** Netlify to access GitHub
4. **Select repository:** `timzee-tech-blog`
5. Click **"Deploy site"**

Netlify will automatically:
- Detect Node.js project
- Run `npm install`
- Run `npm run build` (if defined)
- Deploy to live URL

---

## Step 5: Add Environment Variables to Netlify

### Add Secrets to Netlify:
1. Go to your Netlify site dashboard
2. Click **"Site settings"** → **"Build & deploy"**
3. Scroll to **"Environment"** section
4. Click **"Edit variables"**
5. Add secrets (DO NOT commit these to GitHub):

```
GROQ_API_KEY = your_actual_groq_api_key_here
SUPABASE_URL = your_supabase_project_url
SUPABASE_ANON_KEY = your_supabase_public_key
```

Netlify will inject these into build process.

---

## Step 6: Test Auto-Deployment

### Make a small change and push:
```bash
# Edit any file
# Example: Change a comment in post.js

git add .
git commit -m "Test: Verify auto-deployment working"
git push origin main
```

**Watch Netlify Dashboard:**
1. Go to your Netlify site
2. Click **"Deploys"**
3. You should see a new deployment starting
4. Wait for it to finish (usually 2-3 minutes)
5. Your site is live with the new code!

---

## Step 7: Configure Build Settings (Optional)

### If you want custom build process:

Create `netlify.toml` in your root directory:
```toml
[build]
  command = "npm run build"
  functions = "netlify/functions"
  publish = "dist"

[[env.production]]
  environment = { NODE_ENV = "production" }

# Redirects (if using SPA)
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

# Custom headers
[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "SAMEORIGIN"
    X-Content-Type-Options = "nosniff"
    X-XSS-Protection = "1; mode=block"
    Referrer-Policy = "strict-origin-when-cross-origin"
```

---

## ✅ Auto-Deployment Workflow

After setup, your workflow is:

```
1. Make changes locally
   ↓
2. Test on localhost
   ↓
3. Commit: git add . && git commit -m "message"
   ↓
4. Push: git push origin main
   ↓
5. Netlify automatically deploys
   ↓
6. Site is live at https://yoursite.netlify.app
```

**That's it!** Every push automatically deploys.

---

## 🔧 Useful Commands

### Update your code locally from GitHub:
```bash
git pull origin main
```

### See commit history:
```bash
git log --oneline
```

### Create a new branch (for testing):
```bash
git checkout -b feature/mobile-fixes
# Make changes
git add .
git commit -m "Fix: Mobile responsiveness"
git push origin feature/mobile-fixes
# Then create "Pull Request" on GitHub to merge to main
```

### Revert a bad deployment:
```bash
git revert HEAD  # Undo last commit
git push origin main  # Netlify will redeploy
```

---

## 📝 Deployment Checklist

Before first deployment, ensure:

- [ ] `.gitignore` includes `node_modules`, `.env`, `.secrets`
- [ ] `.env.example` exists (without real values)
- [ ] `netlify.toml` is configured
- [ ] Environment variables added to Netlify dashboard
- [ ] All critical security fixes applied
- [ ] Tests pass locally (`npm test` if available)
- [ ] No `console.log` debug statements in production code
- [ ] API keys not hardcoded anywhere
- [ ] GROQ_API_KEY set in Netlify environment

---

## 🚨 Security Reminders

**DO:**
- ✅ Keep `.env` file local only (never push to GitHub)
- ✅ Use Netlify environment variables for secrets
- ✅ Rotate API keys periodically
- ✅ Use branch protection (require PR review before merge to main)

**DON'T:**
- ❌ Commit `.env` file
- ❌ Put API keys in code
- ❌ Push `SECURITY_FIXES.md` to public repo (after implementing)
- ❌ Commit sensitive data

---

## Troubleshooting

### Netlify deployment fails:
1. Check **Deploys** tab for error message
2. Usually missing dependencies - check `package.json`
3. Click deployment → **"Deploy log"** to see full error
4. Fix locally, commit, push again

### Site shows old version:
1. Clear browser cache (Ctrl+Shift+Delete)
2. Hard refresh (Ctrl+Shift+R)
3. Check Netlify shows latest deployment

### Environment variables not working:
1. Verify they're set in Netlify dashboard
2. Check spelling matches exactly
3. Rebuild site (Netlify → Deploys → Trigger deploy)

---

## 🎉 You're Done!

Your website now has:
- ✅ Code backed up on GitHub
- ✅ Automatic deployment on every push
- ✅ Secrets managed securely
- ✅ Team collaboration ready
- ✅ One-click rollback if needed

**Next:** Share GitHub link with team members to collaborate!

---

**Need help?**
- Netlify docs: https://docs.netlify.com
- GitHub docs: https://docs.github.com
- Ask in Netlify community: https://community.netlify.com
