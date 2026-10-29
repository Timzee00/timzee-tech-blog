-- Extend the existing verified frame collection without changing user tier or privilege semantics.
alter table public.profiles drop constraint if exists profiles_frame_style_allowed;
alter table public.profiles add constraint profiles_frame_style_allowed
 check (frame_style in ('signature','library','aurora','orbit','laurel','comet','constellation','crest','nameplate'));
create or replace function public.guard_verified_frame_style()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if not coalesce(new.is_verified,false) then new.frame_style:='signature'; end if;
 if new.frame_style not in ('signature','library','aurora','orbit','laurel','comet','constellation','crest','nameplate') then
  raise exception 'Unknown portrait frame' using errcode='22023';
 end if;
 return new;
end $$;
revoke all on function public.guard_verified_frame_style() from public,anon,authenticated;
