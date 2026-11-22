import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { HtzClient } from '../core/api';
import {
  CatalogItem,
  CatalogSection,
  filterItems,
  sortItems,
  SortMode,
  ProductDetail,
  readCategory,
  readComments,
  readDetail,
  readFeed,
  readMoreProducts,
  readNativeVariants,
  readPopularSearches,
  searchCatalog,
} from '../core/catalog';
import { loadShopPrefs, saveShopPrefs, ShopPrefs, toggleFavorite, withRecent, withSearch } from '../core/prefs';
import { addErrorText, addToCart, ProductRef, readCart, readNativeCart, readProductWebview, verifyAddedItem } from '../core/wallet';
import { useCreds } from '../ui/credentials';
import { theme } from '../ui/theme';
import { Field } from '../ui/Field';
import { CommentsView, ProductPage } from './shop/ProductPage';
import { BrowseView, FavoritesView, HomeView, SearchView } from './shop/views';

type Props = { onOpenCart?: () => void; active?: boolean };
type ViewMode = 'home' | 'category' | 'search' | 'favorites' | 'product';

const EMPTY_PREFS: ShopPrefs = { favorites: [], searches: [], recent: [] };

export default function ShopScreen({ onOpenCart, active }: Props) {
  const creds = useCreds();

  const [view, setView] = useState<ViewMode>('home');
  const [prefs, setPrefs] = useState<ShopPrefs>(EMPTY_PREFS);
  const [accountOpen, setAccountOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [home, setHome] = useState<CatalogSection[]>([]);
  const [homeBusy, setHomeBusy] = useState(false);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [popular, setPopular] = useState<string[]>([]);

  const [category, setCategory] = useState<{ id: number; title: string; items: CatalogItem[] } | null>(null);
  const [catBusy, setCatBusy] = useState(false);
  const [catError, setCatError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<CatalogItem[] | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [sort, setSort] = useState<SortMode>('relevance');
  const [inStockOnly, setInStockOnly] = useState(false);
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [variants, setVariants] = useState<ProductRef['variants']>([]);
  const [variantId, setVariantId] = useState<number | null>(null);
  const [qty, setQty] = useState(1);
  const [cartKind, setCartKind] = useState<'regular' | 'quick'>('regular');
  const [comments, setComments] = useState<CommentsView | null>(null);
  const [similar, setSimilar] = useState<CatalogItem[]>([]);

  const [addBusy, setAddBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const [quickBusyId, setQuickBusyId] = useState<number | null>(null);
  const [cartCount, setCartCount] = useState(0);

  const started = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const originRef = useRef<ViewMode>('home');
  const addLock = useRef(false);
  const quickLocks = useRef(new Set<number>());

  const top = () => scrollRef.current?.scrollTo({ y: 0, animated: false });

  const client = useCallback(
    () => new HtzClient(creds.email.trim(), creds.password),
    [creds.email, creds.password],
  );

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const persist = useCallback((next: ShopPrefs) => {
    setPrefs(next);
    saveShopPrefs(next).catch(() => {});
  }, []);

  useEffect(() => {
    loadShopPrefs().then(setPrefs);
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const loadHome = useCallback(async () => {
    setHomeBusy(true);
    setHomeError(null);
    try {
      const c = new HtzClient(creds.email.trim(), creds.password);
      const [sections, terms] = await Promise.all([
        readFeed(c, 0),
        readPopularSearches(c).catch(() => [] as string[]),
      ]);
      setHome(sections);
      setPopular(terms);
    } catch (e: any) {
      setHomeError(e?.message ?? String(e));
    } finally {
      setHomeBusy(false);
    }
  }, [creds.email, creds.password]);

  useEffect(() => {
    if (!active || started.current) return;
    started.current = true;
    loadHome();
  }, [active, loadHome]);

  const refreshCartCount = useCallback(async () => {
    if (!creds.email.trim() || !creds.password) return;
    try {
      const c = client();
      await c.ensureWebSession();
      const native = await readNativeCart(c).catch(() => null);
      if (native && native.lines.length > 0) {
        setCartCount(native.lines.length);
        return;
      }
      const [regular, quick] = await Promise.all([
        readCart(c, 'regular').catch(() => null),
        readCart(c, 'quick').catch(() => null),
      ]);
      setCartCount((regular?.lines.length ?? 0) + (quick?.lines.length ?? 0));
    } catch {
      /* best-effort badge */
    }
  }, [client, creds.email, creds.password]);

  useEffect(() => {
    if (active) refreshCartCount();
  }, [active, refreshCartCount]);

  const isFavorite = (id: number) => prefs.favorites.some((f) => f.id === id);

  function toggleFav(item: CatalogItem) {
    persist(toggleFavorite(prefs, item));
  }

  function urlFor(item: CatalogItem): string {
    return item.isAttraction
      ? `https://www.htzone.co.il/wallet_attraction_item/${item.id}`
      : `https://www.htzone.co.il/item/${item.id}/`;
  }

  async function openCategory(section: CatalogSection) {
    setView('category');
    top();
    setSort('relevance');
    setFiltersOpen(false);
    setCatError(null);
    setCategory({ id: section.categoryId, title: section.title, items: section.items });
    if (section.categoryId <= 0) return;
    setCatBusy(true);
    try {
      const items = await readCategory(client(), section.categoryId);
      if (items.length) setCategory({ id: section.categoryId, title: section.title, items });
    } catch (e: any) {
      setCatError(e?.message ?? String(e));
    } finally {
      setCatBusy(false);
    }
  }

  async function runSearch(term: string) {
    const t = term.trim();
    if (!t) return;
    setView('search');
    top();
    setSearchTerm(t);
    setQuery(t);
    setSort('relevance');
    setFiltersOpen(false);
    setResults(null);
    setSearchError(null);
    setSearchBusy(true);
    persist(withSearch(prefs, t));
    try {
      const items = await searchCatalog(client(), t);
      setResults(items);
      if (!items.length) setSearchError('No products matched that search.');
    } catch (e: any) {
      setSearchError(e?.message ?? String(e));
    } finally {
      setSearchBusy(false);
    }
  }

  async function resolveVariants(d: ProductDetail): Promise<ProductRef['variants']> {
    if (d.variants.length) {
      setVariants(d.variants);
      const inStock = d.variants.filter((v) => v.inStock !== false);
      setVariantId(inStock.length === 1 ? inStock[0].id : null);
      return d.variants;
    }
    try {
      const ref = await readProductWebview(client(), String(d.id), d.isAttraction ? 'quick' : 'regular');
      setCartKind(ref.kind);
      let vs = ref.variants;
      if (!vs.length && d.collectedId) {
        vs = [{ id: d.collectedId, price: d.price, label: d.title, inStock: true }];
      }
      setVariants(vs);
      const inStock = vs.filter((v) => v.inStock !== false);
      setVariantId(inStock.length === 1 ? inStock[0].id : null);
      return vs;
    } catch {
      if (d.collectedId) {
        const vs = [{ id: d.collectedId, price: d.price, label: d.title, inStock: true }];
        setVariants(vs);
        setVariantId(d.collectedId);
        return vs;
      }
      return [];
    }
  }

  async function openProduct(item: CatalogItem) {
    if (view !== 'product') originRef.current = view;
    setView('product');
    top();
    setDetail(null);
    setDetailError(null);
    setDetailBusy(true);
    setVariants([]);
    setVariantId(null);
    setQty(1);
    setMessage(null);
    setAdded(false);
    setComments(null);
    setSimilar([]);
    setCartKind(item.isAttraction ? 'quick' : 'regular');
    persist(withRecent(prefs, item));

    const c = client();
    try {
      const d = await readDetail(c, item);
      setDetail(d);
      setDetailBusy(false);
      setCartKind(d.itemUrl.includes('wallet_attraction_item') || item.isAttraction ? 'quick' : 'regular');
      readMoreProducts(c, item).then((items) => setSimilar(items.slice(0, 12))).catch(() => {});
      readComments(c, item).then(setComments).catch(() => {});
      await resolveVariants(d);
    } catch (e: any) {
      setDetailError(e?.message ?? String(e));
      setDetailBusy(false);
    }
  }

  function backHome() {
    originRef.current = 'home';
    setView('home');
    top();
    setDetail(null);
    setCategory(null);
    setResults(null);
    setMessage(null);
  }

  function backToBrowse() {
    if (view === 'product') {
      setDetail(null);
      setView(originRef.current);
      top();
      return;
    }
    backHome();
  }

  async function addCurrent() {
    if (!detail || addLock.current) return;
    if (!creds.email.trim() || !creds.password) {
      setAccountOpen(true);
      setMessage('Enter the account email and password above, then add again.');
      return;
    }
    if (detail.stockEmpty || detail.stock === 0) {
      setMessage('This product is out of stock.');
      return;
    }
    if (!detail.canBuy) {
      setMessage('This item is a lead/quote — it cannot be added to the cart.');
      return;
    }
    addLock.current = true;
    setAddBusy(true);
    setMessage(null);
    setAdded(false);
    try {
      const c = client();

      const available = variants.filter((v) => v.inStock !== false);
      if (available.length > 1 && !variantId) {
        setMessage('Choose a model above first.');
        return;
      }

      const res = await addToCart(c, {
        kind: cartKind,
        id: detail.id,
        qty,
        variantId: variantId ?? undefined,
        itemType: detail.typeId,
      });
      if (!res.ok) {
        setMessage(addErrorText(res));
        return;
      }

      const verdict = await verifyAddedItem(c, cartKind, detail.id, variantId ?? undefined);
      if (!verdict.ok) {
        setMessage('The store did not keep this item: ' + verdict.error);
        return;
      }

      const sum = await readCart(c, cartKind).catch(() => null);
      const native = await readNativeCart(c).catch(() => null);
      setAdded(true);
      setMessage(
        `Added to the ${cartKind} cart` +
          (native ? ` · app cart ${native.lines.length} line(s)` : '') +
          (sum ? ` · web cart ${sum.lines.length} line(s)` : ''),
      );
      refreshCartCount();
    } catch (e: any) {
      setMessage('Could not add: ' + (e?.message ?? String(e)));
    } finally {
      setAddBusy(false);
      addLock.current = false;
    }
  }

  async function quickAdd(item: CatalogItem) {
    if (!item.canBuy) {
      showToast('Not available to buy');
      return;
    }
    if (item.stockEmpty) {
      showToast('Out of stock');
      return;
    }
    if (!creds.email.trim() || !creds.password) {
      setAccountOpen(true);
      showToast('Add the account email and password first');
      return;
    }
    if (quickLocks.current.has(item.id)) return;
    quickLocks.current.add(item.id);
    setQuickBusyId(item.id);
    try {
      const c = client();

      let vs: ProductRef['variants'] = [];
      try {
        vs = await readNativeVariants(c, item);
      } catch {
        vs = [];
      }
      if (!vs.length) {
        try {
          const ref = await readProductWebview(c, String(item.id), item.isAttraction ? 'quick' : 'regular');
          vs = ref.variants;
        } catch {
          vs = [];
        }
      }
      if (!vs.length && item.collectedId) {
        vs = [{ id: item.collectedId, price: item.price, label: item.title, inStock: true }];
      }
      const inStock = vs.filter((v) => v.inStock !== false);
      const kind = item.isAttraction ? 'quick' : 'regular';

      if (inStock.length > 1) {
        setQuickBusyId(null);
        await openProduct(item);
        setMessage('Choose a model above first.');
        return;
      }

      const res = await addToCart(c, {
        kind,
        id: item.id,
        qty: 1,
        variantId: inStock[0]?.id,
        itemType: item.typeId,
      });
      if (!res.ok) {
        showToast(addErrorText(res));
        return;
      }
      const verdict = await verifyAddedItem(c, kind, item.id, inStock[0]?.id);
      if (!verdict.ok) {
        showToast(verdict.error ?? 'Item was not kept');
        return;
      }
      const native = await readNativeCart(c).catch(() => null);
      showToast(`Added to cart${native ? ` · ${native.lines.length} line(s)` : ''}`);
      refreshCartCount();
    } catch (e: any) {
      showToast('Could not add: ' + (e?.message ?? String(e)));
    } finally {
      quickLocks.current.delete(item.id);
      setQuickBusyId(null);
    }
  }

  async function shareItem(item: CatalogItem) {
    const url = urlFor(item);
    try {
      await Share.share({ message: `${item.title}\n${url}`, url });
    } catch {
      /* dismissed */
    }
  }

  async function copyItem(item: CatalogItem) {
    try {
      await Clipboard.setStringAsync(urlFor(item));
      showToast('Link copied');
    } catch {
      showToast('Could not copy the link');
    }
  }

  const min = Number(minPrice.replace(/[^\d]/g, '')) || undefined;
  const max = Number(maxPrice.replace(/[^\d]/g, '')) || undefined;
  const browse = (items: CatalogItem[]) =>
    sortItems(filterItems(items, { min, max, inStockOnly }), sort);

  const favoriteApi = {
    onToggleFavorite: toggleFav,
    isFavorite,
    onQuickAdd: quickAdd,
    quickBusyId,
    onOpenProduct: openProduct,
  };
  const filterApi = {
    sort,
    setSort,
    filtersOpen,
    setFiltersOpen,
    inStockOnly,
    setInStockOnly,
    minPrice,
    setMinPrice,
    maxPrice,
    setMaxPrice,
  };

  const title =
    view === 'category'
      ? category?.title
      : view === 'search'
      ? 'Search'
      : view === 'favorites'
      ? 'Favourites'
      : 'Shop';

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 96 : 0}
    >
      <View style={styles.flex}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            view === 'home' ? (
              <RefreshControl refreshing={homeBusy} onRefresh={loadHome} tintColor={theme.accent} />
            ) : undefined
          }
        >
          {view === 'product' && detail ? (
            <ProductPage
              detail={detail}
              busy={detailBusy}
              error={detailError}
              variants={variants}
              variantId={variantId}
              setVariantId={setVariantId}
              qty={qty}
              setQty={setQty}
              addBusy={addBusy}
              message={message}
              added={added}
              favorite={isFavorite(detail.id)}
              comments={comments}
              similar={similar}
              cartKind={cartKind}
              onBack={backToBrowse}
              onAdd={addCurrent}
              onOpenCart={onOpenCart}
              onToggleFavorite={() => toggleFav(detail)}
              onShare={() => shareItem(detail)}
              onCopy={() => copyItem(detail)}
              onOpenProduct={openProduct}
              onQuickAdd={quickAdd}
              quickBusyId={quickBusyId}
            />
          ) : view === 'product' ? (
            <View style={styles.loading}>
              {detailBusy ? (
                <ActivityIndicator color={theme.accent} />
              ) : (
                <Text style={styles.hint}>Could not load this product. {detailError || ''}</Text>
              )}
              {!detailBusy && (
                <Pressable onPress={backToBrowse} style={styles.back} hitSlop={8}>
                  <Text style={styles.backText}>‹ Back</Text>
                </Pressable>
              )}
            </View>
          ) : (
            <>
              <View style={styles.header}>
                <View style={{ flex: 1 }}>
                  {view !== 'home' && (
                    <Pressable onPress={backToBrowse} style={styles.back} hitSlop={8}>
                      <Text style={styles.backText}>‹ Back</Text>
                    </Pressable>
                  )}
                  <Text style={styles.h1}>{title}</Text>
                  <Text style={styles.sub}>
                    {view === 'home'
                      ? 'Native catalogue · prices and stock from the store'
                      : view === 'favorites'
                      ? 'Saved on this device'
                      : 'Native catalogue'}
                  </Text>
                </View>
                {!!onOpenCart && (
                  <Pressable onPress={onOpenCart} style={({ pressed }) => [styles.cartBtn, pressed && { opacity: 0.85 }]}>
                    <Text style={styles.cartBtnText}>Cart</Text>
                    {cartCount > 0 && (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{cartCount}</Text>
                      </View>
                    )}
                  </Pressable>
                )}
              </View>

              {creds.email.trim() ? (
                <Pressable onPress={() => setAccountOpen(true)} style={({ pressed }) => [styles.accountBar, pressed && { opacity: 0.8 }]}>
                  <Text style={styles.accountBarText} numberOfLines={1}>
                    Signed in as {creds.email.trim()}
                  </Text>
                  <Text style={styles.accountBarEdit}>change</Text>
                </Pressable>
              ) : (
                <View style={styles.accountCard}>
                  <Text style={styles.accountTitle}>No account</Text>
                  <Text style={styles.hint}>Pick or add one in Settings — the account bar above switches between them.</Text>
                </View>
              )}
              {accountOpen && creds.email.trim() ? (
                <View style={styles.accountCard}>
                  <Text style={styles.accountTitle}>Account</Text>
                  <Text style={styles.hint}>Switch accounts from the bar at the top of the app, or manage them in Settings.</Text>
                  <Pressable onPress={() => setAccountOpen(false)} style={styles.accountDone}>
                    <Text style={styles.accountDoneText}>Done</Text>
                  </Pressable>
                </View>
              ) : null}

              {view === 'home' && (
                <HomeView
                  home={home}
                  busy={homeBusy}
                  error={homeError}
                  popular={popular}
                  recent={prefs.recent}
                  favorites={prefs.favorites}
                  query={query}
                  setQuery={setQuery}
                  onSearch={runSearch}
                  onOpenCategory={openCategory}
                  onOpenFavorites={() => {
                    setView('favorites');
                    top();
                  }}
                  onRetry={loadHome}
                  {...favoriteApi}
                />
              )}

              {view === 'category' && category && (
                <BrowseView
                  title={category.title}
                  subtitle="Native category feed"
                  items={browse(category.items)}
                  total={category.items.length}
                  busy={catBusy}
                  error={catError}
                  emptyText="No products matched these filters."
                  {...filterApi}
                  {...favoriteApi}
                />
              )}

              {view === 'search' && (
                <SearchView
                  query={query}
                  setQuery={setQuery}
                  searchTerm={searchTerm}
                  results={results ? browse(results) : null}
                  total={results?.length ?? 0}
                  busy={searchBusy}
                  error={searchError}
                  history={prefs.searches}
                  popular={popular}
                  onSearch={runSearch}
                  onClearHistory={() => persist({ ...prefs, searches: [] })}
                  {...filterApi}
                  {...favoriteApi}
                />
              )}

              {view === 'favorites' && (
                <FavoritesView
                  favorites={prefs.favorites}
                  onOpenProduct={openProduct}
                  onToggleFavorite={toggleFav}
                  onQuickAdd={quickAdd}
                  quickBusyId={quickBusyId}
                />
              )}
            </>
          )}
        </ScrollView>

        {!!toast && (
          <Pressable onPress={() => setToast(null)} style={styles.toast}>
            <Text style={styles.toastText}>{toast}</Text>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: theme.pad, paddingBottom: 48 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 6 },
  h1: { color: theme.text, fontSize: 24, fontWeight: '800' },
  sub: { color: theme.dim, fontSize: 12, marginTop: 4 },
  back: { alignSelf: 'flex-start', paddingVertical: 2, marginBottom: 4 },
  backText: { color: theme.accent, fontSize: 14, fontWeight: '700' },
  cartBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: theme.card,
  },
  cartBtnText: { color: theme.text, fontSize: 13, fontWeight: '700' },
  badge: { backgroundColor: theme.accent, borderRadius: 999, minWidth: 20, paddingHorizontal: 5, paddingVertical: 1, alignItems: 'center' },
  badgeText: { color: '#fff', fontSize: 10.5, fontWeight: '800' },
  accountCard: {
    marginTop: 14,
    backgroundColor: theme.card,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    padding: 12,
  },
  accountTitle: { color: theme.text, fontSize: 14.5, fontWeight: '700', marginBottom: 4 },
  accountDone: { marginTop: 10, alignSelf: 'flex-start', borderColor: theme.accent, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  accountDoneText: { color: theme.accent, fontSize: 12, fontWeight: '700' },
  accountBar: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: theme.card,
  },
  accountBarText: { color: theme.dim, fontSize: 11.5, flex: 1 },
  accountBarEdit: { color: theme.accent, fontSize: 11.5, fontWeight: '700' },
  hint: { color: theme.dim, fontSize: 12, lineHeight: 18 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 30 },
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 18,
    backgroundColor: theme.cardAlt,
    borderColor: theme.accent,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  toastText: { color: theme.text, fontSize: 13, textAlign: 'center' },
});
