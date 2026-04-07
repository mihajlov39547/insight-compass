-- ============================================================
-- RBAC hardening: share visibility and chat management semantics
-- ============================================================

-- 1) Ensure chat management is admin+ only (owner included via role hierarchy)
DROP POLICY IF EXISTS "Users can update their own chats" ON public.chats;
DROP POLICY IF EXISTS "Users can delete their own chats" ON public.chats;

-- 2) Ensure owner/admin can list all members of items they manage
DROP POLICY IF EXISTS "Users can view shares they are part of" ON public.shares;
DROP POLICY IF EXISTS "Users can view shares with permission" ON public.shares;

CREATE POLICY "Users can view shares with permission"
ON public.shares FOR SELECT TO authenticated
USING (
  auth.uid() = shared_with_user_id
  OR auth.uid() = shared_by_user_id
  OR public.check_item_permission(auth.uid(), item_id, item_type, 'admin')
);
