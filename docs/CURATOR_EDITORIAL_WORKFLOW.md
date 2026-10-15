# Curator editorial workflow — review before deploy

Scout discovery and professional article writing have separate responsibilities.

1. The scheduled Scout fetches RSS/GDELT items and creates **source briefs**, never auto-published full articles. Each source item stores its original URL, attribution, title, date, summary and image metadata. A feed entry is a lead, not independently verified reporting.
2. Authorized staff can open **Articles → Expand with AI**. The server-side `curator-expand-article` Netlify Function authenticates their Supabase account, checks the admin/super role and rate limit, reads only the selected unpublished draft, and calls Groq or OpenRouter.
3. If the original RSS material contains under 170 source characters, AI expansion is **refused** with a request for more verified reporting. No full article is fabricated from just a headline.
4. Model output must contain an introduction, three to seven substantial sections, a conclusion and source attribution, totaling 240–1,150 words. The renderer escapes all model-written text; generated HTML isn't trusted. All output remains in `curator_posts` as **draft**.
5. Human editor checks the original source, corroborates factual claims, obtains image rights, edits omissions, decides whether publication is justified, and only then selects Approve & Post. Short source briefs cannot pass approval. The published content includes source attribution and an editorial review notice.
6. Free router and Groq limits can interrupt AI generation. The workflow returns a visible error; it never pretends a draft was saved. Editing a draft again consumes another request, so keep costs bounded.

## Netlify environment

Use private Function-scoped Netlify environment variables; never paste keys into the public dashboard or source code.

- `GROQ_API_KEY`: Groq credential, used by default both for AI chat and editor-only expansion.
- `OPENROUTER_API_KEY`: optional OpenRouter credential. Choose OpenRouter on **AI Settings** to use the `openrouter/free` router for AI chat.
- `CURATOR_AI_PROVIDER=openrouter`: optional server-side choice making the curator expansion call OpenRouter. Otherwise it uses Groq.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`: authenticated server-side access. Never expose the service role key in client JavaScript.

Only Function-scoped environment keys appear in the authenticated AI diagnostics. After setting/changing keys, deploy a build that includes the new functions and test with a staff account in isolated staging. **A committed development branch is not itself a functioning deployed integration.**

The service is a constrained drafting assistant, not an original reporting engine or automatically fact-checking journalist. Do not publish machine-expanded stories without reviewing the source facts, permissions and output.

References: https://console.groq.com/docs/api-reference and https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request .
