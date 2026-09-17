-- Internal service tables: keep RLS enabled and make the intended access explicit.
drop policy if exists "ai_usage_limits_service_role" on public.ai_usage_limits;
create policy "ai_usage_limits_service_role" on public.ai_usage_limits
  as restrictive for all to service_role
  using (true) with check (true);

drop policy if exists "moderation_audit_service_role" on public.moderation_audit;
create policy "moderation_audit_service_role" on public.moderation_audit
  as restrictive for all to service_role
  using (true) with check (true);

-- Remove exact duplicate permissive policies.
drop policy if exists "Public insert ads" on public.ad_applications;
drop policy if exists categories_public_read on public.categories;
drop policy if exists "Public insert contact" on public.contact_requests;
drop policy if exists "Public read messages" on public.discussion_messages;
drop policy if exists "Public read topics" on public.discussion_topics;
drop policy if exists site_settings_public_read on public.site_settings_kv;
drop policy if exists "Public support submissions" on public.support_requests;

-- The legacy author-only message policy made the newer ban-aware policy ineffective.
drop policy if exists "Users create messages" on public.discussion_messages;

-- Merge equivalent admin/owner SELECT policies without changing the OR logic.
drop policy if exists "Admins read admin requests" on public.admin_requests;
drop policy if exists "Users read own admin request" on public.admin_requests;
create policy "Admins or owners read admin requests" on public.admin_requests
  as permissive for select to public
  using (
    has_role_secure('admin'::text)
    or has_role_secure('super'::text)
    or ((select auth.uid() as uid) = user_id)
  );
