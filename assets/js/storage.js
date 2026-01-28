import { createId } from "./utils.js";

export const STORAGE_KEY = "techblog_data_v1";
export const SESSION_KEY = "techblog_session_v1";
export const PROFILE_KEY = "techblog_profile_v1";

function buildSeedData() {
  const now = Date.now();
  const iso = (offset) => new Date(now - offset).toISOString();

  const categories = [
    {
      id: "cat_news",
      name: "Tech News",
      description: "Breaking launches, startups, and Nigerian tech headlines.",
      color: "#f97316"
    },
    {
      id: "cat_build",
      name: "Build Logs",
      description: "Share what you are building and get feedback.",
      color: "#0f766e"
    },
    {
      id: "cat_reviews",
      name: "Reviews & Gear",
      description: "Phones, laptops, apps, and tools worth your cash.",
      color: "#0ea5e9"
    },
    {
      id: "cat_jobs",
      name: "Jobs & Gigs",
      description: "Hiring, contracts, and collaboration requests.",
      color: "#16a34a"
    },
    {
      id: "cat_ai",
      name: "AI & Data",
      description: "Models, prompts, analytics, and automation.",
      color: "#e11d48"
    },
    {
      id: "cat_general",
      name: "General Updates",
      description: "Company news, events, and anything outside core tech beats.",
      color: "#7c3aed"
    }
  ];

  const posts = [
    {
      id: "post_launch",
      title: "We mapped Lagos tech hubs with real-time heatmaps",
      slug: "lagos-tech-hubs-heatmaps",
      categoryId: "cat_news",
      authorId: "admin_1",
      authorName: "Editorial Admin",
      createdAt: iso(1000 * 60 * 60 * 6),
      updatedAt: iso(1000 * 60 * 60 * 2),
      cover: "https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=1200&q=80",
      tags: ["startup", "nigeria", "data"],
      gallery: [],
      content:
        "<p>We pulled location signals, company press releases, and coworking check-ins to map where builders actually hang out.</p><p>The heatmap is updated weekly and helps founders pick the right neighborhood for talent, pitch meetings, and accelerators.</p><p>Drop your neighborhood in the comments so we can keep the map accurate.</p>",
      likes: [],
      views: 24,
      pinned: true,
      status: "published"
    },
    {
      id: "post_build",
      title: "Build Log: A fintech savings app built in 21 days",
      slug: "fintech-savings-app-build-log",
      categoryId: "cat_build",
      authorId: "admin_1",
      authorName: "Editorial Admin",
      createdAt: iso(1000 * 60 * 60 * 22),
      updatedAt: iso(1000 * 60 * 60 * 20),
      cover: "https://images.unsplash.com/photo-1545239351-1141bd82e8a6?auto=format&fit=crop&w=1200&q=80",
      tags: ["fintech", "product"],
      gallery: [],
      content:
        "<p>We broke the build into sprints: onboarding, wallet logic, and a final polish week.</p><p>The community feedback helped us simplify KYC to a two-step flow.</p><p>Read the checklist at the end if you are shipping your own MVP.</p>",
      likes: [],
      views: 17,
      pinned: false,
      status: "published"
    },
    {
      id: "post_reviews",
      title: "What to know before buying mid-range Android phones in 2026",
      slug: "midrange-android-phones-2026",
      categoryId: "cat_reviews",
      authorId: "admin_1",
      authorName: "Editorial Admin",
      createdAt: iso(1000 * 60 * 60 * 30),
      updatedAt: iso(1000 * 60 * 60 * 28),
      cover: "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=1200&q=80",
      tags: ["android", "gadgets"],
      gallery: [],
      content:
        "<p>Battery life, 90Hz screens, and long-term updates are now the big three.</p><p>We compared price-to-performance across brands commonly available in Nigeria.</p><p>Share your best value pick so we can update the list.</p>",
      likes: [],
      views: 11,
      pinned: false,
      status: "published"
    }
  ];

  return {
    meta: {
      version: 1,
      createdAt: new Date(now).toISOString()
    },
    settings: {
      siteName: "Timzee Tech Hub",
      tagline: "Forum-inspired tech news, builds, and community experiments.",
      heroTitle: "Build. Discuss. Ship.",
      heroIntro: "A forum-inspired tech board with modern storytelling, live reactions, and creator tools for Timzee Tech Hub.",
      rules:
        "Respect each other, share sources, and keep posts useful. No spam or hate speech.",
      themeAccent: "#0f766e",
      features: {
        commentModeration: true,
        allowImageComments: true
      },
      adSense: {
        enabled: false,
        publisherId: "",
        slots: {
          homeTop: "",
          homeSidebar: "",
          postInline: ""
        }
      }
    },
    categories,
    posts,
    comments: [
      {
        id: "comment_1",
        postId: "post_launch",
        authorName: "Ada",
        authorId: "reader_ada",
        body: "Love this. We need a version for Abuja too.",
        image: "",
        createdAt: iso(1000 * 60 * 20),
        likes: [],
        status: "approved"
      }
    ],
    users: [
      {
        id: "super_1",
        role: "super",
        username: "root",
        password: "root123",
        displayName: "Site Owner",
        createdAt: iso(1000 * 60 * 60 * 48)
      },
      {
        id: "admin_1",
        role: "admin",
        username: "admin",
        password: "admin123",
        displayName: "Editorial Admin",
        createdAt: iso(1000 * 60 * 60 * 48)
      }
    ],
    profiles: [
      {
        id: "reader_ada",
        displayName: "Ada",
        createdAt: iso(1000 * 60 * 20)
      }
    ]
  };
}

export function loadData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const seed = buildSeedData();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
    return seed;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    const seed = buildSeedData();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
    return seed;
  }
}

export function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function resetData() {
  const seed = buildSeedData();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(PROFILE_KEY);
  return seed;
}

export function updateData(updater) {
  const data = loadData();
  const result = updater(data) || data;
  saveData(result);
  return result;
}

export function getActiveProfile(data, displayName = "Guest") {
  const stored = localStorage.getItem(PROFILE_KEY);
  if (stored) {
    const existing = data.profiles.find((profile) => profile.id === stored);
    if (existing) return existing;
  }

  const newProfile = {
    id: createId("reader"),
    displayName,
    createdAt: new Date().toISOString()
  };
  data.profiles.push(newProfile);
  localStorage.setItem(PROFILE_KEY, newProfile.id);
  return newProfile;
}

export function setActiveProfile(profileId) {
  localStorage.setItem(PROFILE_KEY, profileId);
}
