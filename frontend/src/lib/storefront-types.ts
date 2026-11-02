import type { StoreMedia } from '../components/MediaCarousel';

export type Product = {
  id: string; sku: string; slug: string; category: string; name: string; summary: string;
  description: string; image_url: string; gallery: string[]; price_cents: number;
  currency: 'USD' | 'CNY'; stock: number; allow_backorder: boolean; available: boolean; featured: boolean;
  highlights: string[]; specifications: Array<{ label: string; value: string }>; faqs: Array<{ question: string; answer: string }>; videos: StoreMedia[];
};

export type CartLine = { id: string; quantity: number };
export type PaymentProvider = 'manual' | 'stripe' | 'paypal';
