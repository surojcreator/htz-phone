import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { Platform, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import SetPhoneScreen from './src/screens/SetPhoneScreen';
import VerifyScreen from './src/screens/VerifyScreen';
import HanukkaScreen from './src/screens/HanukkaScreen';
import { theme } from './src/ui/theme';

type Tab = 'set' | 'verify' | 'hanukka';

export default function App() {
  const [tab, setTab] = useState<Tab>('set');

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.title}>Htz Phone</Text>
        <Text style={styles.subtitle}>
          set · verify — {Platform.OS === 'ios' ? 'iOS' : 'Android'}
        </Text>
      </View>

      <View style={styles.tabs}>
        {(['set', 'verify', 'hanukka'] as Tab[]).map((t) => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            style={[styles.tab, tab === t && styles.tabActive]}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'set' ? 'Set phone' : t === 'verify' ? 'Verify' : 'חנוכה'}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.body}>
        {tab === 'set' ? <SetPhoneScreen /> : tab === 'verify' ? <VerifyScreen /> : <HanukkaScreen />}
      </View>
    </SafeAreaView>
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
  tabText: { color: theme.dim, fontSize: 14, fontWeight: '600' },
  tabTextActive: { color: '#fff' },
  body: { flex: 1, marginTop: 6 },
});
