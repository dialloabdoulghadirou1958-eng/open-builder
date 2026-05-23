// ─── Interactive tool types (ask_user_question, exit_plan_mode) ─────────────

export interface AskUserQuestion {
  question: string;
  header: string;
  multiSelect: boolean;
  options: Array<{ label: string; description: string }>;
}

export interface AskUserAnswerItem {
  question: string;
  header: string;
  selected: string[];
}

export interface AskUserAnswers {
  answers: AskUserAnswerItem[];
}

export type PlanDecision =
  | { approved: true }
  | { approved: false; feedback?: string };

// ─── Server service types ───────────────────────────────────────────────────

export interface ServerModel {
  id: string;
  displayName: string;
  maxContextTokens: number;
}

export interface SearchProvider {
  id: string;
  name: string;
  slug: string;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface AssetProvider {
  id: string;
  name: string;
  slug: string;
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
