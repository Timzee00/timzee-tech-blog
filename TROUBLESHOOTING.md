# 🔧 TROUBLESHOOTING: Admin Login & Video Upload Errors

## ❌ Error 1: "Failed to Fetch" on Admin Login

### Causes:
1. **Supabase URL or API key incorrect** - Check configuration in `assets/js/supabase.js`
2. **Network/CORS issue** - Browser can't reach Supabase
3. **Supabase project not active** - Check Supabase dashboard
4. **Wrong email/password** - Typo in credentials
5. **User not created** - Admin account doesn't exist in auth

### Solutions:

**Step 1: Verify Supabase Configuration**
```javascript
// In assets/js/supabase.js, check these are correct:
const SUPABASE_URL = "https://duvbcwwprkzzyzikmcol.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...";
```
- Go to Supabase Dashboard > Settings > API Keys
- Copy the ANON key (not service_role)
- Make sure URL matches exactly

**Step 2: Check Browser Console**
- Open DevTools (F12)
- Go to Console tab
- Try login again
- Look for detailed error messages
- Screenshot and share the error

**Step 3: Verify Admin User Exists**
- Go to Supabase > Auth Users
- Check if your email address is listed
- If not listed, create a new auth user with admin email
- Set a password

**Step 4: Create Profile Record**
- Go to Supabase > SQL Editor
- Run this query:
```sql
INSERT INTO profiles (id, email, display_name, username, role)
SELECT 
  id,
  email,
  'Admin',
  split_part(email, '@', 1),
  'admin'
FROM auth.users
WHERE email = 'your-admin-email@example.com'
AND id NOT IN (SELECT id FROM profiles);
```
- Replace `your-admin-email@example.com` with actual email

**Step 5: Check Network Connection**
- Make sure you can reach `https://duvbcwwprkzzyzikmcol.supabase.co`
- Open it in browser - should show an error page (that's OK)
- If can't reach it, network/firewall issue

---

## ❌ Error 2: "Violate RLS Policy" on Video Upload

### Root Cause:
Storage RLS policies are too restrictive OR user doesn't have admin role

### Solutions:

**Step 1: Run the RLS Fix Script**
1. Open Supabase > SQL Editor
2. Copy contents of `FIX_RLS_POLICIES.sql` from your project
3. Paste into SQL Editor
4. Click "Run"
5. Check for success message ✓

**Step 2: Verify Admin Role**
In Supabase SQL Editor, run:
```sql
SELECT 
  id,
  email,
  user_metadata ->> 'role' as role_in_jwt,
  (SELECT role FROM profiles WHERE id = auth.users.id) as role_in_db
FROM auth.users
WHERE email = 'your-admin-email@example.com';
```

Expected output:
- `role_in_jwt`: should be `admin` or `super`
- `role_in_db`: should be `admin` or `super`

**Step 3: If Role is Missing/Wrong**
Run this to fix:
```sql
UPDATE profiles 
SET role = 'admin' 
WHERE email = 'your-admin-email@example.com';
```

Or if profile record doesn't exist:
```sql
INSERT INTO profiles (id, email, display_name, username, role)
SELECT 
  id,
  email,
  'Admin',
  split_part(email, '@', 1),
  'admin'
FROM auth.users
WHERE email = 'your-admin-email@example.com'
AND id NOT IN (SELECT id FROM profiles);
```

**Step 4: Clear Browser Cache**
1. Press Ctrl+Shift+Delete (or Cmd+Shift+Delete on Mac)
2. Clear "Cookies and other site data"
3. Clear "Cached images and files"
4. Logout and login again

**Step 5: Try Upload Again**
- Use video/image file < 50MB
- Supported formats: MP4, WebM, JPG, PNG, GIF
- Try small file first (< 10MB)

---

## ✅ Verification Checklist

After fixes, verify everything works:

### Login Test
- [ ] Can access `/admin/login.html`
- [ ] Can enter email and password without errors
- [ ] See detailed error if login fails (not just "failed to fetch")
- [ ] Successfully redirected to dashboard after login
- [ ] Admin panel loads all tabs correctly

### Upload Test
- [ ] Go to admin dashboard > Compose tab
- [ ] Try uploading a small image (< 5MB)
- [ ] See upload progress
- [ ] Image appears in preview
- [ ] Can publish post with image

### More Checks
- [ ] Announcements tab works
- [ ] Curator Bot tab works
- [ ] Can create announcement
- [ ] Can add RSS feed source
- [ ] No console errors (F12)

---

## 🆘 If Still Not Working

### Collect This Info:
1. **Browser Console Error** - F12 → Console → Screenshot
2. **Browser Type** - Chrome/Firefox/Safari/Edge?
3. **Error Message Exact Text** - Copy paste
4. **Network Tab** - F12 → Network → Screenshot of failed request
5. **Supabase Status** - Check if project is active in dashboard

### Common Issues:

| Error | Cause | Fix |
|-------|-------|-----|
| 401 Unauthorized | Wrong credentials | Reset password in Supabase |
| 403 Forbidden | Wrong role | Update role in profiles table |
| Network error | Supabase down | Check status.supabase.io |
| CORS error | Browser security | Check Supabase > Auth > Redirect URLs |
| timeout | Slow network | Try with better connection |

---

## 📞 Need More Help?

1. Check the browser console (F12) for exact error message
2. Check Supabase SQL Editor for data integrity
3. Verify all tables exist: `auth.users`, `profiles`, `announcements`, `curator_sources`
4. Make sure storage bucket `media` exists with correct policies
5. Try in an incognito/private browser window to rule out cache issues
