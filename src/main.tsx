import { installProxy } from "./lib/infra/proxy";
import { useSecretsStore } from "./store/secrets";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Install proxy before any API calls can happen
installProxy();

// Boot the credential vault. Resolves the v8->v9 migration and rehydrates
// the API key from encrypted storage into the in-memory settings store.
void useSecretsStore.getState().boot();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
