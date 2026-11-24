const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20261125000200_discussion_ranking_single_pass_aggregates.sql"),
  "utf8"
);

test("popular discussion ranking aggregates replies once and preserves score semantics", () => {
  const section = migration.slice(
    migration.indexOf("FUNCTION public.get_popular_discussion_topics"),
    migration.indexOf("CREATE OR REPLACE FUNCTION public.get_trending_discussion_topics")
  );
  assert.match(section, /WITH reply_counts AS/);
  assert.match(section, /count\(\*\) FILTER\s*\(\s*WHERE m\.created_at >= now\(\) - interval '14 days'/);
  assert.match(section, /GROUP BY m\.topic_id/);
  assert.match(section, /LEFT JOIN reply_counts AS rc ON rc\.topic_id = t\.id/);
  assert.match(section, /coalesce\(rc\.reply_count, 0\) \* 2/);
  assert.match(section, /ln\(coalesce\(rc\.reply_count, 0\) \+ 1\) \* 3/);
  assert.match(section, /LIMIT greatest\(1, least\(coalesce\(limit_count, 5\), 20\)\)/);
  assert.doesNotMatch(section, /SELECT count\(\*\) FROM public\.discussion_messages/i);
});

test("trending discussion ranking uses one scan for all time windows", () => {
  const section = migration.slice(
    migration.indexOf("FUNCTION public.get_trending_discussion_topics")
  );
  assert.match(section, /WITH reply_counts AS/);
  assert.match(section, /count\(\*\) FILTER\s*\(\s*WHERE m\.created_at >= now\(\) - interval '72 hours'/);
  assert.match(section, /count\(\*\) FILTER\s*\(\s*WHERE m\.created_at >= now\(\) - interval '24 hours'/);
  assert.match(section, /GROUP BY m\.topic_id/);
  assert.match(section, /LEFT JOIN reply_counts AS rc ON rc\.topic_id = t\.id/);
  assert.match(section, /coalesce\(rc\.recent_reply_count, 0\) \* 5/);
  assert.match(section, /coalesce\(rc\.very_recent_reply_count, 0\) \* 4/);
  assert.doesNotMatch(section, /SELECT count\(\*\) FROM public\.discussion_messages/i);
});

test("discussion ranking RPCs remain invoker-security functions and preserve output columns", () => {
  const definitions = migration.match(/CREATE OR REPLACE FUNCTION public\.get_(?:popular|trending)_discussion_topics[\s\S]*?\$function\$;/g) || [];
  assert.equal(definitions.length, 2);
  for (const definition of definitions) {
    assert.match(definition, /LANGUAGE sql\s+STABLE\s+SET search_path TO 'public'/);
    assert.match(definition, /RETURNS TABLE\(\s*id uuid,[\s\S]*?reply_count bigint,\s*recent_reply_count bigint,/);
    assert.doesNotMatch(definition, /SECURITY DEFINER/i);
  }
});
