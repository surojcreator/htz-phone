import React from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { CatalogItem, formatILS } from '../../core/catalog';
import { theme } from '../../ui/theme';

type Props = {
  item: CatalogItem;
  onPress: () => void;
  onToggleFavorite?: () => void;
  favorite?: boolean;
  onQuickAdd?: () => void;
  quickBusy?: boolean;
  width?: number | `${number}%`;
  compact?: boolean;
};

function ProductCardInner({
  item,
  onPress,
  onToggleFavorite,
  favorite,
  onQuickAdd,
  quickBusy,
  width,
  compact,
}: Props) {
  const imageHeight = compact ? 82 : 106;
  return (
    <View style={[styles.card, { width: width ?? 152 }, compact && styles.cardCompact]}>
      <Pressable onPress={onPress} style={({ pressed }) => [pressed && { opacity: 0.9 }]}>
        {item.image ? (
          <Image source={{ uri: item.image }} style={[styles.image, { height: imageHeight }]} resizeMode="contain" />
        ) : (
          <View style={[styles.image, styles.noImage, { height: imageHeight }]}>
            <Text style={styles.noImageText}>{item.title.slice(0, 1)}</Text>
          </View>
        )}

        <Text style={styles.title} numberOfLines={2}>
          {item.title}
        </Text>
        {!!item.subtitle && (
          <Text style={styles.subtitle} numberOfLines={1}>
            {item.subtitle}
          </Text>
        )}

        <View style={styles.priceRow}>
          <Text style={styles.price}>
            {item.priceStartsFrom ? 'from ' : ''}
            {formatILS(item.price)}
          </Text>
          {item.fullPrice > item.price && <Text style={styles.full}>{formatILS(item.fullPrice)}</Text>}
        </View>

        {item.rating > 0 && (
          <Text style={styles.rating} numberOfLines={1}>
            ★ {item.rating.toFixed(1)}
            {item.reviews ? ` · ${item.reviews}` : ''}
          </Text>
        )}
        {item.stockEmpty && <Text style={styles.out}>Check availability</Text>}
      </Pressable>

      {onToggleFavorite && (
        <Pressable
          onPress={onToggleFavorite}
          style={styles.heart}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={favorite ? 'Remove from favourites' : 'Add to favourites'}
        >
          <Text style={[styles.heartText, favorite && { color: theme.bad }]}>{favorite ? '♥' : '♡'}</Text>
        </Pressable>
      )}

      {onQuickAdd && !item.stockEmpty && item.canBuy && (
        <Pressable
          onPress={onQuickAdd}
          disabled={quickBusy}
          style={({ pressed }) => [styles.quick, pressed && { opacity: 0.8 }, quickBusy && { opacity: 0.6 }]}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Add to cart"
        >
          {quickBusy ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.quickText}>+</Text>
          )}
        </Pressable>
      )}
    </View>
  );
}

export const ProductCard = React.memo(ProductCardInner);

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.card,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    padding: 10,
    overflow: 'hidden',
  },
  cardCompact: { padding: 8 },
  image: {
    width: '100%',
    borderRadius: 8,
    marginBottom: 8,
    backgroundColor: '#fff',
  },
  noImage: { alignItems: 'center', justifyContent: 'center', backgroundColor: theme.cardAlt },
  noImageText: { color: theme.dim, fontSize: 30, fontWeight: '800' },
  title: { color: theme.text, fontSize: 12.5, fontWeight: '600', lineHeight: 17 },
  subtitle: { color: theme.dim, fontSize: 10.5, marginTop: 3 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 6, flexWrap: 'wrap' },
  price: { color: theme.text, fontSize: 14, fontWeight: '800' },
  full: { color: theme.dim, fontSize: 11, textDecorationLine: 'line-through' },
  rating: { color: theme.warn, fontSize: 10.5, marginTop: 4 },
  out: { color: theme.warn, fontSize: 10, marginTop: 4, fontWeight: '700' },
  heart: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(11,18,32,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heartText: { color: '#fff', fontSize: 16, lineHeight: 18 },
  quick: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickText: { color: '#fff', fontSize: 20, fontWeight: '700', lineHeight: 22, marginTop: -1 },
});
