-- Backward-compatible safety default: older clients do not explain that a mic may be live.
-- New Spaces explicitly submit speaking_mode='open' from a clearly labeled form.
-- Existing rooms remain request-only; missing values from older clients stay request-only.
ALTER TABLE public.spaces_rooms ALTER COLUMN speaking_mode SET DEFAULT 'request';