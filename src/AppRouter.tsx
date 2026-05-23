import App from "./App";
import { AuthCallback } from "./components/AuthCallback";

export function AppRouter() {
  if (window.location.pathname === "/auth/callback") {
    return <AuthCallback />;
  }
  return <App />;
}
