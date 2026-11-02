-- The persistent floating Cookie Settings control was removed. Keep existing
-- merchant edits intact and update only the former default policy sentence.
UPDATE shop_settings
SET cookie_policy = replace(
  cookie_policy,
  'You can reopen Cookie Settings from the site footer or the fixed privacy control.',
  'You can reopen Cookie Settings from the Privacy Policy page.'
), updated_at = now()
WHERE cookie_policy LIKE '%You can reopen Cookie Settings from the site footer or the fixed privacy control.%';
