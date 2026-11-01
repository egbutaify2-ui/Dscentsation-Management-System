import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, getCsrfToken } from '../../lib/api/client.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  roleCode: 'OWNER' | 'MANAGER' | 'STAFF';
  roleName: string;
}

interface AuthSession {
  authenticated: boolean;
  user: AuthenticatedUser | null;
  permissions: string[];
}

interface AuthContextValue {
  status: 'loading' | 'authenticated' | 'anonymous' | 'error';
  user: AuthenticatedUser | null;
  permissions: string[];
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthContextValue['status']>('loading');
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const session = await api.get<AuthSession>('/auth/session');
      setUser(session.user);
      setPermissions(session.permissions);
      setStatus(session.authenticated ? 'authenticated' : 'anonymous');
      setError(null);
    } catch {
      setUser(null);
      setPermissions([]);
      setStatus('error');
      setError('We could not check your session. Check your connection and try again.');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    const csrfToken = await getCsrfToken();
    const session = await api.post<AuthSession>('/auth/login', { email, password }, csrfToken);
    setUser(session.user);
    setPermissions(session.permissions);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    const csrfToken = await getCsrfToken();
    await api.postEmpty('/auth/logout', csrfToken);
    setUser(null);
    setPermissions([]);
    setStatus('anonymous');
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, permissions, error, login, logout, refresh }),
    [status, user, permissions, error, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}
