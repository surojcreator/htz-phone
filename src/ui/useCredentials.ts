import { useCallback } from 'react';

import { useAccounts } from './accounts';

export type RememberState = 'idle' | 'saved' | 'cleared' | 'unavailable';

/**
 * Thin adapter over the account list.
 *
 * Screens were built around this hook; it now reads the *active* account, so
 * switching accounts in Settings or the header changes what every screen uses
 * without any per-screen plumbing. `setEmail` / `setPassword` edit the active
 * account in place.
 */
export function useCredentials() {
  const { active, loaded, update, touch } = useAccounts();

  const persist = useCallback(async () => {
    if (active) await touch(active.id);
  }, [active, touch]);

  const forget = useCallback(async () => {
    if (active) await update(active.id, { password: '' });
  }, [active, update]);

  return {
    email: active?.email ?? '',
    setEmail: (v: string) => {
      if (active) void update(active.id, { email: v });
    },
    password: active?.password ?? '',
    setPassword: (v: string) => {
      if (active) void update(active.id, { password: v });
    },
    remember: true,
    setRemember: (_: boolean) => {},
    loaded,
    persist,
    forget,
    rememberState: (active ? 'saved' : 'idle') as RememberState,
    hasAccount: !!active,
  };
}

export type CredentialsApi = ReturnType<typeof useCredentials>;
