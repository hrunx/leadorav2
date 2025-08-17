import { createContext, useContext, useReducer, ReactNode, useEffect } from 'react';
import logger from '../lib/logger';
import { supabase } from '../lib/supabase';
import { DEMO_USER_EMAIL } from '../constants/demo';

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  role: string;
  industry: string;
  createdAt: string;
  subscription: 'demo' | 'starter' | 'professional' | 'enterprise';
  subscriptionStatus: 'active' | 'trial' | 'expired' | 'demo';
  trialEndsAt?: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

interface AuthContextType {
  state: AuthState;
  login: (email: string, password: string) => Promise<boolean>;
  loginWithOtp: (email: string, code: string) => Promise<boolean>;
  requestOtp: (email: string, purpose: 'signin'|'signup', userId?: string) => Promise<boolean>;
  register: (userData: RegisterData) => Promise<boolean>;
  logout: () => void;
  updateProfile: (userData: Partial<User>) => Promise<boolean>;
  resetPassword: (email: string) => Promise<boolean>;
}

interface RegisterData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  company: string;
  role: string;
  industry: string;
}

const initialState: AuthState = {
  user: null,
  isAuthenticated: false,
  isLoading: true
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function authReducer(state: AuthState, action: any): AuthState {
  switch (action.type) {
    case 'SET_LOADING':
      return {
        ...state,
        isLoading: action.payload
      };
    case 'LOGIN_SUCCESS':
      return {
        ...state,
        user: action.payload,
        isAuthenticated: true,
        isLoading: false
      };
    case 'LOGOUT':
      return {
        ...state,
        user: null,
        isAuthenticated: false,
        isLoading: false
      };
    case 'UPDATE_PROFILE':
      return {
        ...state,
        user: action.payload
      };
    default:
      return state;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, initialState);

  useEffect(() => {
    // Check for existing Supabase session
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const user: User = {
          id: session.user.id,
          email: session.user.email || '',
          firstName: session.user.user_metadata?.firstName || '',
          lastName: session.user.user_metadata?.lastName || '',
          company: session.user.user_metadata?.company || '',
          role: session.user.user_metadata?.role || '',
          industry: session.user.user_metadata?.industry || '',
          createdAt: session.user.created_at,
          subscription: session.user.user_metadata?.subscription || 'demo',
          subscriptionStatus: session.user.user_metadata?.subscriptionStatus || 'demo'
        };
        dispatch({ type: 'LOGIN_SUCCESS', payload: user });
        // Persist app session copy for refresh resilience
        try { localStorage.setItem('leadora_app_user', JSON.stringify(user)); } catch {}
      } else {
        // No Supabase session — attempt to restore OTP app session from localStorage
        try {
          const raw = localStorage.getItem('leadora_app_user');
          if (raw) {
            const cached = JSON.parse(raw) as User;
            if (cached && cached.id && cached.email) {
              dispatch({ type: 'LOGIN_SUCCESS', payload: cached });
            }
          }
        } catch {}
      }
      dispatch({ type: 'SET_LOADING', payload: false });
    };

    checkSession();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        const user: User = {
          id: session.user.id,
          email: session.user.email || '',
          firstName: session.user.user_metadata?.firstName || '',
          lastName: session.user.user_metadata?.lastName || '',
          company: session.user.user_metadata?.company || '',
          role: session.user.user_metadata?.role || '',
          industry: session.user.user_metadata?.industry || '',
          createdAt: session.user.created_at,
          subscription: session.user.user_metadata?.subscription || 'demo',
          subscriptionStatus: session.user.user_metadata?.subscriptionStatus || 'demo'
        };
        dispatch({ type: 'LOGIN_SUCCESS', payload: user });
      } else if (event === 'SIGNED_OUT') {
        dispatch({ type: 'LOGOUT' });
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const login = async (email: string, password: string): Promise<boolean> => {
    try {
      // Check if this is demo login (moved to env-configured email only)
      if (email === ((import.meta as any).env?.VITE_DEMO_EMAIL || DEMO_USER_EMAIL)) {
        const user: User = {
          id: 'demo-user',
          email: email,
          firstName: 'Demo',
          lastName: 'User',
          company: 'Demo Company',
          role: 'Demo Role',
          industry: 'Technology',
          createdAt: new Date().toISOString(),
          subscription: 'demo',
          subscriptionStatus: 'demo'
        };
        dispatch({ type: 'LOGIN_SUCCESS', payload: user });
        return true;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;
      // After Supabase login, persist app user mirror for refresh
      const { data: { user: sUser } } = await supabase.auth.getUser();
      if (sUser) {
        const mirror: User = {
          id: sUser.id,
          email: sUser.email || email,
          firstName: sUser.user_metadata?.firstName || '',
          lastName: sUser.user_metadata?.lastName || '',
          company: sUser.user_metadata?.company || '',
          role: sUser.user_metadata?.role || '',
          industry: sUser.user_metadata?.industry || '',
          createdAt: sUser.created_at,
          subscription: sUser.user_metadata?.subscription || 'demo',
          subscriptionStatus: sUser.user_metadata?.subscriptionStatus || 'demo'
        };
        try { localStorage.setItem('leadora_app_user', JSON.stringify(mirror)); } catch {}
      }
      return true;
    } catch (error: any) {
      logger.error('Login error', { error: error?.message || String(error) });
      return false;
    }
  };

  const requestOtp = async (email: string, purpose: 'signin'|'signup', userId?: string): Promise<boolean> => {
    try {
      const r = await fetch('/.netlify/functions/auth-request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, purpose, user_id: userId })
      });
      return r.ok;
    } catch { return false; }
  };

  const loginWithOtp = async (email: string, code: string): Promise<boolean> => {
    try {
      const r = await fetch('/.netlify/functions/auth-verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, purpose: 'signin', code })
      });
      if (!r.ok) return false;
      const payload = await r.json();
      const emailOtp = payload?.email_otp as string | undefined;
      const actionLink = payload?.action_link as string | undefined;
      if (!emailOtp && !actionLink) {
        // Could not create a magic link or token; do not fallback to a fake user to avoid ID mismatch
        return false;
      }
      // Prefer direct email_otp exchange; otherwise open action link (Netlify dev) to complete session
      let sUser: any = null;
      if (emailOtp) {
        const { data, error } = await supabase.auth.verifyOtp({ type: 'email', email, token: emailOtp });
        if (error) return false;
        sUser = data?.user || (await supabase.auth.getUser()).data.user;
      } else if (actionLink) {
        // As a fallback during dev, attempt to call the action link to seed session cookies (only works if same domain)
        try {
          // Open in same tab to complete magic link; after redirect back, session will exist
          window.location.href = actionLink;
          return false; // prevent further processing; page will reload
        } catch {}
      }
      if (!sUser) return false;
      const mirror: User = {
        id: sUser.id,
        email: sUser.email || email,
        firstName: sUser.user_metadata?.firstName || '',
        lastName: sUser.user_metadata?.lastName || '',
        company: sUser.user_metadata?.company || '',
        role: sUser.user_metadata?.role || '',
        industry: sUser.user_metadata?.industry || '',
        createdAt: sUser.created_at,
        subscription: sUser.user_metadata?.subscription || 'demo',
        subscriptionStatus: sUser.user_metadata?.subscriptionStatus || 'demo'
      };
      dispatch({ type: 'LOGIN_SUCCESS', payload: mirror });
      try { localStorage.setItem('leadora_app_user', JSON.stringify(mirror)); } catch {}
      return true;
    } catch {
      return false;
    }
  };

  const register = async (userData: RegisterData): Promise<boolean> => {
    try {
      const { error } = await supabase.auth.signUp({
        email: userData.email,
        password: userData.password,
        options: {
          data: {
            firstName: userData.firstName,
            lastName: userData.lastName,
            company: userData.company,
            role: userData.role,
            industry: userData.industry,
            subscription: 'demo',
            subscriptionStatus: 'demo'
          }
        }
      });

      if (error) throw error;
      return true;
    } catch (error: any) {
      logger.error('Registration error', { error: error?.message || String(error) });
      return false;
    }
  };

  const logout = () => {
    supabase.auth.signOut();
    try { localStorage.removeItem('leadora_app_user'); } catch {}
  };

  const resetPassword = async (email: string): Promise<boolean> => {
    try {
      const redirectTo = typeof window !== 'undefined' ? window.location.origin : undefined;
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo
      });
      if (error) throw error;
      return true;
    } catch (error: any) {
      logger.error('Password reset error', { error: error?.message || String(error) });
      return false;
    }
  };

  const updateProfile = async (userData: Partial<User>): Promise<boolean> => {
    try {
      const { error } = await supabase.auth.updateUser({
        data: userData
      });

      if (error) throw error;

      if (state.user) {
        const updatedUser = { ...state.user, ...userData };
        dispatch({ type: 'UPDATE_PROFILE', payload: updatedUser });
      }
      return true;
    } catch (error: any) {
      logger.error('Profile update error', { error: error?.message || String(error) });
      return false;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        state,
        login,
        loginWithOtp,
        requestOtp,
        register,
        logout,
        updateProfile,
        resetPassword
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}