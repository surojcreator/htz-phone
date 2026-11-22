/**
 * Native catalogue — the Android API the official app uses.
 *
 *   getItems            { categoryId }             home feed / one category
 *   searchQuery         { q }                      search (`data.res`)
 *   getItem             { itemId, itemType }       native product page
 *   getItemMoreProducts { itemId, itemType }       similar products
 *   getItemComments     { itemId, itemType }       rating + reviews
 *   getPopularSearches  {}                         trending searches
 *
 * Read-only and public. Cart writes stay in `wallet.ts`.
 */
import { HtzClient } from './api';
import { readProductWebview } from './wallet';

export type CatalogItem = {
  id: number;
  title: string;
  subtitle: string;
  price: number;
  fullPrice: number;
  htzPrice: number;
  image: string;
  brand: string;
  rating: number;
  reviews: number;
  typeId: number;
  productType: number;
  stockEmpty: boolean;
  priceStartsFrom: boolean;
  isAttraction: boolean;
  /** concrete SKU the store expects as variant_id, when the item exposes one */
  collectedId: number;
  /** false for lead/quote items the store does not sell through the cart */
  canBuy: boolean;
  categoryId: number;
  categoryPath: string[];
  raw: any;
};

export type CatalogSection = {
  key: string;
  order: number;
  categoryId: number;
  title: string;
  items: CatalogItem[];
};

export type DeliveryChoice = { title: string; price: number };

export type ProductComment = {
  author: string;
  rating: number;
  text: string;
  date: string;
};

export type ProductDetail = CatalogItem & {
  images: string[];
  description: string;
  specs: string[];
  warranty: string;
  stock: number | null;
  maxPurchase: number | null;
  delivery: DeliveryChoice[];
  canUseObligo: boolean;
  obligoText: string;
  itemUrl: string;
  savingsPct: number;
  /** PDP wording for the purchase cap, when the product publishes one */
  limitNote?: string;
  variants: { id: number; price: number; label: string; max?: number; stock?: number; inStock?: boolean }[];
};

export type SortMode = 'relevance' | 'price-asc' | 'price-desc' | 'rating' | 'name';

export const SORTS: { id: SortMode; label: string }[] = [
  { id: 'relevance', label: 'Recommended' },
  { id: 'price-asc', label: 'Price ↑' },
  { id: 'price-desc', label: 'Price ↓' },
  { id: 'rating', label: 'Rating' },
  { id: 'name', label: 'A–Z' },
];

const num = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).trim();

const list = (v: unknown): any[] =>
  Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v as Record<string, any>) : [];

/** Strip the markup the store sometimes ships inside brief/spec fields. */
const cleanText = (v: unknown): string =>
  str(v)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** `₪1,299` — Hermes has no reliable Intl, so format by hand. */
export function formatILS(n: number): string {
  const v = Math.round(Number.isFinite(n) ? n : 0).toString();
  return '₪' + v.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** The native image fallback the official app itself builds. */
export function itemImageUrl(id: number, size = 300): string {
  return `https://mediacrm.htzone.co.il/item_image/${id}.jpg&w=${size}&h=${size}&nl=1`;
}

function mediaPaths(raw: any): string[] {
  const groups = [
    ...list(raw?.mediaGroupsArr),
    ...list(raw?.mediaGroupsArr2),
    ...list(raw?.mediaGroupsArr3),
  ];
  const withPath = groups.filter((g) => g && typeof g.path === 'string' && g.path);
  withPath.sort((a, b) => num(b.main_picture) - num(a.main_picture));
  return [...new Set(withPath.map((g) => String(g.path)))];
}

function categoryPathOf(raw: any): string[] {
  const cats = raw?.categories;
  const ordered =
    cats && typeof cats === 'object'
      ? [cats.item_category, cats.item_category2, cats.item_category3]
      : [];
  const more = [raw?.item_category, raw?.item_category2, raw?.item_category3];
  return [...new Set([...ordered, ...more].map(str).filter(Boolean))];
}

const boolish = (v: unknown): boolean => v === true || v === 1 || str(v) === '1';

export function normalizeItem(raw: any): CatalogItem {
  const id = num(raw?.id ?? raw?.item_id);
  const priceArr = raw?.priceArr || {};
  const image =
    str(raw?.img) ||
    str(raw?.main_image) ||
    mediaPaths(raw)[0] ||
    (id ? itemImageUrl(id) : '');
  const noCart = boolish(raw?.do_not_show_cart_button);
  const lead = boolish(raw?.show_lead);
  return {
    id,
    title: str(raw?.title_override) || str(raw?.title) || str(raw?.name) || `#${id}`,
    subtitle: str(raw?.sub_title_override) || str(raw?.sub_title),
    price: num(raw?.price ?? priceArr.price),
    fullPrice: num(raw?.full_price ?? priceArr.full_price),
    htzPrice: num(raw?.htz_card_price ?? priceArr.htz_card_price),
    image,
    brand: str(raw?.brand_title),
    rating: num(raw?.avg_rating ?? raw?.review_avg),
    reviews: num(raw?.reviews),
    typeId: num(raw?.type_id) || 1,
    productType: num(raw?.product_type),
    stockEmpty: str(raw?.stock_empty) === '1',
    priceStartsFrom: str(raw?.is_price_starts_from) === '1',
    isAttraction: !!raw?.is_attraction,
    collectedId: num(priceArr.collected_id ?? raw?.collected_id ?? raw?.item_collected_id ?? raw?.collected),
    canBuy: !noCart && !lead,
    categoryId: num(raw?.category_id),
    categoryPath: categoryPathOf(raw),
    raw,
  };
}

function sectionsOf(data: any): CatalogSection[] {
  if (!data || typeof data !== 'object') return [];
  const out: CatalogSection[] = [];
  for (const [key, sec] of Object.entries<any>(data)) {
    if (!sec || typeof sec !== 'object') continue;
    const items = list(sec.itemsArr).map(normalizeItem).filter((i) => i.id > 0);
    if (!items.length) continue;
    out.push({
      key,
      order: num(sec.order_num) || num(sec.orderNum) || num(key),
      categoryId: num(sec.categoryId ?? sec.category_id),
      title: str(sec.title) || 'Products',
      items,
    });
  }
  out.sort((a, b) => a.order - b.order);
  return out;
}

/** De-duplicate while keeping the first occurrence (feed repeats products). */
export function dedupeItems(items: CatalogItem[]): CatalogItem[] {
  const seen = new Set<number>();
  return items.filter((i) => {
    if (!i.id || seen.has(i.id)) return false;
    seen.add(i.id);
    return true;
  });
}

export function sortItems(items: CatalogItem[], mode: SortMode): CatalogItem[] {
  const copy = [...items];
  switch (mode) {
    case 'price-asc':
      return copy.sort((a, b) => a.price - b.price);
    case 'price-desc':
      return copy.sort((a, b) => b.price - a.price);
    case 'rating':
      return copy.sort((a, b) => b.rating - a.rating);
    case 'name':
      return copy.sort((a, b) => a.title.localeCompare(b.title, 'he'));
    default:
      return copy;
  }
}

export function filterItems(
  items: CatalogItem[],
  opts: { min?: number; max?: number; inStockOnly?: boolean; hideAttractions?: boolean },
): CatalogItem[] {
  return items.filter((i) => {
    if (opts.inStockOnly && i.stockEmpty) return false;
    if (opts.hideAttractions && i.isAttraction) return false;
    if (opts.min != null && opts.min > 0 && i.price < opts.min) return false;
    if (opts.max != null && opts.max > 0 && i.price > opts.max) return false;
    return true;
  });
}

/** Home feed (categoryId 0) or a single category. */
export async function readFeed(client: HtzClient, categoryId = 0): Promise<CatalogSection[]> {
  const data = await client.appItems({ categoryId });
  return sectionsOf(data);
}

/** Flat list for a category page. */
export async function readCategory(client: HtzClient, categoryId: number): Promise<CatalogItem[]> {
  const sections = await readFeed(client, categoryId);
  return dedupeItems(sections.flatMap((s) => s.items));
}

/** Search results, already flattened. */
export async function searchCatalog(client: HtzClient, query: string): Promise<CatalogItem[]> {
  // `isPage` switches the API from the 8-item suggestion block to the whole
  // search-results page (limit 100). Without it a search only ever showed 8.
  const q = query.trim();
  let data = await client.appSearch({ q, isPage: 1 });
  let items = list(data?.res);
  // Some hosts only react to the boolean spelling; keep whichever is larger.
  if (items.length <= 8) {
    try {
      const alt = await client.appSearch({ q, isPage: true });
      const altItems = list(alt?.res);
      if (altItems.length > items.length) {
        data = alt;
        items = altItems;
      }
    } catch {
      /* keep the first answer */
    }
  }
  return dedupeItems(items.map(normalizeItem).filter((i) => i.id > 0));
}

/** Similar products for a product page. */
export async function readMoreProducts(client: HtzClient, item: CatalogItem): Promise<CatalogItem[]> {
  const data = await client.appMoreProducts({ itemId: item.id, itemType: item.typeId || 1 });
  return dedupeItems(list(data?.itemsArr).map(normalizeItem).filter((i) => i.id > 0 && i.id !== item.id));
}

/** Trending terms, ordered by the store's own counter. */
export async function readPopularSearches(client: HtzClient): Promise<string[]> {
  const data = await client.appPopularSearches();
  return list(data)
    .map((x) => str(x?.term))
    .filter(Boolean)
    .slice(0, 12);
}

/** Reviews; many products have none, so callers must handle an empty list. */
export async function readComments(
  client: HtzClient,
  item: CatalogItem,
): Promise<{ rating: number; count: number; comments: ProductComment[] }> {
  const data = await client.appComments({ itemId: item.id, itemType: item.typeId || 1 });
  const comments = list(data?.commentsArr).map((c) => ({
    author: str(c?.name ?? c?.user_name ?? c?.author),
    rating: num(c?.rating ?? c?.stars),
    text: cleanText(c?.comment ?? c?.content ?? c?.text),
    date: str(c?.date ?? c?.created_at),
  }));
  return {
    rating: num(data?.item_rating),
    count: num(data?.num_ratings) || comments.length,
    comments,
  };
}

function nativeVariants(data: any): ProductDetail['variants'] {
  const collected = list(data?.items_collected);
  return collected
    .map((v) => {
      const id = num(v?.priceArr?.collected_id ?? v?.collected_id ?? v?.id);
      const stock = num(v?.total_stock ?? v?.total_count);
      const active = str(v?.active) !== '0';
      return {
        id,
        price: num(v?.price),
        label: str(v?.title),
        max: num(v?.max_purchase) || undefined,
        stock: stock > 0 ? stock : undefined,
        inStock: active && (stock === 0 ? false : true),
      };
    })
    .filter((v) => v.id > 0);
}

/** Native SKUs for an item — no store web page involved. */
export async function readNativeVariants(
  client: HtzClient,
  item: { id: number; typeId?: number },
): Promise<ProductDetail['variants']> {
  const data = await client.appItem({ itemId: item.id, itemType: item.typeId || 1 });
  return nativeVariants(data);
}

/**
 * Product pages the Android API refuses (`type 4` vouchers come back as a bare
 * `{ redirectUrl }`) still have a full PDP on the site. Build the detail from
 * that instead of rendering an empty shell (`title "#0"`, price 0, no models).
 */
async function readWebDetail(client: HtzClient, item: CatalogItem): Promise<ProductDetail | null> {
  const ref = await readProductWebview(client, item.id, item.isAttraction ? 'quick' : 'regular').catch(() => null);
  if (!ref) return null;
  const price = ref.price && ref.price > 0 ? ref.price : item.price;
  const fullPrice = ref.fullPrice && ref.fullPrice > 0 ? ref.fullPrice : item.fullPrice;
  const images = [ref.image, item.image].filter((v): v is string => !!v);
  const inStock = ref.variants.filter((v) => v.inStock !== false);
  // The website is authoritative for availability: the app API marks products
  // it cannot sell as stock_empty even when the PDP says "add to cart".
  const webAvailable = ref.available === true || (ref.ctaKind === 'add_to_cart' && ref.available !== false);
  return {
    ...item,
    title: ref.title && ref.title !== String(item.id) ? ref.title : item.title,
    price,
    fullPrice,
    stockEmpty: webAvailable ? false : ref.variants.length ? !inStock.length : item.stockEmpty,
    canBuy: webAvailable ? true : item.canBuy !== false && (!ref.variants.length || inStock.length > 0),
    image: images[0] ?? item.image,
    images: images.length ? images : [item.image].filter(Boolean),
    description: ref.description ?? '',
    specs: [],
    warranty: '',
    stock: null,
    maxPurchase: ref.maxPurchase ?? null,
    limitNote: ref.limitNote,
    delivery: [],
    canUseObligo: false,
    obligoText: '',
    itemUrl: `https://www.htzone.co.il/webview/${item.id}`,
    savingsPct: fullPrice > price && fullPrice > 0 ? Math.round((1 - price / fullPrice) * 100) : 0,
    variants: ref.variants,
  };
}

/** Full native product page. */
export async function readDetail(
  client: HtzClient,
  item: CatalogItem,
  typeId?: number,
): Promise<ProductDetail> {
  const data = await client.appItem({ itemId: item.id, itemType: typeId ?? item.typeId ?? 1 }).catch(() => null);
  const nativeUsable = !!data && (!!str(data.title) || nativeVariants(data).length > 0 || num(data?.priceArr?.price) > 0);
  if (!nativeUsable) {
    const web = await readWebDetail(client, item);
    if (web) return web;
    throw new Error('מוצר לא זמין לצפיה');
  }
  const merged = { ...item.raw, ...(data || {}) };
  const base = normalizeItem(merged);
  const priceArr = data?.priceArr || {};

  const descriptionParts = [data?.brief, data?.content1, data?.content, data?.box_content]
    .map(cleanText)
    .filter((v, i, arr) => v && arr.indexOf(v) === i);

  const specs = [data?.full_spec1, data?.full_spec2]
    .map(cleanText)
    .filter((v, i, arr) => v && arr.indexOf(v) === i && !descriptionParts.some((d) => d.includes(v)));

  const stockEntries = list(data?.items_stock);
  const stock = stockEntries.length
    ? stockEntries.reduce(
        (sum, e) => sum + Math.max(0, num(e.total_count) - num(e.purchase_count)),
        0,
      )
    : null;

  const maxPurchase =
    num(data?.max_purchase) ||
    Math.max(0, ...nativeVariants(data).map((v) => v.max ?? 0)) ||
    null;

  const delivery: DeliveryChoice[] = list(data?.delivery).map((d) => ({
    title: str(d.title),
    price: num(d.sum ?? d.price),
  }));

  const price = num(priceArr.price) || base.price;
  const fullPrice = num(priceArr.full_price) || base.fullPrice;
  const savingsPct =
    fullPrice > price && fullPrice > 0 ? Math.round((1 - price / fullPrice) * 100) : 0;

  return {
    ...base,
    price,
    fullPrice,
    htzPrice: num(priceArr.htz_card_price) || base.htzPrice,
    images: mediaPaths(data).length ? mediaPaths(data) : [base.image].filter(Boolean),
    description: descriptionParts.join('\n\n'),
    specs,
    warranty: cleanText(data?.warranty),
    stock: stock != null && Number.isFinite(stock) ? stock : null,
    maxPurchase,
    delivery,
    canUseObligo: !!num(data?.can_use_obligo),
    obligoText: cleanText(data?.obligo_text),
    itemUrl: str(data?.itemUrl),
    savingsPct,
    variants: nativeVariants(data),
  };
}
