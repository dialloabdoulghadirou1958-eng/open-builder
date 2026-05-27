import { installProxy } from "./lib/infra/proxy";
import { setMohuaAuthProvider } from "./lib/services/mohua-api";
import { useAuthStore } from "./store/auth";
import { useSecretsStore } from "./store/secrets";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppRouter } from "./AppRouter";
import "./index.css";

// Install proxy before any API calls can happen
installProxy();

// Boot the credential vault. Resolves the v8->v9 migration and rehydrates
// apiKey/tokens from encrypted storage into the in-memory stores.
void useSecretsStore.getState().boot();

// Wire mohua-api auth so the lib layer never imports the auth store directly
setMohuaAuthProvider({
  getToken: () => useAuthStore.getState().getValidTokenAsync(),
  refreshToken: () => useAuthStore.getState().forceRefreshAsync(),
  clearAuth: () => useAuthStore.getState().clearAuth(),
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppRouter />
  </StrictMode>,
);
