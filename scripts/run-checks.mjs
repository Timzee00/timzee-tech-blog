import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const steps=[
  {
    "label": "Core feature contracts and chat formatting",
    "args": [
      "--test",
      "tests/aggregate-traffic.test.cjs",
      "tests/staff-workspace.test.cjs",
      "tests/blipmood-svg-icons.test.cjs",
      "tests/blipmood-auth-v7.test.cjs",
      "tests/blipmood-db-contracts.test.cjs",
      "tests/account-restrictions.test.cjs",
      "tests/chat-previews.test.cjs",
      "tests/chat-blip-and-video-gestures.test.cjs",
      "tests/blip-earn-phase-a.test.cjs",
      "tests/blip-earn-manual-rewards.test.cjs",
      "tests/chat-formatters.test.cjs",
      "tests/chat-voice-waveform-and-reel-audio.test.cjs"
    ]
  },
  {
    "label": "Admin and curator scalable data loading",
    "args": [
      "--test",
      "tests/admin-scale-loading.test.cjs"
    ]
  },
  {
    "label": "Discussion ranking aggregation",
    "args": [
      "--test",
      "tests/discussion-ranking-scale.test.cjs"
    ]
  },
  {
    "label": "Public page-link validation",
    "args": [
      "scripts/validate-page-links.mjs"
    ]
  },
  {
    "label": "Production configuration validation",
    "args": [
      "scripts/validate-production-config.mjs"
    ]
  },
  {
    "label": "JavaScript and inline-script syntax validation",
    "args": [
      "scripts/check-syntax.mjs"
    ]
  },
  {
    "label": "Community, feed, identity, staff and Spaces regressions",
    "args": [
      "--test",
      "--test-concurrency=4",
      "tests/region-capacity-fyp.test.cjs",
      "tests/video-discovery.test.cjs",
      "tests/production-media-smoke.test.cjs",
      "tests/community-forums.test.cjs",
      "tests/blipmood-content-policy-community-rules.test.cjs",
      "tests/community-expansion.test.cjs",
      "tests/community-ranking-v2.test.cjs",
      "tests/community-feed-pagination.test.cjs",
      "tests/settings-center.test.cjs",
      "tests/site-hardening.test.cjs",
      "tests/verification-frame-collection.test.cjs",
      "tests/profile-fx-onboarding.test.cjs",
      "tests/blipmood-identity-recognition.test.cjs",
      "tests/verified-frame-gallery.test.cjs",
      "tests/verified-identity-cache.test.cjs",
      "tests/operations-inbox.test.cjs",
      "tests/founder-operations-digest.test.cjs",
      "tests/public-feed-performance.test.cjs",
      "tests/reader-retention.test.cjs",
      "tests/weekly-learning-goal.test.cjs",
      "tests/reader-interest-ranker.test.cjs",
      "tests/operations-console.test.cjs",
      "tests/creator-studio.test.cjs",
      "tests/atomic-moderation.test.cjs",
      "tests/scheduled-publisher.test.cjs",
      "tests/briefing-publication-security.test.cjs",
      "tests/friend-suggestion-bounds.test.cjs",
      "tests/spaces-token.test.cjs",
      "tests/spaces-control.test.cjs",
      "tests/spaces-host-controls.test.cjs",
      "tests/spaces-auto-mic-design.test.cjs",
      "tests/spaces-persistent-audio-viewport.test.cjs",
      "tests/spaces-idle-speaker-design.test.cjs",
      "tests/team-workspace-platform.test.cjs",
      "tests/spaces-implementation.test.cjs",
      "tests/spaces-provider-readiness.test.cjs",
      "tests/spaces-start-alignment.test.cjs",
      "tests/spaces-live-clock.test.cjs",
      "tests/spaces-expiry.test.cjs",
      "tests/spaces-discovery-scoping.test.cjs",
      "tests/team-workspace-role-ui.test.cjs",
      "tests/profile-insert-guard.test.cjs",
      "tests/spaces-audio-state.test.cjs",
      "tests/spaces-expiry-worker.test.cjs",
      "tests/spaces-host-reconnect.test.cjs",
      "tests/verified-edit-windows.test.cjs",
      "tests/feature-launch-manager.test.cjs"
    ]
  },
  {
    "label": "Scout ranking and request-budget checks",
    "args": [
      "--test",
      "tests/scout-budget.test.cjs",
      "tests/scout-ranking.test.cjs",
      "tests/scout-coverage.test.cjs"
    ]
  },
  {
    "label": "Brand rollout and animated identity checks",
    "args": [
      "--test",
      "tests/blipmood-brand-rollout.test.cjs",
      "tests/blipmood-animated-logo.test.cjs",
      "tests/blipmood-cinematic-intro.test.cjs"
    ]
  },
  {
    "label": "Native sharing",
    "args": [
      "--test",
      "tests/native-sharing.test.cjs"
    ]
  },
  {
    "label": "Social share previews",
    "args": [
      "--test",
      "tests/social-share-previews.test.cjs"
    ]
  },
  {
    "label": "Sitemap and SEO",
    "args": [
      "--test",
      "tests/blipmood-sitemap-seo.test.cjs"
    ]
  },
  {
    "label": "Mobile layout stability",
    "args": [
      "--test",
      "tests/mobile-layout-stability.test.cjs"
    ]
  },
  {
    "label": "Group management UI",
    "args": [
      "--test",
      "tests/group-management-ui.test.cjs"
    ]
  },
  {
    "label": "Personal chat controls",
    "args": [
      "--test",
      "tests/chat-personal-controls.test.cjs"
    ]
  },
  {
    "label": "Lighthouse and mobile loading regressions",
    "args": [
      "--test",
      "tests/lighthouse-remediations.test.cjs",
      "tests/blipmood-mobile-first-paint.test.cjs",
      "tests/blipmood-hero-lcp.test.cjs",
      "tests/blipmood-home-css-split.test.cjs"
    ]
  },
  {
    "label": "Consent and announcement behavior",
    "args": [
      "--test",
      "tests/mobile-consent-announcement.test.cjs"
    ]
  },
  {
    "label": "Cross-surface UX regressions",
    "args": [
      "--test",
      "tests/blipmood-six-ux-fixes.test.cjs"
    ]
  },
  {
    "label": "Video discovery, atomic views and reel ranking",
    "args": [
      "--test",
      "tests/video-discovery.test.cjs",
      "tests/atomic-video-view.test.cjs",
      "tests/reels-identity-views-ranking.test.cjs",
      "tests/unified-reels-personalization.test.cjs",
      "tests/community-discussion-reels.test.cjs",
      "tests/video-player-interface.test.cjs"
    ]
  },
  {
    "label": "Theme and video performance regressions",
    "args": [
      "--test",
      "tests/blipmood-theme-video-performance.test.cjs",
      "tests/media-egress-guardrails.test.cjs",
      "tests/theme-preference-persistence.test.cjs"
    ]
  },
  {
    "label": "Curator and article media persistence",
    "args": [
      "--test",
      "tests/curator-publishing-regression.test.cjs",
      "tests/admin-post-media-upload.test.cjs"
    ]
  },
  {
    "label": "Product upgrade behavior",
    "args": [
      "--test",
      "tests/blipmood-product-upgrade-2026.test.cjs"
    ]
  },
  {
    "label": "Navigation, authentication and performance",
    "args": [
      "--test",
      "tests/blipmood-navigation-auth-performance.test.cjs"
    ]
  },
  {
    "label": "Push delivery, navigation and offline behavior",
    "args": [
      "--test",
      "tests/push-navigation-security.test.cjs",
      "tests/browser-push-flow.test.cjs",
      "tests/blipmood-pwa-offline.test.cjs",
      "tests/blipmood-pwa-install.test.cjs",
      "tests/notification-device-alerts.test.cjs",
      "tests/web-push.test.cjs"
    ]
  },
  {
    "label": "Public reel metrics",
    "args": [
      "--test",
      "tests/reel-public-metrics.test.cjs"
    ]
  },
  {
    "label": "Chat redesign",
    "args": [
      "--test",
      "tests/blipmood-chat-redesign.test.cjs"
    ]
  },
  {
    "label": "Marketplace premium behavior",
    "args": [
      "--test",
      "tests/blipmood-marketplace-premium.test.cjs"
    ]
  },
  {
    "label": "Community AI polish",
    "args": [
      "--test",
      "tests/blipmood-community-ai-polish.test.cjs"
    ]
  }
];
for(const [index,step] of steps.entries()){
  console.log("\n["+(index+1)+"/"+steps.length+"] "+step.label);
  const result=spawnSync(process.execPath,step.args,{cwd:root,stdio:"inherit"});
  if(result.error){console.error("Unable to start check: "+result.error.message);process.exit(1);}
  if(result.signal){console.error("Check interrupted by "+result.signal);process.exit(1);}
  if(result.status!==0){console.error("Failed check: "+step.label);process.exit(result.status||1);}
}
console.log("\nAll configured checks passed.");
