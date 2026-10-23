ALTER TABLE public.spaces_reports
 ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'pending'
 CHECK(review_status IN ('pending','resolved','dismissed'));
ALTER TABLE public.spaces_reports
 ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE public.spaces_reports
 ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.spaces_reports
 ADD COLUMN IF NOT EXISTS review_note text;
CREATE UNIQUE INDEX IF NOT EXISTS spaces_one_report_per_user_room_idx
 ON public.spaces_reports(room_id,reporter_id);
DROP POLICY IF EXISTS spaces_reports_insert ON public.spaces_reports;
CREATE POLICY spaces_reports_insert ON public.spaces_reports FOR INSERT TO authenticated
 WITH CHECK(reporter_id=(SELECT auth.uid()) AND private.space_is_participant(room_id)
 AND review_status='pending' AND reviewed_at IS NULL AND reviewed_by IS NULL AND review_note IS NULL);
