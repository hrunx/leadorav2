import { createContext, useContext, useReducer, ReactNode, useEffect } from 'react';
import { supabase } from '../lib/supabase';

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
  register: (userData: RegisterData) => Promise<boolean>;
  logout: () => void;
  updateProfile: (userData: Partial<User>) => Promise<boolean>;
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
      // Check if this is demo login
      if (email === 'demo@leadora.com' && password === 'demo123') {
        const user: User = {
          id: 'demo-user',
          email: 'demo@leadora.com',
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
      return true;
    } catch (error) {
      console.error('Login error:', error);
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
    } catch (error) {
      console.error('Registration error:', error);
      return false;
    }
  };

  const logout = () => {
    supabase.auth.signOut();
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
    } catch (error) {
      console.error('Profile update error:', error);
      return false;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        state,
        login,
        register,
        logout,
        updateProfile
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