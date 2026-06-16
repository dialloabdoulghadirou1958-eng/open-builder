import type { Conversation, ProjectFiles, ProjectTemplate } from "../../types";

export interface TemplateMetadataInput {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  now: number;
}

export interface TemplateStats {
  fileCount: number;
  totalBytes: number;
}

const MAX_TAGS = 8;

export function createProjectTemplateFromConversation(
  conversation: Conversation,
  input: TemplateMetadataInput,
): ProjectTemplate {
  const files = cloneProjectFiles(conversation.files);
  if (Object.keys(files).length === 0) {
    throw new Error("Cannot create a template from an empty project.");
  }

  return {
    id: input.id,
    name: sanitizeTemplateName(input.name),
    description: normalizeOptionalText(input.description),
    files,
    template: conversation.template,
    sourceConversationId: conversation.id,
    tags: normalizeTemplateTags(input.tags ?? []),
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function createConversationFromProjectTemplate(
  template: ProjectTemplate,
  input: { id: string; now: number },
): Conversation {
  return {
    id: input.id,
    title: template.name,
    messages: [],
    files: cloneProjectFiles(template.files),
    template: template.template,
    isProjectInitialized: Object.keys(template.files).length > 0,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function getProjectTemplateStats(
  template: Pick<ProjectTemplate, "files">,
): TemplateStats {
  const files = Object.values(template.files);
  return {
    fileCount: files.length,
    totalBytes: files.reduce((total, content) => total + byteLength(content), 0),
  };
}

export function normalizeTemplateTags(tags: string[]): string[] {
  const normalized = tags
    .map((tag) => tag.trim().replace(/\s+/g, " "))
    .filter(Boolean);

  return Array.from(new Set(normalized)).slice(0, MAX_TAGS);
}

export function sanitizeTemplateName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  return trimmed || "Untitled Template";
}

export function cloneProjectFiles(files: ProjectFiles): ProjectFiles {
  return { ...files };
}

function normalizeOptionalText(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}
