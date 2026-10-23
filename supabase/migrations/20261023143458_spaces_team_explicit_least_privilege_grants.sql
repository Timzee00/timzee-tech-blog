
-- Supabase may grant ALL to anon/authenticated on newly created public tables.
-- RLS remains authoritative, but explicit least-privilege grants are stronger.
REVOKE ALL ON TABLE
 public.team_workspaces,public.team_workspace_members,public.team_studio_projects,
 public.spaces_rooms,public.spaces_participants,public.spaces_invites,
 public.spaces_speaker_requests,public.spaces_reports
 FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.team_workspaces TO authenticated;
GRANT SELECT ON public.team_workspace_members TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.team_studio_projects TO authenticated;
GRANT SELECT,INSERT ON public.spaces_rooms TO authenticated;
GRANT SELECT ON public.spaces_rooms TO anon;
GRANT SELECT ON public.spaces_participants,public.spaces_invites,public.spaces_speaker_requests TO authenticated;
GRANT SELECT,INSERT ON public.spaces_reports TO authenticated;
REVOKE ALL ON FUNCTION
 private.spaces_create_host(),private.spaces_creation_guard(),private.team_immutable_fields()
 FROM PUBLIC,anon,authenticated;
