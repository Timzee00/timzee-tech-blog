-- Targeted foreign-key indexes for the new identity subsystem.
create index if not exists identity_review_notes_actor_idx on private.identity_review_notes(actor_id);
create index if not exists identity_review_notes_org_idx on private.identity_review_notes(organization_id);
create index if not exists identity_appointments_granter_idx on public.identity_appointments(granted_by) where granted_by is not null;
create index if not exists identity_awards_granter_idx on public.identity_awards(granted_by) where granted_by is not null;
create index if not exists identity_organizations_reviewed_idx on public.identity_organizations(status,created_at desc);