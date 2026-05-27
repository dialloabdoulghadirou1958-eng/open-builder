import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { AuthResult, SSOUser, refreshAccessToken } from '../lib/services/sso';
import { useSecretsStore } from './secrets';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: number | null;
  user: SSOUser | null;
  isLoggingIn: boolean;

  isLoggedIn: () => boolean;
  setAuth: (data: AuthResult) => void;
  clearAuth: () => void;
  setLoggingIn: (v: boolean) => void;
  getValidToken: () => string | null;
  getValidTokenAsync: () => Promise<string | null>;
  forceRefreshAsync: () => Promise<string | null>;
}

let refreshPromise: Promise<string | null> | null = null;

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      user: null,
      isLoggingIn: false,

      isLoggedIn: () => {
        const { accessToken, tokenExpiresAt, refreshToken } = get();
        if (refreshToken) return true;
        if (!accessToken || !tokenExpiresAt) return false;
        // Check if token has at least 1 minute remaining
        return tokenExpiresAt > Date.now() + 60000;
      },

      setAuth: (data: AuthResult) => {
        const next = {
          accessToken: data.accessToken,
          refreshToken: data.refreshToken || get().refreshToken,
          tokenExpiresAt: data.expiresAt,
          user: data.user ?? get().user,
          isLoggingIn: false,
        };
        set(next);
        void useSecretsStore.getState().setAuthTokens({
          accessToken: next.accessToken,
          refreshToken: next.refreshToken,
          tokenExpiresAt: next.tokenExpiresAt,
        });
      },

      clearAuth: () => {
        set({
          accessToken: null,
          refreshToken: null,
          tokenExpiresAt: null,
          user: null,
          isLoggingIn: false,
        });
        void useSecretsStore.getState().setAuthTokens({
          accessToken: null,
          refreshToken: null,
          tokenExpiresAt: null,
        });
      },

      setLoggingIn: (v: boolean) => set({ isLoggingIn: v }),

      getValidToken: () => {
        const state = get();
        const isValid = state.accessToken && state.tokenExpiresAt && state.tokenExpiresAt > Date.now() + 60000;
        if (isValid) {
          return state.accessToken;
        }
        if (state.accessToken && !state.refreshToken) {
          state.clearAuth();
          return null;
        }
        // Token may be expired but a refresh is possible; callers needing a fresh token should use getValidTokenAsync.
        return state.accessToken;
      },

      forceRefreshAsync: async () => {
        const state = get();
        if (!state.refreshToken) {
          state.clearAuth();
          return null;
        }

        if (refreshPromise) return refreshPromise;
          
        refreshPromise = refreshAccessToken(state.refreshToken).then(result => {
           get().setAuth(result);
           return result.accessToken;
        }).catch(err => {
           console.error('Failed to refresh token', err);
           get().clearAuth();
           return null;
        }).finally(() => {
           refreshPromise = null;
        });
        
        return refreshPromise;
      },

      getValidTokenAsync: async () => {
        const state = get();
        const isValid = state.accessToken && state.tokenExpiresAt && state.tokenExpiresAt > Date.now() + 60000;
        
        if (isValid) {
          return state.accessToken;
        }

        if (state.refreshToken) {
          return get().forceRefreshAsync();
        }

        if (state.accessToken) {
          state.clearAuth();
        }
        return null;
      },
    }),
    {
      name: 'open-builder-auth',
      // Tokens are stored in the encrypted vault, not localStorage. Only the
      // user profile (display name, avatar) is persisted here.
      partialize: (state) => ({
        user: state.user,
      }),
    }
  )
);
