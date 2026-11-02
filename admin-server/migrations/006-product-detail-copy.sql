DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cms_data_migrations WHERE migration_id = '006_product_detail_faqs_v1') THEN
    UPDATE shop_products
    SET faqs = '[
      {"question":"What should I check before ordering?","answer":"Compare your carrier’s hydraulic flow, operating pressure, and mounting interface with the MM38 specifications on this page. Contact Hongmeng Machinery with your carrier model if you need help checking fitment."},
      {"question":"Does the MM38 fit every mini skid steer?","answer":"Compatibility depends on the carrier’s hydraulic system and attachment interface. The product name alone does not confirm fitment; verify the listed requirements with your machine documentation before ordering."},
      {"question":"How is delivery arranged for this attachment?","answer":"The seller will confirm freight arrangements and the delivery estimate for your destination. Do not assume free freight, a liftgate, or a delivery date unless it is confirmed for your order."},
      {"question":"Is this item in stock?","answer":"This item can be ordered as made-to-order when no on-hand inventory is listed. Contact the seller for a current production and fulfillment estimate before relying on a delivery date."}
    ]'::jsonb, updated_at = now()
    WHERE id = 'hm-mm38' AND faqs = '[]'::jsonb;

    UPDATE shop_products
    SET faqs = '[
      {"question":"What should I check before ordering?","answer":"Compare your carrier’s hydraulic flow, operating pressure, and mounting interface with the MM46 specifications on this page. Contact Hongmeng Machinery with your carrier model if you need help checking fitment."},
      {"question":"Does the MM46 fit every mini skid steer?","answer":"Compatibility depends on the carrier’s hydraulic system and attachment interface. The product name alone does not confirm fitment; verify the listed requirements with your machine documentation before ordering."},
      {"question":"How is delivery arranged for this attachment?","answer":"The seller will confirm freight arrangements and the delivery estimate for your destination. Do not assume free freight, a liftgate, or a delivery date unless it is confirmed for your order."},
      {"question":"Is this item in stock?","answer":"This item can be ordered as made-to-order when no on-hand inventory is listed. Contact the seller for a current production and fulfillment estimate before relying on a delivery date."}
    ]'::jsonb, updated_at = now()
    WHERE id = 'hm-mm46' AND faqs = '[]'::jsonb;

    UPDATE shop_products
    SET faqs = '[
      {"question":"How do I check whether this tooth fits my attachment?","answer":"Compare the dimensions, mounting pattern, and part markings with your existing tooth. Contact product support with your attachment model and clear photos if you are unsure."},
      {"question":"What quantity does this listing include?","answer":"This listing is for one replacement tooth. Confirm the quantity shown in your cart before submitting an order."},
      {"question":"When will a replacement part ship?","answer":"Availability and handling time depend on current inventory. The seller will confirm the fulfillment estimate if the part is made to order."}
    ]'::jsonb, updated_at = now()
    WHERE id = 'hm-tooth' AND faqs = '[]'::jsonb;

    UPDATE shop_products
    SET faqs = '[
      {"question":"How do I verify the replacement belt?","answer":"Compare the markings and dimensions on your existing belt with the product listing and attachment documentation. Contact product support with your model and belt markings if you need help."},
      {"question":"Does this belt fit all drum mulchers?","answer":"No universal fit is implied. Compatibility depends on the attachment model and belt dimensions; verify those details before ordering."},
      {"question":"When will the part ship?","answer":"Availability and handling time depend on current inventory. The seller will confirm the fulfillment estimate if the part is made to order."}
    ]'::jsonb, updated_at = now()
    WHERE id = 'hm-belt' AND faqs = '[]'::jsonb;

    UPDATE shop_products
    SET faqs = '[
      {"question":"How do I confirm this mounting bracket is the right part?","answer":"Compare the bore, tooth fit, dimensions, and attachment model with your existing part and service documentation before ordering."},
      {"question":"Does the listing include installation?","answer":"The listing is for the replacement weld-on bracket. Confirm installation requirements with your equipment documentation and a qualified technician."},
      {"question":"When will the part ship?","answer":"Availability and handling time depend on current inventory. The seller will confirm the fulfillment estimate if the part is made to order."}
    ]'::jsonb, updated_at = now()
    WHERE id = 'hm-bracket' AND faqs = '[]'::jsonb;

    INSERT INTO cms_data_migrations (migration_id)
    VALUES ('006_product_detail_faqs_v1')
    ON CONFLICT DO NOTHING;
  END IF;
END;
$migration$;
