-- A capture's headline becomes a derived fact.
--
-- Extraction previously read only `sender` and the structured `attributes` map, so a notification
-- whose content lives in `subject` and `body` produced nothing but its own timestamps. Recording the
-- headline as a bounded fact lets an item say what it was about after its encrypted raw payload
-- reaches the seven-day deletion deadline.
--
-- Only the headline is derived. The body is mined for structured values but never stored, so a fact
-- remains a minimal derived value rather than a durable copy of source content.
alter type public.source_fact_kind add value if not exists 'subject';
