/**
 * Local Shop state: favourites, recent searches, recently viewed.
 *
 * Plain JSON in the app's documents directory — not secrets, and a wishlist can
 * grow larger than a secure-store item comfortably allows.
 */
import * as FileSystem from 'expo-file-system';

import type { CatalogItem } from './catalog';

const FILE = `${FileSystem.documentDirectory ?? ''}htz-shop.json`;
const LIMITS = { favorites: 120, searches: 10, recent: 20 };

export type SavedProduct = {
  id: number;
  title: string;
  subtitle: string;
  price: number;
  image: string;
  typeId: number;
  savedAt: number;
};

export type ShopPrefs = {
  favorites: SavedProduct[];
  searches: string[];
  recent: SavedProduct[];
};

const EMPTY: ShopPrefs = { favorites: [], searches: [], recent: [] };

export function toSaved(item: CatalogItem): SavedProduct {
  return {
    id: item.id,
    title: item.title,
    subtitle: item.subtitle,
    price: item.price,
    image: item.image,
    typeId: item.typeId,
    savedAt: Date.now(),
  };
}

function cleanSaved(v: any): SavedProduct | null {
  const id = Number(v?.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  return {
    id,
    title: String(v?.title ?? ''),
    subtitle: String(v?.subtitle ?? ''),
    price: Number(v?.price) || 0,
    image: String(v?.image ?? ''),
    typeId: Number(v?.typeId) || 1,
    savedAt: Number(v?.savedAt) || 0,
  };
}

function unique<T extends { id: number }>(list: T[]): T[] {
  const seen = new Set<number>();
  return list.filter((x) => (x.id && !seen.has(x.id) ? (seen.add(x.id), true) : false));
}

export function normalizePrefs(raw: any): ShopPrefs {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    favorites: unique(
      (Array.isArray(r.favorites) ? r.favorites : []).map(cleanSaved).filter(Boolean) as SavedProduct[],
    ).slice(0, LIMITS.favorites),
    searches: [...new Set<string>((Array.isArray(r.searches) ? r.searches : []).map(String).filter(Boolean))].slice(
      0,
      LIMITS.searches,
    ),
    recent: unique(
      (Array.isArray(r.recent) ? r.recent : []).map(cleanSaved).filter(Boolean) as SavedProduct[],
    ).slice(0, LIMITS.recent),
  };
}

export async function loadShopPrefs(): Promise<ShopPrefs> {
  try {
    if (!FileSystem.documentDirectory) return { ...EMPTY };
    const info = await FileSystem.getInfoAsync(FILE);
    if (!info.exists) return { ...EMPTY };
    const raw = await FileSystem.readAsStringAsync(FILE);
    return normalizePrefs(JSON.parse(raw));
  } catch {
    return { ...EMPTY };
  }
}

export async function saveShopPrefs(prefs: ShopPrefs): Promise<boolean> {
  try {
    if (!FileSystem.documentDirectory) return false;
    await FileSystem.writeAsStringAsync(FILE, JSON.stringify(normalizePrefs(prefs)));
    return true;
  } catch {
    return false;
  }
}

/** Prepend a search term, de-duplicated and capped. */
export function withSearch(prefs: ShopPrefs, term: string): ShopPrefs {
  const t = term.trim();
  if (!t) return prefs;
  return normalizePrefs({ ...prefs, searches: [t, ...prefs.searches.filter((s) => s !== t)] });
}

export function withRecent(prefs: ShopPrefs, item: CatalogItem): ShopPrefs {
  return normalizePrefs({
    ...prefs,
    recent: [toSaved(item), ...prefs.recent.filter((x) => x.id !== item.id)],
  });
}

export function toggleFavorite(prefs: ShopPrefs, item: CatalogItem): ShopPrefs {
  const exists = prefs.favorites.some((f) => f.id === item.id);
  return normalizePrefs({
    ...prefs,
    favorites: exists
      ? prefs.favorites.filter((f) => f.id !== item.id)
      : [toSaved(item), ...prefs.favorites],
  });
}
