export interface SSOConfig {
  ssoUrl: string;
  clientId: string;
  redirectUri: string;
  mohuaApiUrl: string;
}

export interface SSOUser {
  sub: string;
  email: string;
  name: string;
  picture: string | null;
}

export interface AuthResult {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  user?: SSOUser;
}

const TOKEN_FALLBACK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

async function exchangeToken(
  config: SSOConfig,
  body: Record<string, string>,
): Promise<{ accessToken: string; refreshToken?: string; expiresAt: number }> {
  const res = await fetch(`${config.ssoUrl}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Failed to exchange token: ${await res.text()}`);
  }
  const { access_token, refresh_token, expires_in } = await res.json();
  return {
    accessToken: access_token,
    refreshToken: refresh_token,
    expiresAt: expires_in
      ? Date.now() + Number(expires_in) * 1000
      : Date.now() + TOKEN_FALLBACK_TTL_MS,
  };
}

async function fetchUserWithToken(config: SSOConfig, accessToken: string): Promise<SSOUser> {
  const res = await fetch(`${config.ssoUrl}/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch user info: ${await res.text()}`);
  }
  return res.json();
}

export function getSSOConfig(): SSOConfig | null {
  const ssoUrl = import.meta.env.VITE_SSO_URL;
  const clientId = import.meta.env.VITE_SSO_CLIENT_ID;
  const redirectUri = import.meta.env.VITE_SSO_REDIRECT_URI;
  const mohuaApiUrl = import.meta.env.VITE_MOHUA_API_URL;

  if (!ssoUrl || !clientId || !redirectUri || !mohuaApiUrl) {
    return null;
  }

  return { ssoUrl, clientId, redirectUri, mohuaApiUrl };
}

export function isSSOEnabled(): boolean {
  return getSSOConfig() !== null;
}

function base64UrlEncode(array: Uint8Array): string {
  return btoa(String.fromCharCode.apply(null, Array.from(array)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function generatePKCE(): Promise<{ codeVerifier: string; codeChallenge: string }> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error("Web Crypto API is not available. Please ensure you are running on localhost or via HTTPS.");
  }
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  const codeVerifier = base64UrlEncode(array);

  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const codeChallenge = base64UrlEncode(new Uint8Array(digest));

  return { codeVerifier, codeChallenge };
}

export function buildAuthorizeURL(ssoUrl: string, clientId: string, redirectUri: string, codeChallenge: string, state: string): string {
  const url = new URL('/oauth/authorize', ssoUrl);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  return url.toString();
}

export async function initiateLogin(): Promise<void> {
  const config = getSSOConfig();
  if (!config) throw new Error("SSO not configured");

  const { codeVerifier, codeChallenge } = await generatePKCE();
  const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));

  sessionStorage.setItem('sso_code_verifier', codeVerifier);
  sessionStorage.setItem('sso_state', state);

  window.location.href = buildAuthorizeURL(config.ssoUrl, config.clientId, config.redirectUri, codeChallenge, state);
}

export async function handleCallback(code: string, state: string): Promise<AuthResult> {
  const config = getSSOConfig();
  if (!config) throw new Error("SSO not configured");

  const savedState = sessionStorage.getItem('sso_state');
  const savedCodeVerifier = sessionStorage.getItem('sso_code_verifier');

  if (!savedState || !savedCodeVerifier) {
    throw new Error("Missing SSO session data");
  }

  if (state !== savedState) {
    sessionStorage.removeItem('sso_state');
    sessionStorage.removeItem('sso_code_verifier');
    throw new Error("State mismatch, potential CSRF attack");
  }

  const tokens = await exchangeToken(config, {
    grant_type: 'authorization_code',
    code,
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    code_verifier: savedCodeVerifier,
  });
  const user = await fetchUserWithToken(config, tokens.accessToken);

  sessionStorage.removeItem('sso_state');
  sessionStorage.removeItem('sso_code_verifier');

  return { ...tokens, user };
}

export async function refreshAccessToken(refreshToken: string): Promise<AuthResult> {
  const config = getSSOConfig();
  if (!config) throw new Error("SSO not configured");

  // Silent refresh skips the userinfo fetch — the user profile doesn't change
  // between refreshes, so the caller (auth store) should preserve the existing user.
  return exchangeToken(config, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
  });
}
