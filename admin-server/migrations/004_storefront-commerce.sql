-- A one-time storefront data migration. It only seeds a truly empty catalog;
-- the public product listing's prices/specifications were reviewed on 2026-10-21
-- at https://minimulcher.com/collections/all; prices remain editable seller inputs.
-- Stock remains zero until the seller records verified sellable inventory.
CREATE TABLE IF NOT EXISTS cms_data_migrations (
  migration_id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cms_data_migrations WHERE migration_id = '004_storefront_catalog_v1') THEN
    IF NOT EXISTS (SELECT 1 FROM shop_products) AND NOT EXISTS (SELECT 1 FROM shop_orders) THEN
      UPDATE shop_settings SET currency = 'USD', updated_at = now() WHERE id = 1;
INSERT INTO shop_products (
  id, sku, slug, category, name, summary, description, image_url, gallery,
  highlights, specifications, videos, price_cents, currency, stock, active, featured, sort_order
)
SELECT seed.*
FROM (VALUES
  (
    'hm-mm38', 'HM-MM38', 'mm38-mini-skid-steer-drum-mulcher', 'Drum Mulchers',
    'MM38 Mini Skid Steer Drum Forestry Mulcher',
    'Compact drum attachment with a 28.0 in working width and a listed cutting diameter of 3.1 in.',
    'A compact drum attachment for brush clearing and vegetation maintenance. Before ordering, compare your carrier’s hydraulic flow, operating pressure and mounting interface with the specifications below. Cutting results depend on plant type, ground conditions and operating technique.',
    '/assets/generated/product-hm38.webp', '[]'::jsonb,
    '["710 mm (28.0 in) working width","80 mm (3.1 in) listed cutting diameter","14 cutting blades","Confirm hydraulic and mounting compatibility before purchase"]'::jsonb,
    '[{"label":"Working width","value":"710 mm (28.0 in)"},{"label":"Cutting diameter","value":"80 mm (3.1 in)"},{"label":"Number of blades","value":"14"},{"label":"Operating pressure","value":"14–21 MPa (2,030–3,045 psi)"},{"label":"Hydraulic flow","value":"25–35 L/min (6.6–9.2 gpm)"},{"label":"Length","value":"970 mm (38.2 in)"},{"label":"Width","value":"900 mm (35.4 in)"},{"label":"Height","value":"900 mm (35.4 in)"},{"label":"Weight","value":"260 kg (573 lb)"}]'::jsonb,
    '[]'::jsonb, 549900, 'USD', 0, true, true, 10
  ),
  (
    'hm-mm46', 'HM-MM46', 'mm46-mini-skid-steer-drum-mulcher', 'Drum Mulchers',
    'MM46 Mini Skid Steer Drum Forestry Mulcher',
    'Wider drum attachment with a 38.2 in working width and a listed cutting diameter of 3.9 in.',
    'A wider drum attachment for land maintenance and vegetation clearing. Confirm your carrier’s hydraulic flow, operating pressure and attachment interface against the specifications below before ordering. Cutting results vary with vegetation, ground conditions and operating technique.',
    '/assets/generated/product-hm46.webp', '[]'::jsonb,
    '["970 mm (38.2 in) working width","100 mm (3.9 in) listed cutting diameter","21 cutting blades","Confirm hydraulic and mounting compatibility before purchase"]'::jsonb,
    '[{"label":"Working width","value":"970 mm (38.2 in)"},{"label":"Cutting diameter","value":"100 mm (3.9 in)"},{"label":"Number of blades","value":"21"},{"label":"Operating pressure","value":"14–21 MPa (2,030–3,045 psi)"},{"label":"Hydraulic flow","value":"40–60 L/min (10.6–15.9 gpm)"},{"label":"Length","value":"1,185 mm (46.7 in)"},{"label":"Width","value":"900 mm (35.4 in)"},{"label":"Height","value":"980 mm (38.6 in)"},{"label":"Weight","value":"320 kg (705 lb)"}]'::jsonb,
    '[]'::jsonb, 649900, 'USD', 0, true, true, 20
  ),
  (
    'hm-tooth', 'HM-TOOTH', 'hardened-steel-mulcher-replacement-tooth', 'Replacement Parts',
    'Hardened Steel Mulcher Replacement Tooth',
    'Individual replacement cutting tooth for compatible forestry mulcher heads.',
    'Keep replacement teeth on hand for planned service. This listing is for one tooth. Compare the dimensions and mounting pattern with your existing tooth before ordering; contact product support if fitment is uncertain.',
    '/assets/generated/product-teeth.webp', '[]'::jsonb,
    '["Sold individually","Check the mounting pattern against the original part","Contact support to confirm fitment"]'::jsonb,
    '[]'::jsonb, '[]'::jsonb, 2499, 'USD', 0, true, false, 30
  ),
  (
    'hm-belt', 'HM-BELT', 'drum-mulcher-replacement-drive-belt', 'Replacement Parts',
    'Drum Mulcher Replacement Drive Belt',
    'Replacement drive belt for compatible drum forestry mulcher attachments.',
    'Keep a correctly matched drive belt available for maintenance. Compare the markings and dimensions on your current belt with your equipment before ordering. Product support can help confirm fitment from your attachment model and belt markings.',
    '/assets/generated/product-belt.webp', '[]'::jsonb,
    '["For compatible drum mulcher attachments","Verify belt markings and dimensions before ordering"]'::jsonb,
    '[]'::jsonb, '[]'::jsonb, 4999, 'USD', 0, true, false, 40
  ),
  (
    'hm-bracket', 'HM-BRACKET', 'weld-on-mulcher-teeth-mounting-bracket', 'Replacement Parts',
    'Weld-On Mulcher Teeth Mounting Bracket',
    'Replacement weld-on mounting bracket for compatible mulcher teeth.',
    'A replacement weld-on bracket for equipment maintenance and fabrication. Confirm the bore, tooth fit and installation requirements with your machine or attachment documentation before welding or ordering.',
    '/assets/generated/product-brackets.webp', '[]'::jsonb,
    '["Weld-on replacement bracket","Confirm bore and tooth compatibility before installation"]'::jsonb,
    '[]'::jsonb, '[]'::jsonb, 4999, 'USD', 0, true, false, 50
  )
) AS seed (
  id, sku, slug, category, name, summary, description, image_url, gallery,
  highlights, specifications, videos, price_cents, currency, stock, active, featured, sort_order
)
ON CONFLICT DO NOTHING;
    END IF;
    INSERT INTO cms_data_migrations (migration_id) VALUES ('004_storefront_catalog_v1') ON CONFLICT DO NOTHING;
  END IF;
END
$migration$;
