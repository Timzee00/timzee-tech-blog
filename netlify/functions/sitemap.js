const { createClient } = require("@supabase/supabase-js");

const SITE_URL = "https://timzee-tech-blog.netlify.app";

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function urlEntry(loc, lastmod, changefreq, priority) {
  return [
    "  <url>",
    `    <loc>${xmlEscape(loc)}</loc>`,
    lastmod ? `    <lastmod>${xmlEscape(lastmod)}</lastmod>` : "",
    changefreq ? `    <changefreq>${changefreq}</changefreq>` : "",
    priority ? `    <priority>${priority}</priority>` : "",
    "  </url>"
  ].filter(Boolean).join("\n");
}

exports.handler = async () => {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" },
      body: "<?xml version=\"1.0\" encoding=\"UTF-8\"?><error>Configuration unavailable</error>"
    };
  }

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const staticPages = [
      ["/", 1.0, "daily"],
      ["/discussion.html", 0.8, "daily"],
      ["/marketplace.html", 0.8, "daily"],
      ["/videos.html", 0.8, "daily"],
      ["/novels.html", 0.7, "daily"],
      ["/announcements.html", 0.6, "weekly"],
      ["/ads.html", 0.5, "monthly"],
      ["/newsletter.html", 0.5, "monthly"],
      ["/contact.html", 0.4, "monthly"],
      ["/support.html", 0.4, "monthly"]
    ];

    const { data: posts, error } = await supabase
      .from("posts")
      .select("id,updated_at")
      .eq("status", "published")
      .order("updated_at", { ascending: false })
      .limit(5000);

    if (error) throw error;

    const today = new Date().toISOString().slice(0, 10);
    const entries = staticPages.map(([path, priority, changefreq]) => {
      const postLastmod = path === "/" ? today : today;
      return urlEntry(`${SITE_URL}${path}`, postLastmod, changefreq, priority.toFixed(1));
    });

    for (const post of posts || []) {
      const lastmod = post.updated_at ? new Date(post.updated_at).toISOString().slice(0, 10) : today;
      entries.push(urlEntry(`${SITE_URL}/post.html?id=${encodeURIComponent(post.id)}`, lastmod, "weekly", "0.7"));
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>`;

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=900, s-maxage=3600, stale-while-revalidate=86400"
      },
      body: xml
    };
  } catch (error) {
    console.error("Sitemap generation failed:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" },
      body: "<?xml version=\"1.0\" encoding=\"UTF-8\"?><error>Sitemap generation failed</error>"
    };
  }
};
