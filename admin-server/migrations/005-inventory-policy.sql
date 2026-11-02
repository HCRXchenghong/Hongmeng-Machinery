-- Made-to-order products can accept orders without advertising fictitious stock.
ALTER TABLE shop_products
  ADD COLUMN IF NOT EXISTS allow_backorder BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE shop_products
  ADD COLUMN IF NOT EXISTS faqs JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE shop_settings
  ADD COLUMN IF NOT EXISTS shipping_policy TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS returns_policy TEXT NOT NULL DEFAULT '';

-- The initial catalog represents the seller's own manufactured products. Keep
-- physical inventory at zero until verified, but allow the seller to receive
-- made-to-order requests from the storefront.
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cms_data_migrations WHERE migration_id = '005_inventory_policies_and_storefront_v1') THEN
UPDATE shop_products
SET allow_backorder = true, updated_at = now()
WHERE id IN ('hm-mm38', 'hm-mm46', 'hm-tooth', 'hm-belt', 'hm-bracket')
  AND active = true;

-- Match the published manufacturer's performance specification terminology.
UPDATE shop_products
SET specifications = (
  SELECT COALESCE(jsonb_agg(
    CASE WHEN item->>'label' = 'Number of teeth'
      THEN jsonb_set(item, '{label}', '"Number of blades"'::jsonb)
      ELSE item
    END
  ), '[]'::jsonb)
  FROM jsonb_array_elements(specifications) AS item
), updated_at = now()
WHERE id IN ('hm-mm38', 'hm-mm46')
  AND specifications @> '[{"label":"Number of teeth"}]'::jsonb;

-- Seed editable English storefront copy once, without overwriting merchant work.
UPDATE shop_settings
SET storefront_content = jsonb_build_object(
  'brand', jsonb_build_object('name','Hongmeng Machinery','tagline','ENGINEERED FOR THE FIELD','logo','/assets/hongmeng-logo.svg'),
  'announcement', jsonb_build_object('text','Direct from the manufacturer · Made-to-order options available','cta','Shop equipment','ctaHref','/shop/'),
  'navigation', jsonb_build_object('homeLabel','Home','aboutLabel','About','productsLabel','Shop','solutionsLabel','Applications','contactLabel','Contact'),
  'home', jsonb_build_object(
    'eyebrow','HONGMENG MACHINERY / EQUIPMENT ATTACHMENTS',
    'title','Tools built for the work ahead.',
    'subtitle','Explore forestry mulcher attachments and replacement parts from the manufacturer. Review specifications, confirm fitment, and order online.',
    'heroImage','/assets/generated/home-hero.webp',
    'cta','Shop attachments','ctaHref','/shop/',
    'introEyebrow','BUILT BY HONGMENG',
    'introTitle','Equipment attachments, direct from the source.',
    'introDescription','Shop dedicated product pages with current pricing, specifications, product imagery, and ordering options. Have a fitment question? Our team can help you verify your machine requirements before you buy.',
    'introImage','/assets/generated/home-intro.webp',
    'introCta','Meet Hongmeng','introCtaHref','/about/',
    'featureEyebrow','FORESTRY MULCHING',
    'featureTitle','A clearer path from product details to the job site.',
    'featureDescription','Compare working width, cutting diameter, hydraulic flow, pressure, dimensions, and weight on each product page. Check every requirement against your carrier before ordering.',
    'featureImage','/assets/generated/home-feature.webp',
    'featureCta','Compare products','featureCtaHref','/shop/',
    'featuredEyebrow','SHOP HONGMENG',
    'featuredTitle','Attachments and replacement parts',
    'featuredDescription','Prices and availability are managed by Hongmeng Machinery.',
    'featuredLinkLabel','View all products','featuredHref','/shop/',
    'bottomEyebrow','READY FOR YOUR NEXT PROJECT?',
    'bottomTitle','Find the right attachment for your equipment.',
    'bottomDescription','Review the specifications or contact us to confirm compatibility and fulfillment details.',
    'bottomImage','/assets/generated/home-feature.webp',
    'bottomCta','Ask a product question','bottomCtaHref','/contact/',
    'benefits',jsonb_build_array(
      jsonb_build_object('title','Made by Hongmeng','description','Buy attachments and parts directly from the manufacturer.'),
      jsonb_build_object('title','Detailed product pages','description','Review pricing, specifications, fitment notes, images, and video.'),
      jsonb_build_object('title','Flexible fulfillment','description','In-stock and made-to-order options are shown by product.'),
      jsonb_build_object('title','Product support','description','Contact our team with your machine model and job requirements.')
    )
  ),
  'solutions', jsonb_build_object(
    'eyebrow','APPLICATIONS / HONGMENG MACHINERY','title','Choose equipment for the work you do.',
    'description','Start with the carrier, attachment interface, hydraulic system, vegetation, and site conditions. Confirm compatibility before ordering.',
    'image','/assets/generated/home-feature.webp',
    'itemOneTitle','Brush and vegetation management','itemOneDescription','Review the listed cutting diameter and operating requirements for your clearing work. Results vary with vegetation, ground conditions, and operation.','itemOneImage','/assets/generated/news-field.webp',
    'itemTwoTitle','Mini skid steer attachments','itemTwoDescription','Compare carrier flow, operating pressure, and mounting interface with the specifications on each attachment page.','itemTwoImage','/assets/generated/product-hm38.webp',
    'itemThreeTitle','Replacement parts','itemThreeDescription','Use the model, part markings, and dimensions to check that replacement parts fit your attachment.','itemThreeImage','/assets/generated/product-teeth.webp',
    'bottomTitle','Need help checking fitment?','bottomDescription','Send us your equipment model, hydraulic specifications, and attachment interface.','bottomCta','Contact product support'
  ),
  'about', jsonb_build_object(
    'eyebrow','ABOUT HONGMENG','title','Attachments from the manufacturer.',
    'description','Hongmeng Machinery designs and manufactures equipment attachments and replacement parts.',
    'body','<p>Shop forestry mulcher attachments and replacement parts directly from Hongmeng Machinery. Our product pages provide the available specifications, pricing, imagery, and purchasing options for each item.</p><p>Before ordering, confirm that the carrier flow, operating pressure, mounting interface, and job conditions match the product requirements. Contact us if you need help reviewing the listing.</p>',
    'heroImage','/assets/generated/about-hero.webp','image','/assets/generated/about-detail.webp',
    'ctaLabel','Ask about fitment','ctaHref','/contact/','finalTitle','Explore attachments and replacement parts.','finalCta','Shop products','finalCtaHref','/shop/'
  ),
  'shop', jsonb_build_object('eyebrow','SHOP / HONGMENG MACHINERY','title','Shop attachments and parts','description','Browse product pricing, availability, detailed specifications, imagery, and ordering options.','emptyMessage','There are no published products yet.'),
  'contact', jsonb_build_object('title','Contact Hongmeng Machinery','description','Tell us your equipment model, hydraulic requirements, job conditions, or order question.','sideTitle','Let’s check the details.','sideDescription','Ask about fitment, product specifications, order status, or fulfillment.','image','/assets/generated/contact-support.webp'),
  'news', jsonb_build_object('eyebrow','FROM HONGMENG MACHINERY','title','Product news and field notes','description','Product updates, maintenance information, and application notes.','storyEyebrow','PRODUCT NOTES','storyTitle','Make your next equipment decision with the details in hand.','storyDescription','Review the product pages or contact our team to discuss machine compatibility and purchasing.','image','/assets/generated/news-field.webp','primaryCta','Contact product support','primaryHref','/contact/','secondaryCta','Shop products','secondaryHref','/shop/'),
  'footer', jsonb_build_object('description','Forestry mulcher attachments and replacement parts, made by Hongmeng Machinery.','quickLinksTitle','Shop','helpTitle','Need help?','helpText','Questions about fitment, an order, or delivery? Contact our team.','supportTitle','Customer service','productsLabel','Shop products','aboutLabel','About Hongmeng','newsLabel','News','contactLabel','Contact','accountLabel','My account','cartLabel','Cart and checkout','privacyLabel','Privacy policy','cookieLabel','Cookie policy','termsLabel','Sales terms','shippingLabel','Shipping policy','returnsLabel','Returns and refunds')
)
WHERE storefront_content = '{}'::jsonb;

UPDATE shop_settings
SET privacy_policy = CASE WHEN privacy_policy = '' THEN
E'Hongmeng Machinery Privacy Notice\n\nLast updated: October 22, 2026\n\nThis notice describes how Hongmeng Machinery collects and uses information when you visit our website, create an account, contact us, or place an order. Before public launch, replace this trade name with the exact legal seller name and add the seller mailing address and privacy contact.\n\nInformation we collect: account name and email, contact details, delivery and billing information you provide, order and fulfillment records, support messages, and technical data needed to secure the site. Payment card details are handled by the payment provider and are not stored by Hongmeng Machinery.\n\nHow we use information: to provide accounts, process and fulfill orders, provide support, prevent fraud, keep required business records, and respond to privacy requests. If you choose Google or Facebook sign-in, that provider shares the identity details described in its own privacy notice. Payment providers process payment details under their own terms.\n\nCookies and browser storage: necessary storage supports cart, account, security, and privacy preferences. Optional analytics and advertising storage is off unless you opt in. The site currently does not use advertising trackers. You can update your choice from Cookie Settings.\n\nSharing: information may be disclosed to hosting, payment, customer service, security, and shipping providers when needed to operate the store. We do not currently sell personal information or share it for cross-context behavioral advertising.\n\nYour choices: depending on your state and applicable law, you may request access to, correction, deletion, or a copy of your personal information, or opt out of sale or sharing. Use the Contact page; you do not need an account to submit a request. We may need to verify your identity or an authorized agent.\n\nRetention and security: account, order, and support information is retained as needed for service, accounting, legal requirements, disputes, and security. Passwords are stored as salted hashes. No internet service can guarantee absolute security.\n\nChildren: this equipment store is intended for adult purchasers and is not directed to children under 13.\n\nContact: use the Contact page. Add the legal seller identity, postal address, and dedicated privacy email before launch.'
ELSE privacy_policy END,
cookie_policy = CASE WHEN cookie_policy = '' THEN
E'Cookie and Browser Storage Notice\n\nLast updated: October 22, 2026\n\nNecessary browser storage supports shopping cart, customer account, security, chat session, and your privacy choice. Optional analytics and marketing storage is off unless you opt in. The storefront does not currently load advertising or analytics tags.\n\nChoose Reject Optional or customize your choice in the consent dialog. Your preference is saved in this browser. You can reopen Cookie Settings from the Privacy Policy page. Clearing browser storage resets your choice.'
ELSE cookie_policy END,
terms_policy = CASE WHEN terms_policy = '' THEN
E'Sales and Website Terms\n\nLast updated: October 22, 2026\n\nThese terms apply to the Hongmeng Machinery website and orders placed through it. Before public launch, enter the exact seller legal entity, business mailing address, governing jurisdiction, and final return and shipping rules.\n\nProduct information and fitment: product descriptions, images, videos, specifications, prices, and availability are maintained by the seller. Confirm machine compatibility, hydraulic flow, operating pressure, mounting interface, and job requirements before ordering. Illustrative images are not technical specifications.\n\nPrices and orders: displayed prices use the currency shown. The server rechecks price and availability when you place an order. Shipping and other charges are shown before final submission. An online payment is complete only when confirmed by the payment provider.\n\nFulfillment: shipping dates are estimates unless confirmed by the seller. Tracking details are added to your account after dispatch.\n\nReturns and cancellations: review the Shipping Policy and Returns and Refunds Policy before ordering. Contact the seller promptly about cancellation before fulfillment or to request return instructions. Applicable consumer rights are not waived.\n\nWebsite use: do not interfere with the site, access another customer''s account, or submit false information. The seller may contact you if an item is unavailable, a listing has a material error, or a payment cannot be authorized.\n\nContact: use the Contact page for order, delivery, return, or account questions. Add the seller legal identity, applicable law, jurisdiction, and final business terms before launch.'
ELSE terms_policy END,
shipping_policy = CASE WHEN shipping_policy = '' THEN
E'Shipping Policy\n\nLast updated: October 22, 2026\n\nShipping methods, destination coverage, charges, handling times, and delivery estimates vary by item and destination. Any shipping charge shown at checkout is part of the order total. If freight delivery requires special equipment or access, the seller will confirm arrangements with you before dispatch.\n\nIn-stock items are prepared after order confirmation. Made-to-order items require a production and fulfillment estimate from the seller; contact us before ordering if you need a date commitment. Transit time begins after dispatch and is an estimate.\n\nWhen an order ships, tracking details will appear in your customer account if the carrier provides tracking. Contact Hongmeng Machinery if tracking is missing or a delivery is delayed.\n\nBefore launch, replace this template with confirmed handling times, carriers, service areas, freight, liftgate, and delivery rules.'
ELSE shipping_policy END,
returns_policy = CASE WHEN returns_policy = '' THEN
E'Returns and Refunds Policy\n\nLast updated: October 22, 2026\n\nContact Hongmeng Machinery before returning an item. We will provide return authorization and destination instructions where a return is accepted. Do not ship an item back without written instructions.\n\nEligibility, return windows, product condition, return freight, restocking charges, cancellation limits, and refund timing depend on the product and applicable law. Any product-specific terms must be shown before purchase. If an item arrives damaged or incorrect, contact us promptly with the order number and photos of the issue.\n\nApproved refunds are issued to the original payment method when available. Processing time depends on the payment provider and financial institution.\n\nBefore launch, enter the seller-confirmed return window, conditions, return address, return freight responsibility, cancellation process, and refund timeframes. Applicable consumer rights are not limited by this policy.'
ELSE returns_policy END,
updated_at = now()
WHERE id = 1;

INSERT INTO cms_data_migrations (migration_id)
VALUES ('005_inventory_policies_and_storefront_v1')
ON CONFLICT DO NOTHING;
  END IF;
END;
$migration$;
