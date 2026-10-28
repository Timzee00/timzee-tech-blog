ALTER TABLE public.announcements ADD COLUMN IF NOT EXISTS banner_image_url text;
ALTER TABLE public.announcements ADD CONSTRAINT announcements_banner_url_safe
 CHECK (banner_image_url IS NULL OR banner_image_url='' OR
   (banner_image_url ~ '^https://[^[:space:]<>"'']{1,2048}$'));
