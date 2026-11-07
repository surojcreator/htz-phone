/**
 * One credential state for the whole app.
 *
 * Previously each screen called useCredentials() on its own, so switching tabs
 * remounted the screen and threw away whatever you had typed. The provider sits
 * above the tabs and every screen reads the same state.
 */
import React, { createContext, useContext } from 'react';

import { useCredentials, CredentialsApi } from './useCredentials';

const Ctx = createContext<CredentialsApi | null>(null);

export function CredentialsProvider({ children }: { children: React.ReactNode }) {
  const value = useCredentials();
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCreds(): CredentialsApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCreds must be used inside <CredentialsProvider>');
  return v;
}
