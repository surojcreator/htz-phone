/**
 * One defaults state for the whole app, loaded once at start.
 *
 * Screens copy a value out of here when they mount (so the tab keeps whatever
 * you type), and the Settings tab edits the stored version.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

import { BUILT_IN, clearDefaults, Defaults, loadDefaults, normalize, saveDefaults } from '../core/defaults';

export type DefaultsApi = {
  defaults: Defaults;
  loaded: boolean;
  /** true once the screen has taken its initial values from storage */
  applied: boolean;
  markApplied: () => void;
  patch: (p: Partial<Defaults>) => Promise<void>;
  reset: () => Promise<void>;
  savedAt: number;
};

const Ctx = createContext<DefaultsApi | null>(null);

export function DefaultsProvider({ children }: { children: React.ReactNode }) {
  const [defaults, setDefaults] = useState<Defaults>(BUILT_IN);
  const [loaded, setLoaded] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const applied = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const d = await loadDefaults();
      if (!alive) return;
      setDefaults(d);
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const patch = useCallback(async (p: Partial<Defaults>) => {
    const next = normalize({ ...defaults, ...p });
    setDefaults(next);
    const ok = await saveDefaults(next);
    if (ok) setSavedAt(Date.now());
  }, [defaults]);

  const reset = useCallback(async () => {
    await clearDefaults();
    setDefaults({ ...BUILT_IN });
    setSavedAt(Date.now());
  }, []);

  const markApplied = useCallback(() => {
    applied.current = true;
  }, []);

  return (
    <Ctx.Provider value={{ defaults, loaded, applied: applied.current, markApplied, patch, reset, savedAt }}>
      {children}
    </Ctx.Provider>
  );
}

export function useDefaults(): DefaultsApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDefaults must be used inside <DefaultsProvider>');
  return v;
}

/** Copy a stored value into local state exactly once. */
export function useDefaultOnce<T>(loaded: boolean, pick: () => T, set: (v: T) => void) {
  const done = useRef(false);
  useEffect(() => {
    if (!loaded || done.current) return;
    done.current = true;
    set(pick());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);
}
