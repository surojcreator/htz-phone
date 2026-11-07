import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { Platform, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import HanukkaScreen from './src/screens/HanukkaScreen';
import SetPhoneScreen from './src/screens/SetPhoneScreen';
import VerifyScreen from './src/screens/VerifyScreen';
import { CredentialsProvider } from './src/ui/credentials';
import { theme } from './src/ui/theme';

type Tab = 'set' | 'verify' | 'hanukka';

const TABS: { id: Tab; label: string }[] = [
  { id: 'set', label: 'Set phone' },
  { id: 'verify', label: 'Verify' },
  { id: 'hanukka', label: 'חנוכה' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('set');

  return (
    <CredentialsProvider>
      <SafeAreaView style={styles.root}>
        <StatusBar style="light" />
        <View style={styles.header}>
          <Text style={styles.title}>Htz Phone</Text>
          <Text style={styles.subtitle}>
            set · verify · חנוכה — {Platform.OS === 'ios' ? 'iOS' : 'Android'}
          </Text>
        </View>

        <View style={styles.tabs}>
          {TABS.map((t) => (
            <Pressable
              key={t.id}
              onPress={() => setTab(t.id)}
              style={[styles.tab, tab === t.id && styles.tabActive]}
            >
              <Text style={[styles.tabText, tab === t.id && styles.tabTextActive]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>

        {/*
          All three stay mounted: an order loop keeps running (and keeps its log)
          when you glance at another tab, instead of being torn down.
        */}
        <View style={styles.body}>
          <View style={[styles.pane, tab !== 'set' && styles.hidden]}>
            <SetPhoneScreen />
          </View>
          <View style={[styles.pane, tab !== 'verify' && styles.hidden]}>
            <VerifyScreen />
          </View>
          <View style={[styles.pane, tab !== 'hanukka' && styles.hidden]}>
            <HanukkaScreen />
          </View>
        </View>
      </SafeAreaView>
    </CredentialsProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  header: {
    paddingHorizontal: theme.pad,
    paddingTop: Platform.OS === 'android' ? 42 : 10,
    paddingBottom: 12,
  },
  title: { color: theme.text, fontSize: 22, fontWeight: '800', letterSpacing: 0.2 },
  subtitle: { color: theme.dim, fontSize: 12, marginTop: 3 },
  tabs: {
    flexDirection: 'row',
    marginHorizontal: theme.pad,
    backgroundColor: theme.cardAlt,
    borderRadius: theme.radius,
    padding: 4,
    gap: 4,
  },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: theme.radius - 4 },
  tabActive: { backgroundColor: theme.accent },
  tabText: { color: theme.dim, fontSize: 13.5, fontWeight: '600' },
  tabTextActive: { color: '#fff' },
  body: { flex: 1, marginTop: 6 },
  pane: { flex: 1 },
  hidden: { display: 'none' },
});
