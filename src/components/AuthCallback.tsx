import { useEffect, useState, useRef } from "react";
import { handleCallback } from "../lib/services/sso";
import { useAuthStore } from "../store/auth";
import { useT } from "../i18n";
import { Loader2 } from "lucide-react";

export function AuthCallback() {
  const [error, setError] = useState<string | null>(null);
  const t = useT();
  const setAuth = useAuthStore((s) => s.setAuth);
  const didRun = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const errorParam = params.get("error");
    const errorDescription = params.get("error_description");

    if (errorParam) {
      setError(errorDescription || errorParam);
      return;
    }

    if (didRun.current) return;
    didRun.current = true;

    if (!code || !state) {
      setError("Missing code or state in URL");
      return;
    }

    handleCallback(code, state)
      .then((authResult) => {
        setAuth(authResult);
        window.location.replace("/");
      })
      .catch((err) => {
        console.error("Auth callback error:", err);
        setError(err.message || String(err));
      });
  }, [setAuth]);

  return (
    <div className="flex h-screen w-full flex-col items-center justify-center bg-background p-4">
      {error ? (
        <div className="flex max-w-md flex-col items-center space-y-4 text-center">
          <div className="rounded-full bg-destructive/10 p-3 text-destructive">
            <svg
              className="h-6 w-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-foreground">
            {t.auth.callbackError}
          </h2>
          <p className="text-sm text-muted-foreground">{error}</p>
          <button
            onClick={() => (window.location.href = "/")}
            className="mt-4 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t.auth.retryLogin}
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <h2 className="text-xl font-medium text-foreground">
            {t.auth.callbackProcessing}
          </h2>
        </div>
      )}
    </div>
  );
}
