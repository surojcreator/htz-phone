import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import React, { useState } from 'react';
import { Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import HanukkaScreen from './src/screens/HanukkaScreen';
import CartScreen from './src/screens/CartScreen';
import HomeScreen from './src/screens/HomeScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import ShopScreen from './src/screens/ShopScreen';
import { AccountsProvider, useAccounts } from './src/ui/accounts';
import { CredentialsProvider } from './src/ui/credentials';
import { DefaultsProvider } from './src/ui/defaults';
import { theme } from './src/ui/theme';

type Tab = 'home' | 'shop' | 'hanukka' | 'cart' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'shop', label: 'Shop' },
  { id: 'hanukka', label: 'חנוכה' },
  { id: 'settings', label: 'Settings' },
];

/** Horizontal account switcher: one tap changes the account every screen uses. */
function AccountBar({ onManage }: { onManage: () => void }) {
  const { accounts, activeId, setActive } = useAccounts();
  if (!accounts.length) {
    return (
      <Pressable onPress={onManage} style={styles.accountEmpty}>
        <Text style={styles.accountEmptyText}>+ add an account</Text>
      </Pressable>
    );
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.accountRow}>
      {accounts.map((a) => (
        <Pressable
          key={a.id}
          onPress={() => void setActive(a.id)}
          style={[styles.chip, a.id === activeId && styles.chipActive]}
        >
          <Text numberOfLines={1} style={[styles.chipText, a.id === activeId && styles.chipTextActive]}>
            {a.label}
          </Text>
        </Pressable>
      ))}
      <Pressable onPress={onManage} style={styles.chipAdd}>
        <Text style={styles.chipAddText}>＋</Text>
      </Pressable>
    </ScrollView>
  );
}

function Shell() {
  const [tab, setTab] = useState<Tab>('home');

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Htz Phone</Text>
          <Text style={styles.version}>v{Constants.expoConfig?.version ?? '1.6.0'} · {Platform.OS === 'ios' ? 'iOS' : 'Android'}</Text>
        </View>
        <AccountBar onManage={() => setTab('settings')} />
      </View>

      <View style={styles.tabs}>
        {TABS.map((t) => (
          <Pressable
            key={t.id}
            onPress={() => setTab(t.id)}
            style={[styles.tab, tab === t.id && styles.tabActive]}
          >
            <Text numberOfLines={1} style={[styles.tabText, tab === t.id && styles.tabTextActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      {/*
        Panes stay mounted: an order loop keeps running (and keeps its log) when
        you glance at another tab. Cart lives here without its own tab — Shop
        opens it.
      */}
      <View style={styles.body}>
        <View style={[styles.pane, tab !== 'home' && styles.hidden]}>
          <HomeScreen />
        </View>
        <View style={[styles.pane, tab !== 'shop' && styles.hidden]}>
          <ShopScreen active={tab === 'shop'} onOpenCart={() => setTab('cart')} />
        </View>
        <View style={[styles.pane, tab !== 'hanukka' && styles.hidden]}>
          <HanukkaScreen />
        </View>
        <View style={[styles.pane, tab !== 'cart' && styles.hidden]}>
          <CartScreen />
        </View>
        <View style={[styles.pane, tab !== 'settings' && styles.hidden]}>
          <SettingsScreen />
        </View>
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <AccountsProvider>
      <CredentialsProvider>
        <DefaultsProvider>
          <Shell />
        </DefaultsProvider>
      </CredentialsProvider>
    </AccountsProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  header: {
    paddingHorizontal: theme.pad,
    paddingTop: Platform.OS === 'android' ? 42 : 8,
    paddingBottom: 8,
  },
  headerRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  title: { color: theme.text, fontSize: 22, fontWeight: '800', letterSpacing: 0.2 },
  version: { color: theme.dim, fontSize: 11 },
  accountRow: { gap: 8, paddingTop: 10, paddingRight: 8, alignItems: 'center' },
  chip: {
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: theme.card,
    maxWidth: 220,
  },
  chipActive: { borderColor: theme.accent, backgroundColor: theme.cardAlt },
  chipText: { color: theme.dim, fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: theme.accent },
  chipAdd: {
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 999,
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipAddText: { color: theme.dim, fontSize: 14, fontWeight: '800' },
  accountEmpty: { marginTop: 10, alignSelf: 'flex-start', borderColor: theme.accent, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  accountEmptyText: { color: theme.accent, fontSize: 12, fontWeight: '700' },
  tabs: {
    flexDirection: 'row',
    marginHorizontal: theme.pad,
    backgroundColor: theme.cardAlt,
    borderRadius: theme.radius,
    padding: 4,
    gap: 4,
  },
  tab: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: theme.radius - 4 },
  tabActive: { backgroundColor: theme.accent },
  tabText: { color: theme.dim, fontSize: 12, fontWeight: '600' },
  tabTextActive: { color: '#fff' },
  body: { flex: 1, marginTop: 6 },
  pane: { flex: 1 },
  hidden: { display: 'none' },
});
