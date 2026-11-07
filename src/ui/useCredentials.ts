import { useCallback, useEffect, useState } from 'react';

import { clearCredentials, loadCredentials, saveCredentials } from '../core/storage';

export type RememberState = 'idle' | 'saved' | 'cleared' | 'unavailable';

/**
 * Email/password state shared by both screens, restored from the secure store
 * on mount and written back after a successful action.
 */
export function useCredentials() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [rememberState, setRememberState] = useState<RememberState>('idle');

  useEffect(() => {
    let alive = true;
    (async () => {
      const saved = await loadCredentials();
      if (!alive) return;
      if (saved) {
        setEmail(saved.email);
        setPassword(saved.password);
        setRemember(true);
        setRememberState('saved');
      }
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  /** Call after a successful run. */
  const persist = useCallback(
    async (e: string, p: string) => {
      if (!remember) {
        await clearCredentials();
        setRememberState('cleared');
        return;
      }
      const ok = await saveCredentials({ email: e.trim(), password: p });
      setRememberState(ok ? 'saved' : 'unavailable');
    },
    [remember],
  );

  const forget = useCallback(async () => {
    await clearCredentials();
    setPassword('');
    setRememberState('cleared');
  }, []);

  return {
    email,
    setEmail,
    password,
    setPassword,
    remember,
    setRemember,
    loaded,
    persist,
    forget,
    rememberState,
  };
}
