import { useAuthStore } from '../store/auth';

export function getMohuaApiUrl(): string | null {
  const url = import.meta.env.VITE_MOHUA_API_URL;
  if (!url) return null;
  const baseUrl = url.replace(/\/+$/, '');
  if (baseUrl.endsWith('/api/v1')) return baseUrl;
  return `${baseUrl}/api/v1`;
}

export function isMohuaEnabled(): boolean {
  return getMohuaApiUrl() !== null;
}

async function authedFetch(url: string, options?: RequestInit): Promise<Response> {
  const token = await useAuthStore.getState().getValidTokenAsync();
  if (!token) {
    throw new Error('Unauthorized');
  }

  const headers = new Headers(options?.headers);
  headers.set('Authorization', `Bearer ${token}`);

  let response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    const newToken = await useAuthStore.getState().forceRefreshAsync();
    if (newToken) {
      headers.set('Authorization', `Bearer ${newToken}`);
      response = await fetch(url, { ...options, headers });
    }
  }

  if (response.status === 401) {
    useAuthStore.getState().clearAuth();
    throw new Error('Session expired. Please log in again.');
  }

  return response;
}

async function mohuaFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const baseUrl = getMohuaApiUrl();
  if (!baseUrl) {
    throw new Error('Mohua API URL not configured');
  }

  const url = `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
  const response = await authedFetch(url, options);

  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export interface ServerModel {
  id: string;
  displayName: string;
  maxContextTokens: number;
}

export async function fetchServerModels(): Promise<ServerModel[]> {
  const res = await mohuaFetch<{ data: any[] }>('/models');
  return res.data.map((m: any) => ({
    id: m.id,
    displayName: m.name || m.id,
    maxContextTokens: m.context_length || 128000,
  }));
}

export interface SearchProvider {
  id: string;
  name: string;
  slug: string;
}

export async function fetchSearchProviders(): Promise<SearchProvider[]> {
  const res = await mohuaFetch<{ data: SearchProvider[] }>('/search');
  return res.data;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export async function serverWebSearch(params: {
  query: string;
  providerId?: string;
  maxResults?: number;
}): Promise<SearchResult[]> {
  return mohuaFetch<SearchResult[]>('/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

export interface AssetProvider {
  id: string;
  name: string;
  slug: string;
}

export async function fetchAssetProviders(): Promise<AssetProvider[]> {
  const res = await mohuaFetch<{ data: AssetProvider[] }>('/asset');
  return res.data;
}

export interface AssetSearchResult {
  images: Array<{
    url: string;
    thumbnail: string;
    width: number;
    height: number;
    description: string;
  }>;
  total: number;
}

export async function serverAssetSearch(params: {
  query: string;
  providerId?: string;
  image_type?: string;
  orientation?: string;
  color?: string;
  per_page?: number;
}): Promise<AssetSearchResult> {
  return mohuaFetch<AssetSearchResult>('/asset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}
