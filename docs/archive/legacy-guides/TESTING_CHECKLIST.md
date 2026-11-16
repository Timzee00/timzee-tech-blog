# 🧪 Testing Checklist - Timzee Tech Hub

## Pre-Deployment Testing Guide

Use this checklist to validate all features before going live.

---

## ✅ Phase 1: Setup Verification (Do First)

- [ ] Database schema executed (7 new tables created)
- [ ] Realtime publication enabled on all tables
- [ ] Groq API key added and tested in ai-settings.html
- [ ] Scout bot environment variables configured in Netlify
- [ ] All files saved and deployed to production

---

## 🔍 Phase 2: Core Features Testing

### 2.1 Search Functionality
- [ ] Go to `index.html` (homepage)
- [ ] Type search term (e.g., "tech") in search bar
- [ ] Results appear within 1 second
- [ ] No errors in console
- [ ] Search works on mobile (landscape and portrait)
- [ ] Empty search shows all posts
- [ ] Clicking result opens post detail

### 2.2 Real-Time Messaging
- [ ] Go to `chat.html`
- [ ] Open same chat in two browser tabs
- [ ] Send message from Tab 1
- [ ] Tab 2 shows message immediately (NO page refresh)
- [ ] Message appears in correct thread
- [ ] Typing indicator shows (if implemented)
- [ ] Test on slow 3G network (DevTools)

### 2.3 Performance & Mobile
- [ ] Open DevTools → Mobile emulation
- [ ] Set to iPhone 12 or Pixel 5
- [ ] Reload homepage - should load in < 2 seconds
- [ ] Try "Slow 3G" network throttling
- [ ] Scroll and load more posts
- [ ] Video page loads entire grid in < 1.5 seconds
- [ ] Marketplace loads grid in < 1.5 seconds
- [ ] Test on actual mobile device

---

## 🎥 Phase 3: Video Features

### 3.1 Video Upload
- [ ] Go to `/videos.html`
- [ ] Click "Upload Video" or drag-and-drop
- [ ] Select a test video file (MP4, < 100MB)
- [ ] Fill in title, description, category
- [ ] Upload completes and shows in grid
- [ ] Thumbnail displays correctly
- [ ] Video plays when clicked
- [ ] Video appears in "All" category

### 3.2 Video Interactions
- [ ] Click "Like" button on video
- [ ] Like count increases by 1
- [ ] Like persists after page reload
- [ ] Add a comment on video
- [ ] Comment appears in list
- [ ] Comment count increases
- [ ] Delete own comment works

### 3.3 Video Search & Filter
- [ ] Type in search bar
- [ ] Results filter in real-time
- [ ] Click category tabs - list updates
- [ ] "Load More" shows when available
- [ ] Pagination works smoothly

---

## 🏪 Phase 4: Marketplace Features

### 4.1 Create Listing
- [ ] Go to `/marketplace.html`
- [ ] Click "Sell Item" button
- [ ] Fill all form fields:
  - Title: "Test iPhone 14"
  - Category: "Electronics"
  - Price: "599.99"
  - Condition: "Like New"
  - Description: "Great working condition"
  - Location: "New York, NY"
  - Upload 2-3 photos
- [ ] Click "Create Listing"
- [ ] Success message appears
- [ ] Listing shows in grid
- [ ] Images display correctly

### 4.2 Browse Marketplace
- [ ] Listings display in grid
- [ ] Click category filter - items update
- [ ] Search for term - results filter
- [ ] Load more works
- [ ] Each listing shows: image, title, price, condition, location
- [ ] Click listing → opens detail page

### 4.3 Listing Detail Page
- [ ] Open any listing (click on card)
- [ ] Verify elements:
  - [ ] Large product image displays
  - [ ] Image gallery thumbnails work
  - [ ] Title, price, condition visible
  - [ ] Description shows
  - [ ] Seller name and rating shown
  - [ ] Location and posted date visible
  - [ ] View count displays
  - [ ] "Contact Seller" button present
  - [ ] "Send Inquiry" form visible

### 4.4 Seller Inquiry
- [ ] On listing detail page
- [ ] Type message: "Is this still available?"
- [ ] Click "Send Inquiry"
- [ ] Success message appears
- [ ] (Seller should receive notification)

### 4.5 Similar Listings
- [ ] Bottom of listing page shows similar items
- [ ] Click similar listing → loads that detail page
- [ ] URL changes to new item ID

---

## ✅ Phase 5: Verification System

### 5.1 Apply for Verification
- [ ] Go to `/verify.html`
- [ ] Select verification level (e.g., Gold)
- [ ] Card highlights as selected
- [ ] Fill reason text (min 20 chars)
- [ ] Upload supporting documents (1-3 files)
- [ ] Check agreement checkbox
- [ ] Click "Submit Application"
- [ ] Success message appears
- [ ] Form resets

### 5.2 Verification Benefits Display
- [ ] Each level shows benefits clearly
- [ ] Silver: Basic benefits
- [ ] Gold: More features
- [ ] Platinum: Premium features
- [ ] Business: Company features
- [ ] Icon/color differences clear

---

## 🔔 Phase 6: Notifications

### 6.1 Notification Badge
- [ ] Header shows notification bell icon
- [ ] Unread count shows (if any)
- [ ] Count updates in real-time

### 6.2 Trigger Notifications
- [ ] Send friend request (notifications feature)
- [ ] Get mentioned in comment
- [ ] Get reply to your comment
- [ ] Receive new message
- [ ] Verify each creates notification

### 6.3 Notification Handling
- [ ] Click notification → goes to relevant item
- [ ] Mark as read → badge updates
- [ ] Clear old notifications
- [ ] Notification types are correct

---

## 🤖 Phase 7: Groq AI Features

### 7.1 Setup & Testing
- [ ] Go to `/ai-settings.html`
- [ ] Enter Groq API key
- [ ] Click "Test Connection"
- [ ] See "✓ Connected" message
- [ ] Test stays for 30 seconds

### 7.2 Quick Chat
- [ ] Type message: "Hello"
- [ ] Send message
- [ ] Get AI response within 3 seconds
- [ ] Response is relevant
- [ ] No errors in console
- [ ] Clear chat works

### 7.3 Different Models
- [ ] Change model from dropdown
- [ ] Models available: Mixtral, LLaMA 2, Gemma
- [ ] Select different model
- [ ] Chat still works
- [ ] Response time difference noted

---

## 📱 Phase 8: Mobile-Specific Tests

### 8.1 Responsive Design
- [ ] Test on iPhone 12
- [ ] Test on Android (e.g., Pixel 5)
- [ ] Test on Tablet (iPad)
- [ ] All pages display correctly on mobile
- [ ] No horizontal scroll needed
- [ ] Touch buttons are at least 48x48px

### 8.2 Mobile Performance
- [ ] On 4G network: homepage < 2s
- [ ] On 3G network: homepage < 4s
- [ ] Smooth scrolling (no jank)
- [ ] Images load progressively
- [ ] "Pull to refresh" works

### 8.3 Mobile Features
- [ ] Photo uploads work
- [ ] Camera access works (if applicable)
- [ ] Orientation change doesn't break layout
- [ ] Fullscreen video works
- [ ] Notifications work on mobile

---

## 🔐 Phase 9: Security Tests

### 9.1 Authentication
- [ ] Logged out: Can't access private features
- [ ] Logged in: Can create/edit own content
- [ ] Can't edit other user's posts
- [ ] API key not visible in DevTools Network tab
- [ ] API key not logged in console

### 9.2 Privacy
- [ ] Set profile to "Private"
- [ ] Non-friends can't view profile
- [ ] Friends can view profile
- [ ] Listings respect privacy settings

### 9.3 Data Validation
- [ ] Can't submit empty forms
- [ ] Can't upload huge files
- [ ] Search sanitizes input
- [ ] No XSS attacks possible (test: try `<script>alert('xss')</script>`)

---

## 📊 Phase 10: Data Integrity

### 10.1 Database
- [ ] New tables exist and have data
- [ ] Foreign keys are enforced
- [ ] Timestamps auto-populate
- [ ] User IDs match correctly

### 10.2 State Management
- [ ] After refresh: data persists
- [ ] No duplicate items in lists
- [ ] Item counts are accurate
- [ ] Related items link correctly

### 10.3 Realtime Sync
- [ ] Multiple users see updates in real-time
- [ ] Notifications sync across tabs
- [ ] Message appears in all open windows
- [ ] Like count updates for all viewers

---

## 🐛 Phase 11: Error Handling

### 11.1 Network Errors
- [ ] Offline mode: Graceful error messages
- [ ] Slow network: Loading indicators show
- [ ] Retry mechanism works
- [ ] Timeout after 30 seconds

### 11.2 Missing Data
- [ ] Deleted item: Proper message shown
- [ ] Empty category: "No items" message
- [ ] Missing image: Placeholder shown
- [ ] Invalid ID: Redirect to listing page

### 11.3 User Errors
- [ ] Invalid email format: Error message
- [ ] Password too short: Error message
- [ ] File too large: Error message with size limit
- [ ] No permission: Redirect to login

---

## 🎨 Phase 12: Visual & UX

### 12.1 Design Consistency
- [ ] Color scheme consistent
- [ ] Fonts match design
- [ ] Spacing is uniform
- [ ] Buttons look clickable

### 12.2 Accessibility
- [ ] All buttons have keyboard focus
- [ ] Tab navigation works
- [ ] Color contrast meets WCAG AA
- [ ] Alt text on all images
- [ ] Form labels clear

### 12.3 User Experience
- [ ] Loading states clear
- [ ] Success messages visible
- [ ] Error messages helpful
- [ ] Undo options where applicable

---

## 🚀 Phase 13: Launch Readiness

### 13.1 Final Checks
- [ ] All files deployed to production
- [ ] DNS points correctly
- [ ] SSL certificate valid
- [ ] CDN cache purged
- [ ] Backups created

### 13.2 Monitoring
- [ ] Error tracking enabled (Sentry, etc.)
- [ ] Analytics configured
- [ ] Performance monitoring active
- [ ] Uptime monitoring set

### 13.3 Documentation
- [ ] User guides written
- [ ] API documentation complete
- [ ] Admin guides ready
- [ ] Emergency contacts listed

---

## 📋 Results Summary

Date Tested: _______________

### Phase Results
- Phase 1 (Setup): ✅ / ❌
- Phase 2 (Core): ✅ / ❌
- Phase 3 (Video): ✅ / ❌
- Phase 4 (Marketplace): ✅ / ❌
- Phase 5 (Verification): ✅ / ❌
- Phase 6 (Notifications): ✅ / ❌
- Phase 7 (AI): ✅ / ❌
- Phase 8 (Mobile): ✅ / ❌
- Phase 9 (Security): ✅ / ❌
- Phase 10 (Data): ✅ / ❌
- Phase 11 (Errors): ✅ / ❌
- Phase 12 (UX): ✅ / ❌
- Phase 13 (Launch): ✅ / ❌

### Overall Status
- **Ready to Launch**: ✅ / ❌
- **Minor Issues Found**: _____ (list below)
- **Major Issues Found**: _____ (list below)

### Issues Found
1. _________________________________
2. _________________________________
3. _________________________________

### Sign-Off
Tested by: _______________
Date: _______________
Approved for launch: ✅ / ❌

---

## 🎯 Quick Reference: Test URLs

- Homepage: `https://timzeetech.com/`
- Search: `https://timzeetech.com/index.html` (use search bar)
- Chat: `https://timzeetech.com/chat.html`
- Videos: `https://timzeetech.com/videos.html`
- Marketplace: `https://timzeetech.com/marketplace.html`
- Listing: `https://timzeetech.com/listing.html?id=XXX`
- Verification: `https://timzeetech.com/verify.html`
- AI Settings: `https://timzeetech.com/ai-settings.html`
- Profile: `https://timzeetech.com/profile.html`

---

## 💡 Testing Tips

1. **Use Incognito Mode** for clean testing (no cached data)
2. **Open DevTools** to catch console errors
3. **Test on Real Devices** - emulation isn't perfect
4. **Use Throttling** - DevTools → Network → "Slow 3G"
5. **Check All Browsers** - Chrome, Firefox, Safari, Edge
6. **Test Multiple Users** - Open two browser windows, two different user accounts
7. **Screenshot Issues** - Take screenshots of any problems for documentation

---

## 🆘 If Tests Fail

1. **Check Console** for JavaScript errors
2. **Check Network Tab** for API errors
3. **Verify Database** - ensure schema created
4. **Check Realtime** - enable publication for tables
5. **Review Logs** - Netlify Functions, Supabase
6. **Clear Cache** - browser cache and localStorage
7. **Ask in Discord** - provide error messages and screenshots

Good luck with testing! 🍀
