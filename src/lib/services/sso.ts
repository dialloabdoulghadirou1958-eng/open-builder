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
const TOKEN_MIN_TTL_SECONDS = 60;
const TOKEN_MAX_TTL_SECONDS = 30 * 24 * 60 * 60;
const SSO_ERROR_MAX_CHARS = 500;

export function truncateSsoErrorText(text: string): string {
  return text.length > SSO_ERROR_MAX_CHARS
    ? `${text.slice(0, SSO_ERROR_MAX_CHARS)} [truncated]`
    : text;
}

async function readBoundedError(res: Response): Promise<string> {
  try {
    return truncateSsoErrorText(await res.text());
  } catch {
    return res.statusText || "unknown error";
  }
}

function normalizeExpiresIn(value: unknown): number | null {
  const seconds =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  if (!Number.isFinite(seconds)) return null;
  return Math.min(
    Math.max(Math.floor(seconds), TOKEN_MIN_TTL_SECONDS),
    TOKEN_MAX_TTL_SECONDS,
  );
}

export function parseTokenResponse(data: unknown): {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
} {
  if (!data || typeof data !== "object") {
    throw new Error("Token response must be a JSON object");
  }
  const raw = data as Record<string, unknown>;
  if (typeof raw.access_token !== "string" || !raw.access_token) {
    throw new Error("Token response is missing access_token");
  }
  const expiresIn = normalizeExpiresIn(raw.expires_in);
  return {
    accessToken: raw.access_token,
    refreshToken:
      typeof raw.refresh_token === "string" && raw.refresh_token
        ? raw.refresh_token
        : undefined,
    expiresAt: Date.now() + (expiresIn ?? TOKEN_FALLBACK_TTL_MS / 1000) * 1000,
  };
}

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
    throw new Error(`Failed to exchange token: ${await readBoundedError(res)}`);
  }
  return parseTokenResponse(await res.json());
}

async function fetchUserWithToken(config: SSOConfig, accessToken: string): Promise<SSOUser> {
  const res = await fetch(`${config.ssoUrl}/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch user info: ${await readBoundedError(res)}`);
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
