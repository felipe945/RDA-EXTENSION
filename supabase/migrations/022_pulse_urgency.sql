-- 022: fires must be REAL fires (Felipe): severity-aware escalation.
-- ai_urgency: classifier's verdict (high = something wrong / money / repeated
-- pings / frustration — NOT just any question).
-- unanswered_count: deterministic pile-on signal — inbound messages since
-- Felipe's last reply ("mentioned it multiple times and never got an answer").
BEGIN;
ALTER TABLE public.am_conversations
  ADD COLUMN ai_urgency text CHECK (ai_urgency IN ('low','medium','high')),
  ADD COLUMN unanswered_count int NOT NULL DEFAULT 0;

-- Backfill unanswered_count from stored messages.
UPDATE public.am_conversations c
SET unanswered_count = sub.cnt
FROM (
  SELECT m.conversation_id, count(*) AS cnt
  FROM public.am_messages m
  WHERE m.direction = 'in'
    AND m.sent_at > COALESCE(
      (SELECT max(o.sent_at) FROM public.am_messages o
       WHERE o.conversation_id = m.conversation_id AND o.direction = 'out'),
      'epoch'::timestamptz)
  GROUP BY m.conversation_id
) sub
WHERE sub.conversation_id = c.id;
COMMIT;
