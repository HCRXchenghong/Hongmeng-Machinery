DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cms_data_migrations WHERE migration_id = '007_generated_product_gallery_v1') THEN
    UPDATE shop_products SET gallery = '["/assets/generated/product-hm38-side.webp"]'::jsonb, updated_at = now()
    WHERE id = 'hm-mm38' AND gallery = '[]'::jsonb;
    UPDATE shop_products SET gallery = '["/assets/generated/product-hm46-side.webp"]'::jsonb, updated_at = now()
    WHERE id = 'hm-mm46' AND gallery = '[]'::jsonb;
    UPDATE shop_products SET gallery = '["/assets/generated/product-teeth-detail.webp"]'::jsonb, updated_at = now()
    WHERE id = 'hm-tooth' AND gallery = '[]'::jsonb;
    UPDATE shop_products SET gallery = '["/assets/generated/product-belt-detail.webp"]'::jsonb, updated_at = now()
    WHERE id = 'hm-belt' AND gallery = '[]'::jsonb;
    UPDATE shop_products SET gallery = '["/assets/generated/product-brackets-detail.webp"]'::jsonb, updated_at = now()
    WHERE id = 'hm-bracket' AND gallery = '[]'::jsonb;

    INSERT INTO cms_data_migrations (migration_id)
    VALUES ('007_generated_product_gallery_v1')
    ON CONFLICT DO NOTHING;
  END IF;
END;
$migration$;
