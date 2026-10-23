-- Commit enum expansion before routines use new labels. Existing values and records are preserved.
alter type public.action_provider add value if not exists 'google-sheets';
alter type public.action_provider add value if not exists 'google-calendar';
