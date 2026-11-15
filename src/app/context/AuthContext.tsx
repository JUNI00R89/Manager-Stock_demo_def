import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { authService, type AuthUser } from '../services/dataService';

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthUser | null>;
  register: (email: string, password: string, name: string) => Promise<AuthUser | null>;
  logout: () => void;
  updateSubscription: (subscription: 'basic' | 'premium') => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const TOKEN_KEY = 'manager_stock_auth_token';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setLoading(false);
      return;
    }
    authService
      .me()
      .then(currentUser => {
        if (active) setUser(currentUser);
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const establishSession = (token: string, nextUser: AuthUser) => {
    localStorage.setItem(TOKEN_KEY, token);
    setUser(nextUser);
    // Never reuse another account's locally cached business configuration.
    localStorage.removeItem('businessConfig');
  };

  const login = async (email: string, password: string): Promise<AuthUser | null> => {
    const response = await authService.login(email, password);
    establishSession(response.access_token, response.user);
    return response.user;
  };

  const register = async (email: string, password: string, name: string): Promise<AuthUser | null> => {
    const response = await authService.register(name, email, password);
    establishSession(response.access_token, response.user);
    return response.user;
  };

  const logout = () => {
    // Clear the browser session immediately; revoke the server session best-effort.
    void authService.logout().catch(() => undefined);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem('businessConfig');
    setUser(null);
  };

  const updateSubscription = (subscription: 'basic' | 'premium') => {
    if (user) setUser({ ...user, subscription });
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, updateSubscription }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
