import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { createMusicProvider } from "@/apps/tunee/lib/providers/music-provider";
import { summarizeTasteProfile, TasteMemoryStore } from "@/apps/tunee/lib/memory/taste-memory";
import {
  getLatestGeneration,
  getLatestLyrics,
  getLatestPrompt,
  ProjectStore,
  summarizeProject
} from "@/apps/tunee/lib/projects/project-store";
import { toMastraModelId } from "@/shared/config";
import { truncateText } from "@/apps/tunee/lib/utils/text";
import type { ProjectRecord, TasteProfile, TokenUsageStats } from "@/apps/tunee/lib/types/tunee";

function extractText(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }

  if (result && typeof result === "object" && "text" in result) {
    const value = result.text;
    if (typeof value === "string") {
      return value;
    }
  }

  return "The action finished, but no response text was returned.";
}

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toTokenUsageStats(value: unknown): TokenUsageStats {
  if (!value || typeof value !== "object") {
    return {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0
    };
  }

  const record = value as Record<string, unknown>;
  const promptTokens = toNumber(record.promptTokens ?? record.inputTokens);
  const completionTokens = toNumber(record.completionTokens ?? record.outputTokens);
  const totalTokens = toNumber(record.totalTokens) || promptTokens + completionTokens;
  const reasoningTokens = toNumber(record.reasoningTokens);
  const cachedInputTokens = toNumber(
    record.cachedInputTokens ?? record.cacheInputTokens
  );

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    ...(reasoningTokens > 0 ? { reasoningTokens } : {}),
    ...(cachedInputTokens > 0 ? { cachedInputTokens } : {})
  };
}

function sanitizeLyricsContent(value: string): string {
  const normalized = value.replace(/```[\s\S]*?```/g, "").trim();
  const lyricMarkers = ["[歌词]", "歌词:", "歌词：", "lyrics:", "lyrics："];
  const lowered = normalized.toLowerCase();

  for (const marker of lyricMarkers) {
    const index = lowered.indexOf(marker.toLowerCase());
    if (index >= 0) {
      return normalized.slice(index + marker.length).trim();
    }
  }

  const newline = String.fromCharCode(10);
  const carriageReturn = String.fromCharCode(13);
  const lines = normalized.replaceAll(carriageReturn, "").split(newline);
  const filteredLines: string[] = [];
  let skippingPromptBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const loweredLine = trimmed.toLowerCase();

    if (!trimmed) {
      if (!skippingPromptBlock) {
        filteredLines.push("");
      }
      continue;
    }

    if (
      loweredLine === "[music prompt]" ||
      loweredLine === "music prompt:" ||
      loweredLine === "music prompt："
    ) {
      skippingPromptBlock = true;
      continue;
    }

    if (skippingPromptBlock) {
      const looksLikeLyrics =
        trimmed.startsWith("[") || /[一-鿿]/.test(trimmed) || trimmed.includes("neon skyline");

      if (!looksLikeLyrics) {
        continue;
      }

      skippingPromptBlock = false;
    }

    filteredLines.push(line);
  }

  return filteredLines.join(newline).trim();
}

function sanitizePromptContent(value: string): string {
  const normalized = value.replace(/```[\s\S]*?```/g, "").trim();
  const newline = String.fromCharCode(10);
  const carriageReturn = String.fromCharCode(13);
  const lines = normalized.replaceAll(carriageReturn, "").split(newline);
  const promptLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const lowered = trimmed.toLowerCase();

    if (!trimmed) {
      continue;
    }

    if (
      lowered === "[歌词]" ||
      lowered === "歌词:" ||
      lowered === "歌词：" ||
      lowered === "lyrics:" ||
      lowered === "lyrics："
    ) {
      break;
    }

    promptLines.push(trimmed);
  }

  return promptLines.join(" ").replace(/\s+/g, " ").trim();
}

function buildMainInstructions(input: {
  project: ProjectRecord;
  tasteProfile: TasteProfile;
  musicProviderMode: "real" | "mock";
}): string {
  return [
    "You are TUNEE AI, an agent for music ideation and demo production.",
    "Work like a sharp creative copilot: understand the request, run the right skill, then explain what changed.",
    "Available tools:",
    "- remember_taste: store durable user preferences and dislikes.",
    "- get_project_state: retrieve the latest saved lyrics, prompt, and generation state.",
    "- write_lyrics: write or rewrite a lyric version and save it.",
    "- write_music_prompt: turn the brief or lyrics into a generation-ready music prompt.",
    "- generate_music: send the latest prompt to the music provider and save the result.",
    "Behavior rules:",
    "- When the user states stable taste, use remember_taste.",
    "- When the user asks for lyrics or lyric changes, use write_lyrics.",
    "- When the user asks for a music prompt or arrangement direction, use write_music_prompt.",
    "- When the user asks to make or generate a version, make sure a prompt exists, then use generate_music.",
    "- If you need the latest saved materials, call get_project_state before answering.",
    "- If the music provider is mock, be explicit that the render is a placeholder for tomorrow's real API.",
    "- Reply in the same language as the user unless they ask otherwise.",
    "",
    "Current user taste memory:",
    summarizeTasteProfile(input.tasteProfile),
    "",
    "Current project snapshot:",
    summarizeProject(input.project),
    "",
    `Music provider mode: ${input.musicProviderMode}`
  ].join("\n");
}

export async function runLyricsSkill(input: {
  modelId: string;
  projectTitle: string;
  brief: string;
  language?: string;
  mood?: string;
  structure?: string;
  mustInclude?: string;
  existingLyrics?: string;
  existingPrompt?: string;
  conversationHistory?: string;
  tasteSummary?: string;
}): Promise<{
  title: string;
  language: string;
  moodTags: string[];
  content: string;
  usage: TokenUsageStats;
}> {
  const agent = new Agent({
    id: "tunee-lyrics-skill",
    name: "tunee-lyrics-skill",
    instructions: [
      "You are a songwriting skill inside TUNEE AI.",
      "Write concise, singable lyrics with a clear hook.",
      "Keep the draft demo-length unless the user asks for a longer full song.",
      "If existing lyrics are provided, treat them as the source of truth and return a full updated lyric sheet.",
      "If the user asks to revise only one section, keep the rest of the song unless they ask for a full rewrite.",
      "Return lyrics only. No explanation, no markdown fences."
    ].join("\n"),
    model: toMastraModelId(input.modelId)
  });

  const prompt = [
    `Project title: ${input.projectTitle}`,
    `Brief: ${input.brief}`,
    input.language ? `Language: ${input.language}` : null,
    input.mood ? `Mood: ${input.mood}` : null,
    input.structure ? `Structure: ${input.structure}` : null,
    input.mustInclude ? `Must include: ${input.mustInclude}` : null,
    input.tasteSummary ? `User taste summary:\n${input.tasteSummary}` : null,
    input.conversationHistory ? `Recent conversation:\n${input.conversationHistory}` : null,
    input.existingPrompt ? `Current music prompt:\n${input.existingPrompt}` : null,
    input.existingLyrics
      ? `Existing lyrics to revise in full:\n${input.existingLyrics}\nReturn the complete updated lyrics, not only the changed section.`
      : null
  ]
    .filter(Boolean)
    .join("\n");

  const stream = await agent.stream(prompt);
  const result = await stream.getFullOutput();
  return {
    title: input.projectTitle,
    language: input.language || "Auto",
    moodTags: input.mood ? input.mood.split(",").map((tag) => tag.trim()) : [],
    content: sanitizeLyricsContent(extractText(result)),
    usage: toTokenUsageStats(result.usage)
  };
}

export async function runMusicPromptSkill(input: {
  modelId: string;
  projectTitle: string;
  brief: string;
  lyrics?: string;
  styleNotes?: string;
  existingPrompt?: string;
  conversationHistory?: string;
  tasteSummary?: string;
}): Promise<{
  title: string;
  content: string;
  styleTags: string[];
  usage: TokenUsageStats;
}> {
  const agent = new Agent({
    id: "tunee-music-prompt-skill",
    name: "tunee-music-prompt-skill",
    instructions: [
      "You are a music generation prompt skill inside TUNEE AI.",
      "Turn the brief and lyrics into one compact music-generation prompt.",
      "Describe only sound, vocals, mood, instrumentation, tempo, and production feel.",
      "Do not ask the music model to rewrite, translate, or adapt lyrics.",
      "Do not paste the lyrics back into the prompt.",
      "If an existing prompt is provided, rewrite it into a cleaner and shorter version instead of expanding it.",
      "Keep it under 320 characters when possible.",
      "Return the final prompt only. No explanation."
    ].join("\n"),
    model: toMastraModelId(input.modelId)
  });

  const prompt = [
    `Project title: ${input.projectTitle}`,
    `Brief: ${input.brief}`,
    input.tasteSummary ? `User taste summary:\n${input.tasteSummary}` : null,
    input.conversationHistory ? `Recent conversation:\n${input.conversationHistory}` : null,
    input.styleNotes ? `Style notes: ${input.styleNotes}` : null,
    input.existingPrompt ? `Existing prompt:\n${input.existingPrompt}` : null,
    input.lyrics ? `Lyrics:\n${input.lyrics}` : null
  ]
    .filter(Boolean)
    .join("\n\n");

  const stream = await agent.stream(prompt);
  const result = await stream.getFullOutput();
  const styleTags = input.styleNotes
    ? input.styleNotes
        .split(String.fromCharCode(10))
        .filter((line) => /^Focus tags:/i.test(line.trim()))
        .flatMap((line) => line.replace(/^Focus tags:\s*/i, "").split(","))
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 6)
    : [];

  return {
    title: input.projectTitle,
    content: sanitizePromptContent(extractText(result)),
    styleTags,
    usage: toTokenUsageStats(result.usage)
  };
}

export function createTuneeAgent(input: {
  userId: string;
  projectId: string;
  modelId: string;
  project: ProjectRecord;
  tasteProfile: TasteProfile;
  musicProviderMode: "real" | "mock";
}): Agent {
  const projectStore = new ProjectStore();
  const memoryStore = new TasteMemoryStore();
  const musicProvider = createMusicProvider();

  const rememberTasteSchema = z.object({
    category: z.enum([
      "genre",
      "mood",
      "language",
      "voice",
      "tempo",
      "structure",
      "negative",
      "workflow"
    ]),
    summary: z.string().min(3),
    evidence: z.string().min(3)
  });

  const getProjectStateSchema = z.object({
    includeLatestLyrics: z.boolean().default(true),
    includeLatestPrompt: z.boolean().default(true)
  });

  const writeLyricsSchema = z.object({
    brief: z.string().min(8),
    language: z.string().optional(),
    mood: z.string().optional(),
    structure: z.string().optional(),
    mustInclude: z.string().optional()
  });

  const writePromptSchema = z.object({
    brief: z.string().min(6),
    styleNotes: z.string().optional(),
    lyrics: z.string().optional()
  });

  const generateMusicSchema = z.object({
    title: z.string().optional(),
    prompt: z.string().optional(),
    lyrics: z.string().optional()
  });

  const rememberTaste = createTool({
    id: "remember_taste",
    description: "Store durable user preferences or dislikes for future generations.",
    inputSchema: rememberTasteSchema,
    outputSchema: z.object({
      saved: z.boolean(),
      totalMemories: z.number(),
      summary: z.string()
    }),
    execute: async (toolInput) => {
      const payload = rememberTasteSchema.parse(toolInput);
      const profile = await memoryStore.remember({
        userId: input.userId,
        category: payload.category,
        summary: payload.summary,
        evidence: payload.evidence
      });

      return {
        saved: true,
        totalMemories: profile.memories.length,
        summary: summarizeTasteProfile(profile)
      };
    }
  });

  const getProjectState = createTool({
    id: "get_project_state",
    description: "Load the latest saved lyrics, prompt, and generation state from the current project.",
    inputSchema: getProjectStateSchema,
    outputSchema: z.object({
      summary: z.string(),
      latestLyrics: z.string().nullable(),
      latestPrompt: z.string().nullable(),
      latestGeneration: z.string().nullable()
    }),
    execute: async (toolInput) => {
      getProjectStateSchema.parse(toolInput);
      const project = await projectStore.get(input.projectId);
      const latestLyrics = getLatestLyrics(project);
      const latestPrompt = getLatestPrompt(project);
      const latestGeneration = getLatestGeneration(project);

      return {
        summary: summarizeProject(project),
        latestLyrics: latestLyrics?.content ?? null,
        latestPrompt: latestPrompt?.content ?? null,
        latestGeneration: latestGeneration
          ? `${latestGeneration.status} via ${latestGeneration.provider}`
          : null
      };
    }
  });

  const writeLyrics = createTool({
    id: "write_lyrics",
    description: "Write a fresh lyric draft or rewrite lyrics for the current project.",
    inputSchema: writeLyricsSchema,
    outputSchema: z.object({
      versionId: z.string(),
      title: z.string(),
      language: z.string(),
      preview: z.string(),
      content: z.string()
    }),
    execute: async (toolInput) => {
      const payload = writeLyricsSchema.parse(toolInput);
      const project = await projectStore.get(input.projectId);
      const draft = await runLyricsSkill({
        modelId: input.modelId,
        projectTitle: project.title,
        brief: payload.brief,
        language: payload.language,
        mood: payload.mood,
        structure: payload.structure,
        mustInclude: payload.mustInclude
      });

      const saved = await projectStore.saveLyricsVersion(input.projectId, {
        title: draft.title,
        brief: payload.brief,
        content: draft.content,
        language: draft.language,
        moodTags: draft.moodTags,
        source: "mastra"
      });

      return {
        versionId: saved.id,
        title: saved.title,
        language: saved.language,
        preview: truncateText(saved.content, 220),
        content: saved.content
      };
    }
  });

  const writeMusicPrompt = createTool({
    id: "write_music_prompt",
    description:
      "Create a generation-ready music prompt from a brief, lyrics, and arrangement direction.",
    inputSchema: writePromptSchema,
    outputSchema: z.object({
      versionId: z.string(),
      title: z.string(),
      preview: z.string(),
      content: z.string()
    }),
    execute: async (toolInput) => {
      const payload = writePromptSchema.parse(toolInput);
      const project = await projectStore.get(input.projectId);
      const latestLyrics = getLatestLyrics(project);
      const draft = await runMusicPromptSkill({
        modelId: input.modelId,
        projectTitle: project.title,
        brief: payload.brief,
        styleNotes: payload.styleNotes,
        lyrics: payload.lyrics || latestLyrics?.content
      });

      const saved = await projectStore.savePromptVersion(input.projectId, {
        title: draft.title,
        brief: payload.brief,
        content: draft.content,
        styleTags: draft.styleTags,
        negativePrompt: "Avoid muddy low end and overcrowded percussion.",
        source: "mastra"
      });

      return {
        versionId: saved.id,
        title: saved.title,
        preview: truncateText(saved.content, 240),
        content: saved.content
      };
    }
  });

  const generateMusic = createTool({
    id: "generate_music",
    description:
      "Call the connected music provider with the latest prompt and optional lyric context.",
    inputSchema: generateMusicSchema,
    outputSchema: z.object({
      generationId: z.string(),
      status: z.string(),
      provider: z.string(),
      notes: z.string()
    }),
    execute: async (toolInput) => {
      const payload = generateMusicSchema.parse(toolInput);
      const project = await projectStore.get(input.projectId);
      const latestLyrics = getLatestLyrics(project);
      const latestPrompt = getLatestPrompt(project);

      const promptToUse = payload.prompt || latestPrompt?.content;
      if (!promptToUse) {
        throw new Error("No music prompt exists yet. Create one before generating music.");
      }

      const generated = await musicProvider.generateTrack({
        title: payload.title || project.title,
        prompt: promptToUse,
        lyrics: payload.lyrics || latestLyrics?.content,
        modelId: input.modelId
      });

      const saved = await projectStore.saveGeneration(input.projectId, {
        title: generated.title,
        promptVersionId: latestPrompt?.id,
        lyricVersionId: latestLyrics?.id,
        externalTaskIds: generated.externalTaskIds,
        provider: generated.provider,
        providerMode: generated.providerMode,
        status: generated.status,
        audioUrl: generated.audioUrl,
        coverImageUrl: generated.coverImageUrl,
        notes: generated.notes,
        requestSnapshot: generated.requestSnapshot
      });

      return {
        generationId: saved.id,
        status: saved.status,
        provider: saved.provider,
        notes: saved.notes
      };
    }
  });

  return new Agent({
    id: "tunee-demo-orchestrator",
    name: "tunee-demo-orchestrator",
    instructions: buildMainInstructions({
      project: input.project,
      tasteProfile: input.tasteProfile,
      musicProviderMode: input.musicProviderMode
    }),
    model: toMastraModelId(input.modelId),
    tools: {
      rememberTaste,
      getProjectState,
      writeLyrics,
      writeMusicPrompt,
      generateMusic
    }
  });
}

export async function runAssistantReplySkill(input: {
  modelId: string;
  message: string;
  projectSummary: string;
  tasteSummary: string;
  conversationHistory?: string;
  actionSummary?: string;
  onTextDelta?: (delta: string) => Promise<void> | void;
}): Promise<{
  text: string;
  usage: TokenUsageStats;
}> {
  const agent = new Agent({
    id: "tunee-assistant-reply-skill",
    name: "tunee-assistant-reply-skill",
    instructions: [
      "You are TUNEE, a music companion helping shape songs with the user.",
      "Reply in the same language as the user.",
      "Sound like a thoughtful human collaborator, not a dashboard or tool log.",
      "Vary your phrasing. Do not reuse the same opening or closing patterns every turn.",
      "Be specific, practical, and suggest the next best move only when it helps.",
      "Keep the reply compact and natural, usually one short paragraph unless more detail is clearly useful.",
      "You are only writing the short chat reply that sits above the artifacts in the UI.",
      "Never output full lyrics, full prompts, bullet lists, markdown headings, or JSON.",
      "Do not claim that you changed project state unless the completed actions are provided below."
    ].join("\n"),
    model: toMastraModelId(input.modelId)
  });

  const prompt = [
    "Current taste memory:",
    input.tasteSummary,
    "",
    "Current conversation summary:",
    input.projectSummary,
    "",
    "Recent conversation history:",
    input.conversationHistory || "No previous messages.",
    "",
    "Actions completed this turn:",
    input.actionSummary || "None.",
    "",
    "Latest user message:",
    input.message
  ].join("\n");

  const stream = await agent.stream(prompt);
  let streamedText = "";

  if (input.onTextDelta) {
    for await (const chunk of stream.textStream) {
      if (!chunk) {
        continue;
      }

      if (streamedText.length < 260) {
        const remaining = 260 - streamedText.length;
        const safeChunk = chunk.slice(0, remaining);
        if (safeChunk) {
          streamedText += safeChunk;
          await input.onTextDelta(safeChunk);
        }
      }
    }
  }

  const usage = toTokenUsageStats(await stream.usage);
  const normalizedStreamedText = streamedText.trim();
  if (normalizedStreamedText) {
    return {
      text: truncateText(normalizedStreamedText, 260),
      usage
    };
  }

  const result = await stream.getFullOutput();
  const reply = truncateText(extractText(result).replace(/\s+/g, " ").trim(), 260);

  if (input.onTextDelta && reply) {
    await input.onTextDelta(reply);
  }

  return {
    text: reply,
    usage: toTokenUsageStats(result.usage ?? usage)
  };
}

export function extractAgentReply(result: unknown): string {
  return extractText(result);
}
