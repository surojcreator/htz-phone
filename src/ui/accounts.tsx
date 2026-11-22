/**
 * One account list for the whole app.
 *
 * The active account is what every screen uses; adding one makes it active
 * immediately, because that is the only reason to add one mid-session.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { Account, loadAccountStore, makeAccount, saveAccountStore } from '../core/accounts';

export type AccountsApi = {
  accounts: Account[];
  active: Account | null;
  activeId: string | null;
  loaded: boolean;
  add: (email: string, password: string, label?: string) => Promise<Account>;
  update: (id: string, patch: Partial<Pick<Account, 'label' | 'email' | 'password' | 'phone'>>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setActive: (id: string) => Promise<void>;
  touch: (id?: string) => Promise<void>;
  notePhone: (phone: string, id?: string) => Promise<void>;
};

const Ctx = createContext<AccountsApi | null>(null);

export function AccountsProvider({ children }: { children: React.ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const store = await loadAccountStore();
      if (!alive) return;
      setAccounts(store.accounts);
      setActiveId(store.activeId);
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const persist = useCallback(async (next: Account[], nextActiveId: string | null) => {
    setAccounts(next);
    setActiveId(nextActiveId);
    await saveAccountStore({ accounts: next, activeId: nextActiveId });
  }, []);

  const add = useCallback(
    async (email: string, password: string, label?: string) => {
      const account = makeAccount(email, password, label);
      const next = [account, ...accounts];
      await persist(next, account.id);
      return account;
    },
    [accounts, persist],
  );

  const update = useCallback(
    async (id: string, patch: Partial<Pick<Account, 'label' | 'email' | 'password' | 'phone'>>) => {
      const next = accounts.map((a) => (a.id === id ? { ...a, ...patch } : a));
      await persist(next, activeId);
    },
    [accounts, activeId, persist],
  );

  const remove = useCallback(
    async (id: string) => {
      const next = accounts.filter((a) => a.id !== id);
      const nextActive = activeId === id ? next[0]?.id ?? null : activeId;
      await persist(next, nextActive);
    },
    [accounts, activeId, persist],
  );

  const setActive = useCallback(
    async (id: string) => {
      if (!accounts.some((a) => a.id === id)) return;
      const next = accounts.map((a) => (a.id === id ? { ...a, lastUsedAt: Date.now() } : a));
      await persist(next, id);
    },
    [accounts, persist],
  );

  const touch = useCallback(
    async (id?: string) => {
      const target = id ?? activeId;
      if (!target) return;
      const next = accounts.map((a) => (a.id === target ? { ...a, lastUsedAt: Date.now() } : a));
      await persist(next, activeId);
    },
    [accounts, activeId, persist],
  );

  const notePhone = useCallback(
    async (phone: string, id?: string) => {
      const target = id ?? activeId;
      if (!target) return;
      const next = accounts.map((a) => (a.id === target ? { ...a, phone, lastUsedAt: Date.now() } : a));
      await persist(next, activeId);
    },
    [accounts, activeId, persist],
  );

  const active = useMemo(() => accounts.find((a) => a.id === activeId) ?? accounts[0] ?? null, [accounts, activeId]);

  return (
    <Ctx.Provider
      value={{ accounts, active, activeId, loaded, add, update, remove, setActive, touch, notePhone }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAccounts(): AccountsApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAccounts must be used inside <AccountsProvider>');
  return v;
}
