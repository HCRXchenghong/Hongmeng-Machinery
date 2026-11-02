DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cms_data_migrations WHERE migration_id = '008_product_blade_labels_v1') THEN
    UPDATE shop_products
    SET highlights = jsonb_set(highlights, '{2}', '"14 cutting blades"'::jsonb), updated_at = now()
    WHERE id = 'hm-mm38' AND highlights->>2 = '14 cutting teeth';
    UPDATE shop_products
    SET highlights = jsonb_set(highlights, '{2}', '"21 cutting blades"'::jsonb), updated_at = now()
    WHERE id = 'hm-mm46' AND highlights->>2 = '21 cutting teeth';
    INSERT INTO cms_data_migrations (migration_id)
    VALUES ('008_product_blade_labels_v1')
    ON CONFLICT DO NOTHING;
  END IF;
END;
$migration$;
