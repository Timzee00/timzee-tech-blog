-- Remove the exact internal AI editor status note from existing public posts.
-- Preserve all article paragraphs, media, source attribution and takeaways.
-- Scope to previously observed published drafts only; no post is deleted.
update public.posts
set content=replace(content,
  '<p class="curator-editorial-note"><strong>Editorial draft:</strong> This article was assisted by AI and requires fact-checking before publication.</p>',
  ''
)
where status='published'
  and content like '%<p class="curator-editorial-note"><strong>Editorial draft:</strong> This article was assisted by AI and requires fact-checking before publication.</p>%';
