-- Verified post-purchase reviews. Blipmood does not process payments here.
CREATE OR REPLACE FUNCTION public.marketplace_transaction_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
DECLARE owner_id uuid; actual_price numeric;
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT user_id,price INTO owner_id,actual_price FROM public.marketplace_items
   WHERE id=NEW.item_id;
  IF owner_id IS NULL OR NEW.buyer_id IS NULL OR owner_id=NEW.buyer_id
   OR NEW.status IS DISTINCT FROM 'pending'
   THEN RAISE EXCEPTION 'Invalid purchase confirmation request' USING ERRCODE='42501'; END IF;
  IF auth.uid() IS NOT NULL AND auth.uid()<>NEW.buyer_id THEN
   RAISE EXCEPTION 'Only the buyer can request confirmation' USING ERRCODE='42501'; END IF;
  NEW.seller_id:=owner_id;NEW.amount:=actual_price;
 ELSE
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.item_id IS DISTINCT FROM OLD.item_id OR
   NEW.seller_id IS DISTINCT FROM OLD.seller_id OR NEW.buyer_id IS DISTINCT FROM OLD.buyer_id OR
   NEW.amount IS DISTINCT FROM OLD.amount OR OLD.status IS DISTINCT FROM 'pending' OR
   NEW.status NOT IN ('completed','cancelled') THEN
   RAISE EXCEPTION 'Only pending purchases can be confirmed or cancelled' USING ERRCODE='42501'; END IF;
  IF auth.uid() IS NOT NULL AND auth.uid()<>OLD.seller_id THEN
   RAISE EXCEPTION 'Only the seller may confirm a purchase' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS marketplace_transaction_guard_write ON public.marketplace_transactions;
CREATE TRIGGER marketplace_transaction_guard_write BEFORE INSERT OR UPDATE ON public.marketplace_transactions
 FOR EACH ROW EXECUTE FUNCTION public.marketplace_transaction_guard();
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_transaction_unique_active ON public.marketplace_transactions(item_id,buyer_id)
 WHERE status IN ('pending','completed');
DROP POLICY IF EXISTS "Sellers confirm purchase requests" ON public.marketplace_transactions;
CREATE POLICY "Sellers confirm purchase requests" ON public.marketplace_transactions
 FOR UPDATE TO authenticated USING ((SELECT auth.uid())=seller_id)
 WITH CHECK ((SELECT auth.uid())=seller_id);
CREATE TABLE IF NOT EXISTS public.marketplace_item_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 transaction_id uuid NOT NULL UNIQUE REFERENCES public.marketplace_transactions(id) ON DELETE CASCADE,
 item_id uuid NOT NULL REFERENCES public.marketplace_items(id) ON DELETE CASCADE,
 reviewer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
 comment text NOT NULL DEFAULT '' CHECK (length(comment)<=1500),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.marketplace_item_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketplace_item_reviews FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.marketplace_item_reviews TO authenticated;
GRANT SELECT ON public.marketplace_item_reviews TO anon;
GRANT ALL ON public.marketplace_item_reviews TO service_role;
DROP POLICY IF EXISTS "Public product ratings" ON public.marketplace_item_reviews;
CREATE POLICY "Public product ratings" ON public.marketplace_item_reviews FOR SELECT TO anon,authenticated USING(true);
DROP POLICY IF EXISTS "Verified buyer writes product rating" ON public.marketplace_item_reviews;
CREATE POLICY "Verified buyer writes product rating" ON public.marketplace_item_reviews FOR INSERT TO authenticated
 WITH CHECK ((SELECT auth.uid())=reviewer_id AND EXISTS(
  SELECT 1 FROM public.marketplace_transactions t WHERE t.id=transaction_id
   AND t.buyer_id=reviewer_id AND t.item_id=item_id AND t.status='completed'));
-- Existing seller review policy must require a seller-confirmed completed purchase.
DROP POLICY IF EXISTS "Users create reviews" ON public.marketplace_reviews;
CREATE POLICY "Users create reviews" ON public.marketplace_reviews FOR INSERT TO authenticated
 WITH CHECK ((SELECT auth.uid())=reviewer_id AND reviewer_id<>reviewee_id
  AND rating BETWEEN 1 AND 5 AND EXISTS(
   SELECT 1 FROM public.marketplace_transactions t WHERE t.id=transaction_id
    AND t.buyer_id=reviewer_id AND t.seller_id=reviewee_id AND t.status='completed'));
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_reviews_once_per_transaction ON public.marketplace_reviews(transaction_id);
