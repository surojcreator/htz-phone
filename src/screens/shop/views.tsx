import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { CatalogItem, CatalogSection, SortMode, SORTS } from '../../core/catalog';
import { SavedProduct } from '../../core/prefs';
import { theme } from '../../ui/theme';
import { ProductCard } from './ProductCard';

export type FavoriteApi = {
  onToggleFavorite: (item: CatalogItem) => void;
  isFavorite: (id: number) => boolean;
  onQuickAdd: (item: CatalogItem) => void;
  quickBusyId: number | null;
  onOpenProduct: (item: CatalogItem) => void;
};

export type FilterApi = {
  sort: SortMode;
  setSort: (s: SortMode) => void;
  filtersOpen: boolean;
  setFiltersOpen: (v: boolean) => void;
  inStockOnly: boolean;
  setInStockOnly: (v: boolean) => void;
  minPrice: string;
  setMinPrice: (v: string) => void;
  maxPrice: string;
  setMaxPrice: (v: string) => void;
};

export function toCatalogItem(s: SavedProduct): CatalogItem {
  return {
    id: s.id,
    title: s.title,
    subtitle: s.subtitle,
    price: s.price,
    fullPrice: 0,
    htzPrice: 0,
    image: s.image,
    brand: '',
    rating: 0,
    reviews: 0,
    typeId: s.typeId,
    productType: 0,
    stockEmpty: false,
    priceStartsFrom: false,
    isAttraction: false,
    collectedId: 0,
    canBuy: true,
    categoryId: 0,
    categoryPath: [],
    raw: {},
  };
}

export function SearchBar(props: {
  value: string;
  setValue: (v: string) => void;
  onSubmit: () => void;
  busy?: boolean;
  placeholder?: string;
}) {
  return (
    <View style={styles.searchBar}>
      <View style={styles.searchInputWrap}>
        <TextInput
          value={props.value}
          onChangeText={props.setValue}
          onSubmitEditing={props.onSubmit}
          placeholder={props.placeholder ?? 'Search the whole store…'}
          placeholderTextColor={theme.dim}
          returnKeyType="search"
          style={styles.searchInput}
          autoCorrect={false}
        />
        {!!props.value && (
          <Pressable onPress={() => props.setValue('')} style={styles.searchClear} hitSlop={8} accessibilityLabel="Clear search">
            <Text style={styles.searchClearText}>✕</Text>
          </Pressable>
        )}
      </View>
      <Pressable
        onPress={props.onSubmit}
        disabled={props.busy || !props.value.trim()}
        style={({ pressed }) => [styles.searchBtn, (props.busy || !props.value.trim()) && styles.dim, pressed && { opacity: 0.85 }]}
      >
        {props.busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.searchBtnText}>Search</Text>}
      </Pressable>
    </View>
  );
}

export function Chips(props: { items: string[]; onPress: (t: string) => void; label?: string; onClear?: () => void }) {
  if (!props.items.length) return null;
  return (
    <View style={styles.chipsBlock}>
      {!!props.label && (
        <View style={styles.chipsHead}>
          <Text style={styles.chipsLabel}>{props.label}</Text>
          {!!props.onClear && (
            <Pressable onPress={props.onClear} hitSlop={6}>
              <Text style={styles.chipsClear}>Clear</Text>
            </Pressable>
          )}
        </View>
      )}
      <View style={styles.chips}>
        {props.items.map((t) => (
          <Pressable key={t} onPress={() => props.onPress(t)} style={({ pressed }) => [styles.chip, pressed && { opacity: 0.8 }]}>
            <Text style={styles.chipText}>{t}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function FilterBar(props: FilterApi & { total: number; shown?: number }) {
  return (
    <View style={styles.filterBlock}>
      <View style={styles.filterHead}>
        <Text style={styles.count}>
          {props.shown != null && props.shown !== props.total
            ? `${props.shown} of ${props.total} product(s)`
            : `${props.total} product(s)`}
        </Text>
        <Pressable onPress={() => props.setFiltersOpen(!props.filtersOpen)} style={({ pressed }) => [styles.ghostSmall, pressed && { opacity: 0.8 }]}>
          <Text style={styles.ghostSmallText}>{props.filtersOpen ? 'Hide filters' : 'Filters'}</Text>
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sortRow}>
        {SORTS.map((s) => (
          <Pressable
            key={s.id}
            onPress={() => props.setSort(s.id)}
            style={[styles.sortChip, props.sort === s.id && styles.sortChipActive]}
          >
            <Text style={[styles.sortText, props.sort === s.id && styles.sortTextActive]}>{s.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {props.filtersOpen && (
        <View style={styles.filterPanel}>
          <View style={styles.switchRow}>
            <Text style={styles.filterLabel}>In stock only</Text>
            <Switch
              value={props.inStockOnly}
              onValueChange={props.setInStockOnly}
              trackColor={{ true: theme.accent, false: theme.border }}
              thumbColor="#fff"
            />
          </View>
          <View style={styles.priceInputs}>
            <TextInput
              value={props.minPrice}
              onChangeText={props.setMinPrice}
              placeholder="min ₪"
              placeholderTextColor={theme.dim}
              keyboardType="number-pad"
              style={styles.priceInput}
            />
            <Text style={styles.dash}>—</Text>
            <TextInput
              value={props.maxPrice}
              onChangeText={props.setMaxPrice}
              placeholder="max ₪"
              placeholderTextColor={theme.dim}
              keyboardType="number-pad"
              style={styles.priceInput}
            />
          </View>
          <Pressable
            onPress={() => {
              props.setMinPrice('');
              props.setMaxPrice('');
              props.setInStockOnly(false);
              props.setSort('relevance');
            }}
            style={({ pressed }) => [styles.clearFilters, pressed && { opacity: 0.8 }]}
          >
            <Text style={styles.clearFiltersText}>Clear filters</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

export function Grid(props: { items: CatalogItem[] } & FavoriteApi) {
  return (
    <View style={styles.grid}>
      {props.items.map((item) => (
        <ProductCard
          key={item.id}
          item={item}
          width="48%"
          onPress={() => props.onOpenProduct(item)}
          onToggleFavorite={() => props.onToggleFavorite(item)}
          favorite={props.isFavorite(item.id)}
          onQuickAdd={() => props.onQuickAdd(item)}
          quickBusy={props.quickBusyId === item.id}
        />
      ))}
    </View>
  );
}

export function HomeView(
  props: {
    home: CatalogSection[];
    busy: boolean;
    error: string | null;
    popular: string[];
    recent: SavedProduct[];
    favorites: SavedProduct[];
    query: string;
    setQuery: (v: string) => void;
    onSearch: (term: string) => void;
    onOpenCategory: (s: CatalogSection) => void;
    onOpenFavorites: () => void;
    onRetry: () => void;
  } & FavoriteApi,
) {
  return (
    <>
      <SearchBar value={props.query} setValue={props.setQuery} onSubmit={() => props.onSearch(props.query)} />

      {props.busy && props.home.length === 0 && <Skeletons />}
      {!!props.error && (
        <View style={styles.card}>
          <Text style={styles.error}>Could not load the catalogue: {props.error}</Text>
          <Pressable onPress={props.onRetry} style={styles.retry}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}

      {props.favorites.length > 0 && (
        <Pressable onPress={props.onOpenFavorites} style={({ pressed }) => [styles.favBar, pressed && { opacity: 0.85 }]}>
          <Text style={styles.favBarText}>♥ Favourites</Text>
          <Text style={styles.favBarCount}>{props.favorites.length}</Text>
        </Pressable>
      )}

      {props.recent.length > 0 && (
        <SectionRow
          title="Recently viewed"
          items={props.recent.map(toCatalogItem)}
          {...props}
        />
      )}

      {props.popular.length > 0 && <Chips label="Trending" items={props.popular} onPress={props.onSearch} />}

      {props.home.map((section) => (
        <View key={section.key} style={styles.sectionBlock}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {section.categoryId > 0 && (
              <Pressable onPress={() => props.onOpenCategory(section)} style={({ pressed }) => [styles.ghostSmall, pressed && { opacity: 0.8 }]}>
                <Text style={styles.ghostSmallText}>See all</Text>
              </Pressable>
            )}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowScroll}>
            {section.items.map((item) => (
              <ProductCard
                key={item.id}
                item={item}
                onPress={() => props.onOpenProduct(item)}
                onToggleFavorite={() => props.onToggleFavorite(item)}
                favorite={props.isFavorite(item.id)}
                onQuickAdd={() => props.onQuickAdd(item)}
                quickBusy={props.quickBusyId === item.id}
              />
            ))}
          </ScrollView>
        </View>
      ))}
    </>
  );
}

function SectionRow(props: { title: string; items: CatalogItem[] } & FavoriteApi) {
  return (
    <View style={styles.sectionBlock}>
      <Text style={styles.sectionTitle}>{props.title}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowScroll}>
        {props.items.map((item) => (
          <ProductCard
            key={item.id}
            item={item}
            compact
            onPress={() => props.onOpenProduct(item)}
            onToggleFavorite={() => props.onToggleFavorite(item)}
            favorite={props.isFavorite(item.id)}
            onQuickAdd={() => props.onQuickAdd(item)}
            quickBusy={props.quickBusyId === item.id}
          />
        ))}
      </ScrollView>
    </View>
  );
}

export function BrowseView(
  props: {
    title: string;
    subtitle?: string;
    items: CatalogItem[];
    total: number;
    busy: boolean;
    error: string | null;
    emptyText: string;
  } & FilterApi &
    FavoriteApi,
) {
  return (
    <>
      <Text style={styles.sectionBig}>{props.title}</Text>
      {!!props.subtitle && <Text style={styles.subText}>{props.subtitle}</Text>}
      <FilterBar {...props} total={props.total} shown={props.items.length} />
      {props.busy && props.items.length === 0 && <Skeletons />}
      {!!props.error && <Text style={styles.error}>{props.error}</Text>}
      {!props.busy && props.items.length === 0 && <Empty text={props.emptyText} />}
      <Grid {...props} />
    </>
  );
}

export function SearchView(
  props: {
    query: string;
    setQuery: (v: string) => void;
    searchTerm: string;
    results: CatalogItem[] | null;
    total: number;
    busy: boolean;
    error: string | null;
    history: string[];
    popular: string[];
    onSearch: (term: string) => void;
    onClearHistory: () => void;
  } & FilterApi &
    FavoriteApi,
) {
  const showSuggestions = !props.results && !props.busy;
  return (
    <>
      <SearchBar value={props.query} setValue={props.setQuery} onSubmit={() => props.onSearch(props.query)} busy={props.busy} />
      {showSuggestions && (
        <>
          {props.history.length > 0 && (
            <Chips label="Recent searches" items={props.history} onPress={props.onSearch} onClear={props.onClearHistory} />
          )}
          {props.popular.length > 0 && <Chips label="Trending" items={props.popular} onPress={props.onSearch} />}
        </>
      )}
      {!!props.error && <Text style={styles.error}>{props.error}</Text>}
      {props.results && <FilterBar {...props} total={props.total} shown={props.results.length} />}
      {props.total >= 100 && (
        <Text style={styles.searchCap}>The store returns up to 100 results per search — showing the first 100.</Text>
      )}
      {props.busy && <Skeletons />}
      {props.results && props.results.length > 0 && <Grid items={props.results} {...props} />}
      {props.results && props.results.length === 0 && !props.busy && (
        <Empty text={`Nothing matched “${props.searchTerm}”.`} />
      )}
    </>
  );
}

export function FavoritesView(
  props: {
    favorites: SavedProduct[];
    onOpenProduct: (i: CatalogItem) => void;
    onToggleFavorite: (i: CatalogItem) => void;
    onQuickAdd: (i: CatalogItem) => void;
    quickBusyId: number | null;
  },
) {
  const items = props.favorites.map(toCatalogItem);
  return (
    <>
      <Text style={styles.sectionBig}>Favourites</Text>
      <Text style={styles.subText}>{items.length} saved on this device</Text>
      {items.length === 0 ? (
        <Empty text="Tap the heart on any product to save it here." />
      ) : (
        <Grid
          items={items}
          onOpenProduct={props.onOpenProduct}
          onToggleFavorite={props.onToggleFavorite}
          isFavorite={() => true}
          onQuickAdd={props.onQuickAdd}
          quickBusyId={props.quickBusyId}
        />
      )}
    </>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

function Skeletons() {
  return (
    <View style={styles.grid}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={styles.skeleton}>
          <View style={styles.skelImg} />
          <View style={styles.skelLine} />
          <View style={[styles.skelLine, { width: '55%' }]} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  searchBar: { flexDirection: 'row', gap: 8, marginTop: 12 },
  searchInputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  searchInput: {
    flex: 1,
    backgroundColor: theme.card,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    color: theme.text,
    paddingHorizontal: 13,
    paddingVertical: 12,
    paddingRight: 34,
    fontSize: 14,
  },
  searchClear: {
    position: 'absolute',
    right: 10,
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchClearText: { color: theme.dim, fontSize: 13, fontWeight: '700' },
  searchBtn: {
    backgroundColor: theme.accent,
    borderRadius: theme.radius,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchBtnText: { color: '#fff', fontSize: 13.5, fontWeight: '700' },
  dim: { opacity: 0.45 },
  chipsBlock: { marginTop: 16 },
  chipsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chipsClear: { color: theme.accent, fontSize: 11, fontWeight: '700' },
  chipsLabel: { color: theme.dim, fontSize: 11.5, marginBottom: 8, letterSpacing: 0.4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 7,
    backgroundColor: theme.card,
  },
  chipText: { color: theme.text, fontSize: 12.5 },
  favBar: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.card,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  favBarText: { color: theme.text, fontSize: 14, fontWeight: '700' },
  favBarCount: { color: theme.bad, fontSize: 14, fontWeight: '800' },
  sectionBlock: { marginTop: 22 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sectionTitle: { color: theme.text, fontSize: 16, fontWeight: '700' },
  sectionBig: { color: theme.text, fontSize: 22, fontWeight: '800', marginTop: 16 },
  subText: { color: theme.dim, fontSize: 12.5, marginTop: 5 },
  rowScroll: { gap: 10, paddingRight: 8, paddingVertical: 2 },
  ghostSmall: { borderColor: theme.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  ghostSmallText: { color: theme.dim, fontSize: 11, fontWeight: '700' },
  filterBlock: { marginTop: 16 },
  filterHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  count: { color: theme.dim, fontSize: 12 },
  sortRow: { gap: 8, paddingVertical: 10 },
  sortChip: {
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: theme.card,
  },
  sortChipActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  sortText: { color: theme.dim, fontSize: 12, fontWeight: '600' },
  sortTextActive: { color: '#fff' },
  filterPanel: {
    backgroundColor: theme.card,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    padding: 12,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  filterLabel: { color: theme.text, fontSize: 13 },
  priceInputs: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  priceInput: {
    flex: 1,
    backgroundColor: theme.cardAlt,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 10,
    color: theme.text,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 13,
  },
  dash: { color: theme.dim, fontSize: 13 },
  clearFilters: { marginTop: 12, alignSelf: 'flex-start' },
  clearFiltersText: { color: theme.accent, fontSize: 12, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10, marginTop: 12 },
  error: { color: theme.bad, fontSize: 12.5, marginTop: 10, lineHeight: 18 },
  searchCap: { color: theme.warn, fontSize: 11.5, marginTop: 8, lineHeight: 16 },
  retry: { marginTop: 10, alignSelf: 'flex-start', borderColor: theme.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  retryText: { color: theme.dim, fontSize: 12, fontWeight: '700' },
  card: { marginTop: 14, backgroundColor: theme.card, borderColor: theme.border, borderWidth: 1, borderRadius: theme.radius, padding: 12 },
  empty: { marginTop: 22, alignItems: 'center', paddingVertical: 28 },
  emptyText: { color: theme.dim, fontSize: 13, textAlign: 'center' },
  skeleton: {
    width: '48%',
    backgroundColor: theme.card,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    padding: 10,
  },
  skelImg: { height: 96, borderRadius: 8, backgroundColor: theme.cardAlt },
  skelLine: { height: 10, borderRadius: 5, backgroundColor: theme.cardAlt, marginTop: 8, width: '85%' },
});
