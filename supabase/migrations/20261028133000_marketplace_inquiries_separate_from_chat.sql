-- Save marketplace inquiries independently of the chat group system.
-- Old BEFORE trigger created a chat thread and called direct_messages guards;
-- those may reject non-groups with "Group unavailable", rolling back the inquiry.
CREATE OR REPLACE FUNCTION public.handle_marketplace_inquiry_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $body$
DECLARE
 v_seller uuid;
BEGIN
 SELECT user_id INTO v_seller FROM public.marketplace_items WHERE id=NEW.item_id;
 IF v_seller IS NULL THEN RAISE EXCEPTION 'Listing not found'; END IF;
 NEW.seller_id:=v_seller;
 NEW.thread_id:=NULL; -- inquiries are independent from group/direct chat threads
 RETURN NEW;
END $body$;
REVOKE ALL ON FUNCTION public.handle_marketplace_inquiry_notification() FROM PUBLIC,anon,authenticated;
