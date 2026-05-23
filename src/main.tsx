import { installProxy } from "./lib/infra/proxy";
import { setMohuaAuthProvider } from "./lib/services/mohua-api";
import { useAuthStore } from "./store/auth";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppRouter } from "./AppRouter";
import "./index.css";

// Install proxy before any API calls can happen
installProxy();

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
