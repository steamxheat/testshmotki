import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from '../lib/api';
import type { Store } from '../types';

interface AppState {
  store: Store | null;
  loading: boolean;
  error: string | null;
  blocked: boolean;
  reloadStore: () => void;
}

const StoreCtx = createContext<AppState>({ store: null, loading: true, error: null, blocked: false, reloadStore: () => {} });
export const useStore = () => useContext(StoreCtx);

const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function AppProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const reloadStore = useCallback(() => {
    setLoading(true);
    setError(null);
    setBlocked(false);
    api
      .store()
      .then((r) => {
        setStore(r.store);
        if (r.store.settings.accentColor) {
          document.documentElement.style.setProperty('--accent', r.store.settings.accentColor);
        }
        document.title = r.store.name;
      })
      .catch((e: ApiError) => {
        if (e.code === 'forbidden') setBlocked(true);
        setError(e.message);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => reloadStore(), [reloadStore]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  return (
    <StoreCtx.Provider value={{ store, loading, error, blocked, reloadStore }}>
      <ToastCtx.Provider value={showToast}>
        {children}
        {toast && <div className="toast">{toast}</div>}
      </ToastCtx.Provider>
    </StoreCtx.Provider>
  );
}
