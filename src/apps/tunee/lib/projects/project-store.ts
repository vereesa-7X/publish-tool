import { readdir } from "node:fs/promises";
import path from "node:path";
import { createId } from "@/apps/tunee/lib/utils/id";
import { readJsonFile, writeJsonFile } from "@/apps/tunee/lib/utils/json-store";
import type {
  AudioMessagePart,
  ChatMessage,
  ConversationRecord,
  ConversationSummary,
  LyricVersion,
  MessagePart,
  MessageRole,
  MusicGeneration,
  MusicPromptVersion,
  ProjectRecord,
  TextMessagePart
} from "@/apps/tunee/lib/types/tunee";

const CONVERSATIONS_DIR = path.join(process.cwd(), ".demo-data", "conversations");
const MAX_MESSAGES = 48;

function now(): string {
  return new Date().toISOString();
}

function buildTextPart(text: string, id = createId("part")): TextMessagePart {
  return {
    id,
    type: "text",
    text
  };
}

function buildEmptyConversation(
  userId: string,
  conversationId: string,
  title: string
): ConversationRecord {
  const timestamp = now();

  return {
    id: conversationId,
    userId,
    title,
    summary: "",
    messages: [],
    lyricVersions: [],
    promptVersions: [],
    generations: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function normalizeMessagePart(part: unknown): MessagePart | null {
  if (!part || typeof part !== "object") {
    return null;
  }

  if (!("type" in part) || typeof part.type !== "string") {
    return null;
  }

  const id = "id" in part && typeof part.id === "string" ? part.id : createId("part");

  if (part.type === "text") {
    const text = "text" in part && typeof part.text === "string" ? part.text : "";
    if (!text.trim()) {
      return null;
    }

    return {
      id,
      type: "text",
      text
    };
  }

  if (part.type === "lyrics") {
    const title = "title" in part && typeof part.title === "string" ? part.title : "Lyrics";
    const content =
      "content" in part && typeof part.content === "string" ? part.content : "";

    return {
      id,
      type: "lyrics",
      title,
      content,
      language:
        "language" in part && typeof part.language === "string" ? part.language : "Auto",
      moodTags:
        "moodTags" in part && Array.isArray(part.moodTags)
          ? part.moodTags.filter((tag): tag is string => typeof tag === "string")
          : [],
      versionId:
        "versionId" in part && typeof part.versionId === "string"
          ? part.versionId
          : undefined
    };
  }

  if (part.type === "prompt") {
    const title = "title" in part && typeof part.title === "string" ? part.title : "Prompt";
    const content =
      "content" in part && typeof part.content === "string" ? part.content : "";

    return {
      id,
      type: "prompt",
      title,
      content,
      styleTags:
        "styleTags" in part && Array.isArray(part.styleTags)
          ? part.styleTags.filter((tag): tag is string => typeof tag === "string")
          : [],
      negativePrompt:
        "negativePrompt" in part && typeof part.negativePrompt === "string"
          ? part.negativePrompt
          : undefined,
      versionId:
        "versionId" in part && typeof part.versionId === "string"
          ? part.versionId
          : undefined
    };
  }

  if (part.type === "audio") {
    const title =
      "title" in part && typeof part.title === "string" ? part.title : "Generated Track";

    return {
      id,
      type: "audio",
      title,
      generationId:
        "generationId" in part && typeof part.generationId === "string"
          ? part.generationId
          : createId("gen"),
      status:
        "status" in part &&
        (part.status === "queued" || part.status === "completed" || part.status === "failed")
          ? part.status
          : "queued",
      provider:
        "provider" in part && typeof part.provider === "string"
          ? part.provider
          : "unknown-provider",
      providerMode:
        "providerMode" in part && (part.providerMode === "real" || part.providerMode === "mock")
          ? part.providerMode
          : "mock",
      notes: "notes" in part && typeof part.notes === "string" ? part.notes : "",
      audioUrl:
        "audioUrl" in part && typeof part.audioUrl === "string" ? part.audioUrl : null,
      coverImageUrl:
        "coverImageUrl" in part && typeof part.coverImageUrl === "string"
          ? part.coverImageUrl
          : null
    };
  }

  if (part.type === "skills") {
    return {
      id,
      type: "skills",
      title: "title" in part && typeof part.title === "string" ? part.title : "Skills used",
      items:
        "items" in part && Array.isArray(part.items)
          ? part.items.filter((item): item is string => typeof item === "string")
          : []
    };
  }

  return null;
}

function normalizeChatMessage(message: unknown): ChatMessage | null {
  if (!message || typeof message !== "object") {
    return null;
  }

  const createdAt =
    "createdAt" in message && typeof message.createdAt === "string"
      ? message.createdAt
      : now();
  const role: MessageRole =
    "role" in message && message.role === "user" ? "user" : "assistant";
  const parts =
    "parts" in message && Array.isArray(message.parts)
      ? message.parts
          .map((part) => normalizeMessagePart(part))
          .filter((part): part is MessagePart => Boolean(part))
      : "content" in message && typeof message.content === "string"
        ? [buildTextPart(message.content)]
        : [];

  if (parts.length === 0) {
    return null;
  }

  return {
    id: "id" in message && typeof message.id === "string" ? message.id : createId("msg"),
    role,
    parts,
    createdAt,
    modelId:
      "modelId" in message && typeof message.modelId === "string"
        ? message.modelId
        : undefined
  };
}

function getLatestMessagePreview(message: ChatMessage | undefined): string {
  if (!message) {
    return "";
  }

  const textPart = message.parts.find((part) => part.type === "text");
  if (textPart && textPart.type === "text") {
    return compactText(textPart.text, 80);
  }

  const audioPart = message.parts.find((part) => part.type === "audio");
  if (audioPart && audioPart.type === "audio") {
    if (audioPart.status === "completed") {
      return `音频已就绪：${audioPart.title}`;
    }

    if (audioPart.status === "failed") {
      return `生成失败：${audioPart.title}`;
    }

    return `生成中：${audioPart.title}`;
  }

  const promptPart = message.parts.find((part) => part.type === "prompt");
  if (promptPart && promptPart.type === "prompt") {
    return `Prompt：${promptPart.title}`;
  }

  const lyricsPart = message.parts.find((part) => part.type === "lyrics");
  if (lyricsPart && lyricsPart.type === "lyrics") {
    return `歌词：${lyricsPart.title}`;
  }

  const skillsPart = message.parts.find((part) => part.type === "skills");
  if (skillsPart && skillsPart.type === "skills") {
    return `技能：${skillsPart.items.join(", ")}`;
  }

  return "";
}

function compactText(text: string, limit: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}...`;
}

function deriveConversationTitle(text: string): string {
  const normalized = text
    .replace(/^[\s\u3000]+/, "")
    .replace(/^(帮我|请你|我想|想要|可以帮我|先帮我)/, "")
    .replace(/[\r\n]+/g, " ")
    .trim();

  if (!normalized) {
    return "新对话";
  }

  const title = compactText(normalized, 22);
  return title || "新对话";
}

function normalizeConversationRecord(
  raw: unknown,
  fallback: ConversationRecord
): ConversationRecord {
  if (!raw || typeof raw !== "object") {
    return fallback;
  }

  const messages =
    "messages" in raw && Array.isArray(raw.messages)
      ? raw.messages
          .map((message) => normalizeChatMessage(message))
          .filter((message): message is ChatMessage => Boolean(message))
      : [];

  return {
    id: "id" in raw && typeof raw.id === "string" ? raw.id : fallback.id,
    userId: "userId" in raw && typeof raw.userId === "string" ? raw.userId : fallback.userId,
    title: "title" in raw && typeof raw.title === "string" ? raw.title : fallback.title,
    summary:
      "summary" in raw && typeof raw.summary === "string"
        ? raw.summary
        : "brief" in raw && typeof raw.brief === "string"
          ? raw.brief
          : fallback.summary,
    messages,
    lyricVersions:
      "lyricVersions" in raw && Array.isArray(raw.lyricVersions) ? raw.lyricVersions : [],
    promptVersions:
      "promptVersions" in raw && Array.isArray(raw.promptVersions)
        ? raw.promptVersions
        : [],
    generations:
      "generations" in raw && Array.isArray(raw.generations) ? raw.generations : [],
    createdAt:
      "createdAt" in raw && typeof raw.createdAt === "string"
        ? raw.createdAt
        : fallback.createdAt,
    updatedAt:
      "updatedAt" in raw && typeof raw.updatedAt === "string"
        ? raw.updatedAt
        : fallback.updatedAt
  };
}

function syncGenerationIntoMessages(
  messages: ChatMessage[],
  generation: MusicGeneration
): ChatMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) => {
      if (part.type !== "audio" || part.generationId !== generation.id) {
        return part;
      }

      const updatedPart: AudioMessagePart = {
        ...part,
        title: generation.title,
        status: generation.status,
        provider: generation.provider,
        providerMode: generation.providerMode,
        notes: generation.notes,
        audioUrl: generation.audioUrl,
        coverImageUrl: generation.coverImageUrl
      };

      return updatedPart;
    })
  }));
}

function buildConversationSummary(record: ConversationRecord): ConversationSummary {
  return {
    id: record.id,
    title: record.title,
    summary: record.summary || "和 TUNEE 开一个新的歌的方向。",
    preview: getLatestMessagePreview(record.messages.at(-1)) || record.summary,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    hasQueuedGeneration: record.generations.some((generation) => generation.status === "queued")
  };
}

function conversationFileSegments(conversationId: string): string[] {
  return ["conversations", `${conversationId}.json`];
}

function isBlankTitle(title: string): boolean {
  return !title.trim() || /^(new chat|新对话)$/i.test(title.trim());
}

async function tryLoadLegacyProject(
  userId: string,
  projectId: string,
  title: string
): Promise<ConversationRecord | null> {
  try {
    const legacyProject = await readJsonFile<ProjectRecord>(
      ["projects", `${projectId}.json`],
      () => {
        throw new Error("missing legacy project");
      }
    );

    return normalizeConversationRecord(
      legacyProject,
      buildEmptyConversation(userId, projectId, legacyProject.title || title)
    );
  } catch {
    return null;
  }
}

export function getLatestLyrics(project: ProjectRecord): LyricVersion | null {
  return project.lyricVersions.at(-1) ?? null;
}

export function getLatestPrompt(project: ProjectRecord): MusicPromptVersion | null {
  return project.promptVersions.at(-1) ?? null;
}

export function getLatestGeneration(project: ProjectRecord): MusicGeneration | null {
  return project.generations.at(-1) ?? null;
}

export function summarizeProject(project: ProjectRecord): string {
  const latestLyrics = getLatestLyrics(project);
  const latestPrompt = getLatestPrompt(project);
  const latestGeneration = getLatestGeneration(project);

  return [
    `Conversation title: ${project.title}`,
    `Summary: ${project.summary || "No summary yet."}`,
    latestLyrics
      ? `Latest lyrics: ${latestLyrics.title} (${latestLyrics.language})`
      : "Latest lyrics: none",
    latestPrompt ? `Latest music prompt: ${latestPrompt.title}` : "Latest music prompt: none",
    latestGeneration
      ? `Latest generation: ${latestGeneration.status} via ${latestGeneration.provider}`
      : "Latest generation: none"
  ].join("\n");
}

export function summarizeConversationHistory(
  project: ProjectRecord,
  limit = 8
): string {
  const recentMessages = project.messages.slice(-limit);

  if (recentMessages.length === 0) {
    return "No previous messages in this conversation.";
  }

  return recentMessages
    .map((message) => {
      const parts = message.parts.map((part) => {
        if (part.type === "text") {
          return compactText(part.text, 180);
        }

        if (part.type === "lyrics") {
          return `Lyrics card: ${part.title}`;
        }

        if (part.type === "prompt") {
          return `Prompt card: ${part.title}`;
        }

        if (part.type === "skills") {
          return `Skills used: ${part.items.join(", ")}`;
        }

        if (part.status === "completed") {
          return `Audio card: ${part.title} is ready.`;
        }

        return `Audio card: ${part.title} is ${part.status}.`;
      });

      return `${message.role === "assistant" ? "TUNEE" : "User"}: ${parts.join(" | ")}`;
    })
    .join("\n");
}

export class ProjectStore {
  async ensureProject(input: {
    userId: string;
    projectId: string;
    title: string;
  }): Promise<ProjectRecord> {
    try {
      const existing = await this.get(input.projectId);

      if (input.title.trim() && isBlankTitle(existing.title)) {
        return this.updateMetadata({
          projectId: input.projectId,
          title: input.title
        });
      }

      return existing;
    } catch {
      const legacyProject = await tryLoadLegacyProject(
        input.userId,
        input.projectId,
        input.title
      );

      const conversation =
        legacyProject ?? buildEmptyConversation(input.userId, input.projectId, input.title);

      await writeJsonFile(conversationFileSegments(input.projectId), conversation);
      return conversation;
    }
  }

  async createConversation(input: {
    userId: string;
    title?: string;
  }): Promise<ProjectRecord> {
    const conversationId = createId("conv");
    const conversation = buildEmptyConversation(
      input.userId,
      conversationId,
      input.title?.trim() || "新对话"
    );

    await writeJsonFile(conversationFileSegments(conversationId), conversation);
    return conversation;
  }

  async listConversations(userId: string): Promise<ConversationSummary[]> {
    let fileNames: string[] = [];

    try {
      fileNames = await readdir(CONVERSATIONS_DIR);
    } catch {
      return [];
    }

    const records = await Promise.all(
      fileNames
        .filter((fileName) => fileName.endsWith(".json"))
        .map(async (fileName) => {
          const conversationId = fileName.replace(/\.json$/, "");
          try {
            const record = await this.get(conversationId);
            return record.userId === userId ? record : null;
          } catch {
            return null;
          }
        })
    );

    return records
      .filter((record): record is ProjectRecord => Boolean(record))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((record) => buildConversationSummary(record));
  }

  async get(projectId: string): Promise<ProjectRecord> {
    const raw = await readJsonFile<unknown>(conversationFileSegments(projectId), () => {
      throw new Error(`Conversation ${projectId} has not been created yet.`);
    });

    return normalizeConversationRecord(raw, buildEmptyConversation("demo-user", projectId, "新对话"));
  }

  async updateMetadata(input: {
    projectId: string;
    title?: string;
    summary?: string;
  }): Promise<ProjectRecord> {
    const project = await this.get(input.projectId);

    if (typeof input.title === "string" && input.title.trim()) {
      project.title = input.title.trim();
    }

    if (typeof input.summary === "string") {
      project.summary = input.summary.trim();
    }

    project.updatedAt = now();
    await writeJsonFile(conversationFileSegments(input.projectId), project);
    return project;
  }

  async appendMessage(input: {
    projectId: string;
    role: MessageRole;
    content?: string;
    parts?: MessagePart[];
    modelId?: string;
  }): Promise<ChatMessage> {
    const project = await this.get(input.projectId);
    const parts =
      input.parts && input.parts.length > 0
        ? input.parts.map((part) => normalizeMessagePart(part)).filter((part): part is MessagePart => Boolean(part))
        : input.content?.trim()
          ? [buildTextPart(input.content.trim())]
          : [];

    if (parts.length === 0) {
      throw new Error("Cannot append an empty message.");
    }

    const message: ChatMessage = {
      id: createId("msg"),
      role: input.role,
      parts,
      createdAt: now(),
      modelId: input.modelId
    };

    project.messages.push(message);
    project.messages = project.messages.slice(-MAX_MESSAGES);

    if (input.role === "user") {
      const firstText = parts.find((part): part is TextMessagePart => part.type === "text");
      if (firstText) {
        if (isBlankTitle(project.title)) {
          project.title = deriveConversationTitle(firstText.text);
        }

        if (!project.summary.trim()) {
          project.summary = compactText(firstText.text, 96);
        }
      }
    }

    project.updatedAt = now();
    await writeJsonFile(conversationFileSegments(input.projectId), project);
    return message;
  }

  async saveLyricsVersion(
    projectId: string,
    input: Omit<LyricVersion, "id" | "createdAt">
  ): Promise<LyricVersion> {
    const project = await this.get(projectId);
    const version: LyricVersion = {
      ...input,
      id: createId("lyrics"),
      createdAt: now()
    };

    project.lyricVersions.push(version);
    if (!project.summary.trim() && input.brief.trim()) {
      project.summary = compactText(input.brief, 96);
    }
    project.updatedAt = now();
    await writeJsonFile(conversationFileSegments(projectId), project);
    return version;
  }

  async savePromptVersion(
    projectId: string,
    input: Omit<MusicPromptVersion, "id" | "createdAt">
  ): Promise<MusicPromptVersion> {
    const project = await this.get(projectId);
    const version: MusicPromptVersion = {
      ...input,
      id: createId("prompt"),
      createdAt: now()
    };

    project.promptVersions.push(version);
    if (!project.summary.trim() && input.brief.trim()) {
      project.summary = compactText(input.brief, 96);
    }
    project.updatedAt = now();
    await writeJsonFile(conversationFileSegments(projectId), project);
    return version;
  }

  async saveGeneration(
    projectId: string,
    input: Omit<MusicGeneration, "id" | "createdAt">
  ): Promise<MusicGeneration> {
    const project = await this.get(projectId);
    const generation: MusicGeneration = {
      ...input,
      id: createId("gen"),
      createdAt: now()
    };

    project.generations.push(generation);
    project.updatedAt = now();
    await writeJsonFile(conversationFileSegments(projectId), project);
    return generation;
  }

  async updateGeneration(
    projectId: string,
    generationId: string,
    patch: Partial<MusicGeneration>
  ): Promise<MusicGeneration> {
    const project = await this.get(projectId);
    const index = project.generations.findIndex(
      (generation) => generation.id === generationId
    );

    if (index < 0) {
      throw new Error(`Generation ${generationId} was not found.`);
    }

    project.generations[index] = {
      ...project.generations[index],
      ...patch
    };
    project.messages = syncGenerationIntoMessages(project.messages, project.generations[index]);
    project.updatedAt = now();
    await writeJsonFile(conversationFileSegments(projectId), project);
    return project.generations[index];
  }
}
