import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { CatalogItem, formatILS, ProductDetail } from '../../core/catalog';
import { ProductRef } from '../../core/wallet';
import { theme } from '../../ui/theme';
import { ProductCard } from './ProductCard';

export type CommentsView = { rating: number; count: number; comments: { author: string; rating: number; text: string; date: string }[] };

type Props = {
  detail: ProductDetail;
  busy: boolean;
  error: string | null;
  variants: ProductRef['variants'];
  variantId: number | null;
  setVariantId: (id: number) => void;
  qty: number;
  setQty: (n: number) => void;
  addBusy: boolean;
  message: string | null;
  added: boolean;
  favorite: boolean;
  comments: CommentsView | null;
  similar: CatalogItem[];
  cartKind: 'regular' | 'quick';
  onBack: () => void;
  onAdd: () => void;
  onOpenCart?: () => void;
  onToggleFavorite: () => void;
  onShare: () => void;
  onCopy: () => void;
  onOpenProduct: (item: CatalogItem) => void;
  onQuickAdd: (item: CatalogItem) => void;
  quickBusyId?: number | null;
};

export function ProductPage(props: Props) {
  const { detail: d } = props;
  const { width } = useWindowDimensions();
  const galleryWidth = Math.max(240, width - theme.pad * 2);
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<Record<string, boolean>>({ description: true });

  const images = d.images.length ? d.images : d.image ? [d.image] : [];
  const out = d.stockEmpty || d.stock === 0 || !d.canBuy;
  const selectedVariant = props.variants.find((v) => v.id === props.variantId);
  const availableModels = props.variants.filter((v) => v.inStock !== false);
  const needsModel = availableModels.length > 1 && !props.variantId;
  const unitPrice = selectedVariant && selectedVariant.price > 0 ? selectedVariant.price : d.price;
  const stockForModel = selectedVariant?.stock ?? d.stock;
  const lowStock = stockForModel != null && stockForModel > 0 && stockForModel <= 10;
  const maxQty = Math.max(
    1,
    Math.min(999, selectedVariant?.max ?? d.maxPurchase ?? 999, stockForModel == null ? 999 : stockForModel || 1),
  );
  const toggle = (key: string) => setOpen((s) => ({ ...s, [key]: !s[key] }));

  // A lower-stock model can reduce the allowed quantity.
  useEffect(() => {
    if (props.qty > maxQty) props.setQty(maxQty);
  }, [maxQty, props.qty]);

  const onGalleryScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / galleryWidth);
    if (idx !== page) setPage(idx);
  };

  return (
    <View>
      <View style={styles.topBar}>
        <Pressable onPress={props.onBack} style={({ pressed }) => [styles.back, pressed && { opacity: 0.7 }]} hitSlop={8}>
          <Text style={styles.backText}>‹ Shop</Text>
        </Pressable>
        <View style={styles.topActions}>
          <Pressable onPress={props.onToggleFavorite} style={styles.iconBtn} hitSlop={6} accessibilityLabel="Favourite">
            <Text style={[styles.iconText, props.favorite && { color: theme.bad }]}>{props.favorite ? '♥' : '♡'}</Text>
          </Pressable>
          <Pressable onPress={props.onShare} style={styles.iconBtn} hitSlop={6} accessibilityLabel="Share">
            <Text style={styles.iconText}>⤴</Text>
          </Pressable>
          <Pressable onPress={props.onCopy} style={styles.iconBtn} hitSlop={6} accessibilityLabel="Copy link">
            <Text style={[styles.iconText, { fontSize: 15 }]}>⧉</Text>
          </Pressable>
        </View>
      </View>

      {images.length > 0 && (
        <View>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onGalleryScroll}
            style={{ width: galleryWidth, height: 280 }}
          >
            {images.map((uri, i) => (
              <View key={`${uri}-${i}`} style={{ width: galleryWidth, height: 280 }}>
                <Image source={{ uri }} style={styles.hero} resizeMode="contain" />
              </View>
            ))}
          </ScrollView>
          {images.length > 1 && (
            <View style={styles.dots}>
              {images.map((_, i) => (
                <View key={i} style={[styles.dot, i === page && styles.dotActive]} />
              ))}
            </View>
          )}
        </View>
      )}

      {d.savingsPct > 0 && (
        <View style={styles.saleBadge}>
          <Text style={styles.saleText}>−{d.savingsPct}%</Text>
        </View>
      )}

      {!!d.brand && <Text style={styles.brand}>{d.brand}</Text>}
      <Text style={styles.title}>{d.title}</Text>
      {!!d.subtitle && <Text style={styles.subtitle}>{d.subtitle}</Text>}
      {d.categoryPath.length > 0 && (
        <Text style={styles.crumbs} numberOfLines={2}>
          {d.categoryPath.slice(0, 3).join(' · ')}
        </Text>
      )}

      <View style={styles.priceBox}>
        <View style={styles.priceLine}>
          <Text style={styles.bigPrice}>{formatILS(unitPrice)}</Text>
          {d.fullPrice > unitPrice && <Text style={styles.strike}>{formatILS(d.fullPrice)}</Text>}
        </View>
        {d.htzPrice > 0 && d.htzPrice !== d.price && (
          <Text style={styles.htz}>{formatILS(d.htzPrice)} with the HTZ card</Text>
        )}
        {d.rating > 0 && (
          <Text style={styles.rating}>
            ★ {d.rating.toFixed(1)}
            {d.reviews ? ` · ${d.reviews} reviews` : ''}
          </Text>
        )}
        <View style={styles.stockRow}>
          {out ? (
            <Text style={styles.out}>
              {d.canBuy ? 'Out of stock' : 'This item is a lead/quote — the store does not sell it through the cart.'}
            </Text>
          ) : lowStock ? (
            <Text style={styles.low}>Only {stockForModel} left</Text>
          ) : (
            <Text style={styles.inStock}>In stock{stockForModel != null ? ` · ${stockForModel}` : ''}</Text>
          )}
          {!!d.maxPurchase && <Text style={styles.limit}>Limit {d.maxPurchase}</Text>}
          <Text style={styles.limit}>{props.cartKind === 'quick' ? 'Quick cart' : 'Regular cart'}</Text>
        </View>
        {!!d.limitNote && <Text style={styles.limitNote}>ℹ {d.limitNote}</Text>}
      </View>

      {props.busy && (
        <View style={styles.loading}>
          <ActivityIndicator color={theme.accent} />
          <Text style={styles.hint}>Loading product details…</Text>
        </View>
      )}
      {!!props.error && <Text style={styles.error}>Could not refresh the product: {props.error}</Text>}

      {props.variants.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Choose a model</Text>
          {props.variants.map((v) => {
            const disabled = v.inStock === false;
            const selected = props.variantId === v.id;
            return (
              <Pressable
                key={v.id}
                onPress={() => props.setVariantId(v.id)}
                disabled={disabled}
                style={[styles.option, selected && styles.optionActive, disabled && { opacity: 0.4 }]}
              >
                <Text style={[styles.optionText, selected && { color: theme.accent }]}>
                  {selected ? '● ' : '○ '}
                  {v.label || `model ${v.id}`}
                  {v.price > 0 && v.price !== d.price ? ` · ${formatILS(v.price)}` : ''}
                  {v.stock != null && v.stock > 0 && v.stock <= 5 ? ` · ${v.stock} left` : ''}
                  {disabled ? ' · out of stock' : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <View style={styles.buyCard}>
        <View style={styles.qtyRow}>
          <Text style={styles.label}>Quantity</Text>
          <View style={styles.stepper}>
            <Pressable
              onPress={() => props.setQty(Math.max(1, props.qty - 1))}
              style={[styles.stepBtn, props.qty <= 1 && { opacity: 0.4 }]}
              disabled={props.qty <= 1}
              hitSlop={8}
            >
              <Text style={styles.stepText}>−</Text>
            </Pressable>
            <TextInput
              value={String(props.qty)}
              onChangeText={(t) => {
                const n = parseInt(t.replace(/\D/g, ''), 10);
                if (Number.isFinite(n)) props.setQty(Math.max(1, Math.min(maxQty, n)));
              }}
              keyboardType="number-pad"
              selectTextOnFocus
              style={styles.qtyInput}
              accessibilityLabel="Quantity"
            />
            <Pressable
              onPress={() => props.setQty(Math.min(maxQty, props.qty + 1))}
              style={[styles.stepBtn, props.qty >= maxQty && { opacity: 0.4 }]}
              disabled={props.qty >= maxQty}
              hitSlop={8}
            >
              <Text style={styles.stepText}>+</Text>
            </Pressable>
            <Pressable
              onPress={() => props.setQty(maxQty)}
              style={[styles.maxBtn, props.qty >= maxQty && { opacity: 0.5 }]}
              hitSlop={6}
            >
              <Text style={styles.maxBtnText}>Max</Text>
            </Pressable>
          </View>
        </View>
        <Text style={styles.hint}>
          max {maxQty} per order · total {formatILS(unitPrice * props.qty)}
        </Text>

        {needsModel && <Text style={styles.modelHint}>Select a model above to continue.</Text>}

        <Pressable
          onPress={props.onAdd}
          disabled={props.addBusy || out || needsModel}
          style={({ pressed }) => [
            styles.addButton,
            (props.addBusy || out || needsModel) && styles.addDisabled,
            pressed && { opacity: 0.88 },
          ]}
        >
          {props.addBusy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.addText}>
              {out
                ? d.canBuy
                  ? 'Out of stock'
                  : 'Not available to buy'
                : needsModel
                ? 'Select a model'
                : `Add to cart · ${formatILS(unitPrice * props.qty)}`}
            </Text>
          )}
        </Pressable>

        {!!props.message && (
          <Text style={[styles.message, props.added ? { color: theme.ok } : { color: theme.warn }]}>{props.message}</Text>
        )}
        {props.added && !!props.onOpenCart && (
          <Pressable onPress={props.onOpenCart} style={({ pressed }) => [styles.openCart, pressed && { opacity: 0.85 }]}>
            <Text style={styles.openCartText}>View cart</Text>
          </Pressable>
        )}
      </View>

      <Section
        title="Description"
        open={!!open.description}
        onToggle={() => toggle('description')}
        text={d.description || 'No description for this product.'}
      />
      <Section
        title="Details"
        open={!!open.specs}
        onToggle={() => toggle('specs')}
        text={d.specs.join('\n\n') || 'No extra details.'}
      />
      <Section
        title="Warranty"
        open={!!open.warranty}
        onToggle={() => toggle('warranty')}
        text={d.warranty || 'No warranty information.'}
      />

      {d.delivery.length > 0 && (
        <View style={styles.card}>
          <Pressable onPress={() => toggle('delivery')} style={styles.accHead}>
            <Text style={styles.cardTitle}>Delivery · {d.delivery.length} option(s)</Text>
            <Text style={styles.chev}>{open.delivery ? '−' : '+'}</Text>
          </Pressable>
          {open.delivery &&
            d.delivery.slice(0, 10).map((o, i) => (
              <Text key={i} style={styles.body}>
                {o.title} · {o.price ? formatILS(o.price) : 'free'}
              </Text>
            ))}
        </View>
      )}

      {d.canUseObligo && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Wallet</Text>
          <Text style={styles.body}>{d.obligoText || 'This product can be paid from the wallet balance.'}</Text>
        </View>
      )}

      {props.comments && (props.comments.count > 0 || props.comments.comments.length > 0) && (
        <View style={styles.card}>
          <Pressable onPress={() => toggle('reviews')} style={styles.accHead}>
            <Text style={styles.cardTitle}>
              Reviews · {props.comments.count}
              {props.comments.rating > 0 ? ` · ★ ${props.comments.rating.toFixed(1)}` : ''}
            </Text>
            <Text style={styles.chev}>{open.reviews ? '−' : '+'}</Text>
          </Pressable>
          {open.reviews &&
            props.comments.comments.slice(0, 6).map((c, i) => (
              <View key={i} style={styles.review}>
                <Text style={styles.reviewHead}>
                  {c.author || 'Customer'} {c.rating ? `· ★ ${c.rating}` : ''} {c.date ? `· ${c.date}` : ''}
                </Text>
                <Text style={styles.body}>{c.text}</Text>
              </View>
            ))}
          {open.reviews && props.comments.comments.length === 0 && (
            <Text style={styles.body}>No written reviews yet.</Text>
          )}
        </View>
      )}

      {props.similar.length > 0 && (
        <View style={styles.similarBlock}>
          <Text style={styles.similarTitle}>You may also like</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowScroll}>
            {props.similar.map((item) => (
              <ProductCard
                key={item.id}
                item={item}
                compact
                onPress={() => props.onOpenProduct(item)}
                onQuickAdd={() => props.onQuickAdd(item)}
                quickBusy={props.quickBusyId === item.id}
              />
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

function Section(props: { title: string; open: boolean; onToggle: () => void; text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = props.text.length > 400;
  return (
    <View style={styles.card}>
      <Pressable onPress={props.onToggle} style={styles.accHead}>
        <Text style={styles.cardTitle}>{props.title}</Text>
        <Text style={styles.chev}>{props.open ? '−' : '+'}</Text>
      </Pressable>
      {props.open && (
        <>
          <Text style={styles.body} numberOfLines={long && !expanded ? 10 : undefined}>
            {props.text}
          </Text>
          {long && (
            <Pressable onPress={() => setExpanded((v) => !v)} style={styles.more} hitSlop={6}>
              <Text style={styles.moreText}>{expanded ? 'Show less' : 'Show more'}</Text>
            </Pressable>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  back: { paddingVertical: 4 },
  backText: { color: theme.accent, fontSize: 14.5, fontWeight: '700' },
  topActions: { flexDirection: 'row', gap: 6 },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderColor: theme.border,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.card,
  },
  iconText: { color: theme.text, fontSize: 18, lineHeight: 20 },
  hero: { width: '100%', height: '100%', backgroundColor: '#fff', borderRadius: theme.radius },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 8 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.border },
  dotActive: { backgroundColor: theme.accent, width: 16 },
  saleBadge: {
    position: 'absolute',
    top: 60,
    left: 6,
    backgroundColor: theme.bad,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  saleText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  brand: { color: theme.dim, fontSize: 11.5, marginTop: 14, letterSpacing: 0.6, textTransform: 'uppercase' },
  title: { color: theme.text, fontSize: 22, fontWeight: '800', marginTop: 4, lineHeight: 29 },
  subtitle: { color: theme.dim, fontSize: 13, marginTop: 4, lineHeight: 19 },
  crumbs: { color: theme.dim, fontSize: 11, marginTop: 6 },
  priceBox: {
    marginTop: 14,
    backgroundColor: theme.card,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    padding: 14,
  },
  priceLine: { flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' },
  bigPrice: { color: theme.text, fontSize: 30, fontWeight: '800' },
  strike: { color: theme.dim, fontSize: 14, textDecorationLine: 'line-through' },
  htz: { color: theme.accent, fontSize: 12, marginTop: 4, fontWeight: '700' },
  rating: { color: theme.warn, fontSize: 12.5, marginTop: 6 },
  stockRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  out: { color: theme.bad, fontSize: 12, fontWeight: '700' },
  low: { color: theme.warn, fontSize: 12, fontWeight: '700' },
  inStock: { color: theme.ok, fontSize: 12, fontWeight: '700' },
  limit: { color: theme.dim, fontSize: 11.5 },
  limitNote: { color: theme.dim, fontSize: 11, marginTop: 6 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  hint: { color: theme.dim, fontSize: 11, marginTop: 6 },
  error: { color: theme.bad, fontSize: 12, marginTop: 10 },
  card: {
    marginTop: 14,
    backgroundColor: theme.card,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    padding: 12,
  },
  cardTitle: { color: theme.text, fontSize: 14.5, fontWeight: '700' },
  option: {
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
  },
  optionActive: { borderColor: theme.accent, backgroundColor: theme.cardAlt },
  optionText: { color: theme.text, fontSize: 13 },
  buyCard: {
    marginTop: 16,
    backgroundColor: theme.cardAlt,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    padding: theme.pad,
  },
  qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { color: theme.dim, fontSize: 12, letterSpacing: 0.3 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepBtn: {
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 8,
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.card,
  },
  stepText: { color: theme.text, fontSize: 18, fontWeight: '700', lineHeight: 21 },
  qtyText: { color: theme.text, fontSize: 15, fontWeight: '700', minWidth: 28, textAlign: 'center' },
  qtyInput: {
    color: theme.text,
    fontSize: 15,
    fontWeight: '700',
    minWidth: 44,
    textAlign: 'center',
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  maxBtn: {
    marginLeft: 4,
    borderColor: theme.accent,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 9,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  maxBtnText: { color: theme.accent, fontSize: 12, fontWeight: '800' },
  addButton: {
    marginTop: 12,
    backgroundColor: theme.accent,
    borderRadius: theme.radius,
    paddingVertical: 15,
    alignItems: 'center',
  },
  addDisabled: { backgroundColor: '#27406b' },
  addText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  message: { fontSize: 12.5, marginTop: 10, lineHeight: 18 },
  modelHint: { color: theme.warn, fontSize: 12, marginTop: 8, fontWeight: '700' },
  openCart: {
    marginTop: 12,
    borderColor: theme.accent,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  openCartText: { color: theme.accent, fontSize: 14, fontWeight: '700' },
  accHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chev: { color: theme.dim, fontSize: 20, fontWeight: '700', lineHeight: 22 },
  body: { color: theme.dim, fontSize: 13, lineHeight: 20, marginTop: 8 },
  more: { marginTop: 8, alignSelf: 'flex-start' },
  moreText: { color: theme.accent, fontSize: 12, fontWeight: '700' },
  review: { marginTop: 10, borderTopColor: theme.border, borderTopWidth: 1, paddingTop: 8 },
  reviewHead: { color: theme.text, fontSize: 12, fontWeight: '700' },
  similarBlock: { marginTop: 20 },
  similarTitle: { color: theme.text, fontSize: 16, fontWeight: '700', marginBottom: 10 },
  rowScroll: { gap: 10, paddingRight: 8 },
});
