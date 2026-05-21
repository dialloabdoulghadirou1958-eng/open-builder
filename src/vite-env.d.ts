/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MOHUA_API_URL?: string;
  readonly VITE_SSO_URL?: string;
  readonly VITE_SSO_CLIENT_ID?: string;
  readonly VITE_SSO_REDIRECT_URI?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
