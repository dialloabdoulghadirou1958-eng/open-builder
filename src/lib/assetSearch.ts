import { tool } from "ai";
import { z } from "zod";
import { type AssetSearchSettings, SERVER_ENGINE } from "../store/settings";
import { serverAssetSearch } from "./mohua-api";
import { toolResult } from "./toolResult";

export const ASSET_SEARCH_TOOLS = {
  image_search: tool({
    description:
      "Search for high-quality stock images using keywords. " +
      "Returns image URLs, thumbnails, and metadata. " +
      "Use this when you need real photos or illustrations for the application.",
    inputSchema: z.object({
      query: z.string().describe("Search keywords for images"),
      image_type: z
        .enum(["all", "photo", "illustration", "vector"])
        .optional()
        .describe("Type of image (default: all)"),
      orientation: z
        .enum(["all", "horizontal", "vertical"])
        .optional()
        .describe("Image orientation (default: all)"),
      color: z
        .enum(["black", "white", "yellow", "orange", "red", "green", "blue"])
        .optional()
        .describe("Filter by color (optional, Unsplash only)"),
      per_page: z
        .number()
        .optional()
        .describe("Number of results (default: 10, max: 20)"),
    }),
  }),
};

async function pixabaySearch(
  settings: AssetSearchSettings,
  query: string,
  imageType: string = "all",
  orientation: string = "all",
  color?: string,
  perPage: number = 10,
): Promise<string> {
  const baseUrl = settings.pixabayApiUrl || "https://pixabay.com/api";
  const params = new URLSearchParams({
    key: settings.pixabayApiKey,
    q: query,
    image_type: imageType,
    orientation: orientation,
    per_page: Math.min(perPage, 20).toString(),
  });
  if (color) params.append("colors", color);

  const res = await fetch(`${baseUrl}/?${params}`);
  if (!res.ok) {
    const text = await res.text();
    return JSON.stringify({
      ok: false,
      error: `Pixabay search failed (${res.status}): ${text}`,
    });
  }

  const data = await res.json();
  return JSON.stringify({
    ok: true,
    images: (data.hits ?? []).map((img: any) => ({
      url: `https://i0.wp.com/${img.webformatURL.replace(/^https?:\/\//, "")}`,
      thumbnail: `https://i0.wp.com/${img.previewURL.replace(/^https?:\/\//, "")}`,
      width: img.webformatWidth,
      height: img.webformatHeight,
      description: img.tags,
    })),
  });
}

async function unsplashSearch(
  settings: AssetSearchSettings,
  query: string,
  orientation: string = "all",
  color?: string,
  perPage: number = 10,
): Promise<string> {
  const baseUrl = settings.unsplashApiUrl || "https://api.unsplash.com";
  const params = new URLSearchParams({
    query,
    client_id: settings.unsplashApiKey,
    per_page: Math.min(perPage, 20).toString(),
  });

  if (orientation === "horizontal") params.append("orientation", "landscape");
  if (orientation === "vertical") params.append("orientation", "portrait");
  if (color) params.append("color", color);

  const res = await fetch(`${baseUrl}/search/photos?${params}`);
  if (!res.ok) {
    const text = await res.text();
    return JSON.stringify({
      ok: false,
      error: `Unsplash search failed (${res.status}): ${text}`,
    });
  }

  const data = await res.json();
  return JSON.stringify({
    ok: true,
    images: (data.results ?? []).map((img: any) => ({
      url: img.urls.regular,
      thumbnail: img.urls.thumb,
      width: 1080,
      height: Math.round((1080 * img.height) / img.width),
      description: img.description || img.alt_description || "",
    })),
  });
}

export function createAssetSearchToolHandler(
  settings: AssetSearchSettings,
): (name: string, args: unknown) => Promise<string> {
  return async (name: string, args: unknown): Promise<string> => {
    const a = args as Record<string, any>;
    const engine = settings.engine;

    if (engine === "pixabay" && name === "image_search") {
      return pixabaySearch(
        settings,
        a.query,
        a.image_type,
        a.orientation,
        a.color,
        a.per_page,
      );
    }

    if (engine === "unsplash" && name === "image_search") {
      return unsplashSearch(
        settings,
        a.query,
        a.orientation,
        a.color,
        a.per_page,
      );
    }

    if (engine === SERVER_ENGINE && name === "image_search") {
      return toolResult(
        serverAssetSearch({
          query: a.query,
          providerId: settings.backendProvider,
          image_type: a.image_type,
          orientation: a.orientation,
          color: a.color,
          per_page: a.per_page,
        }),
        (res) => ({ ...res }),
      );
    }

    return `Error: unknown tool "${name}" or engine "${engine}"`;
  };
}
