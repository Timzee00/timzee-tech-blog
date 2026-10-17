-- Prevent malicious or accidentally oversized preference payloads from
-- reaching every page on login; preserve existing user settings unchanged.
ALTER TABLE public.user_settings
 ADD CONSTRAINT user_settings_preferences_shape_size
 CHECK (jsonb_typeof(preferences) = 'object'
   AND octet_length(preferences::text) <= 65536);
COMMENT ON CONSTRAINT user_settings_preferences_shape_size ON public.user_settings
 IS 'User preferences must be a JSON object no larger than 64 KiB.';
