export type MessageRole = "user" | "assistant";

export type PreferenceCategory =
  | "genre"
  | "mood"
  | "language"
  | "voice"
  | "tempo"
  | "structure"
  | "negative"
  | "workflow";

export type GenerationStatus = "queued" | "completed" | "failed";
export type TraceStatus = "running" | "completed";
export type DemoMode = "live" | "mock";
export type MusicProviderMode = "real" | "mock";

export interface TextMessagePart {
  id: string;
  type: "text";
  text: string;
}

export interface LyricsMessagePart {
  id: string;
  type: "lyrics";
  title: string;
  content: string;
  language: string;
  moodTags: string[];
  versionId?: string;
}

export interface PromptMessagePart {
  id: string;
  type: "prompt";
  title: string;
  content: string;
  styleTags: string[];
  negativePrompt?: string;
  versionId?: string;
}

export interface AudioMessagePart {
  id: string;
  type: "audio";
  title: string;
  generationId: string;
  status: GenerationStatus;
  provider: string;
  providerMode: MusicProviderMode;
  notes: string;
  audioUrl?: string | null;
  coverImageUrl?: string | null;
}

export interface SkillsMessagePart {
  id: string;
  type: "skills";
  title: string;
  items: string[];
}

export type MessagePart =
  | TextMessagePart
  | LyricsMessagePart
  | PromptMessagePart
  | AudioMessagePart
  | SkillsMessagePart;

export interface ChatMessage {
  id: string;
  role: MessageRole;
  parts: MessagePart[];
  createdAt: string;
  modelId?: string;
}

export interface TasteMemoryItem {
  id: string;
  category: PreferenceCategory;
  summary: string;
  evidence: string;
  confidence: "low" | "medium" | "high";
  createdAt: string;
  updatedAt: string;
}

export interface TasteProfile {
  userId: string;
  displayName: string;
  memories: TasteMemoryItem[];
  createdAt: string;
  updatedAt: string;
}

export interface LyricVersion {
  id: string;
  title: string;
  brief: string;
  content: string;
  language: string;
  moodTags: string[];
  createdAt: string;
  source: "mastra" | "mock";
}

export interface MusicPromptVersion {
  id: string;
  title: string;
  brief: string;
  content: string;
  styleTags: string[];
  negativePrompt?: string;
  createdAt: string;
  source: "mastra" | "mock";
}

export interface MusicGeneration {
  id: string;
  title: string;
  promptVersionId?: string;
  lyricVersionId?: string;
  externalTaskIds?: string[];
  provider: string;
  providerMode: MusicProviderMode;
  status: GenerationStatus;
  audioUrl?: string | null;
  coverImageUrl?: string | null;
  notes: string;
  requestSnapshot: {
    modelId: string;
    prompt: string;
    lyrics?: string;
  };
  createdAt: string;
}

export interface ConversationRecord {
  id: string;
  userId: string;
  title: string;
  summary: string;
  messages: ChatMessage[];
  lyricVersions: LyricVersion[];
  promptVersions: MusicPromptVersion[];
  generations: MusicGeneration[];
  createdAt: string;
  updatedAt: string;
}

export type ProjectRecord = ConversationRecord;

export interface ConversationSummary {
  id: string;
  title: string;
  summary: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
  hasQueuedGeneration: boolean;
}

export interface SkillCard {
  id: string;
  name: string;
  summary: string;
  output: string;
}

export interface DemoBootstrap {
  userId: string;
  conversations: ConversationSummary[];
  activeConversationId: string;
  conversation: ConversationRecord;
  tasteProfile: TasteProfile;
  suggestedModels: string[];
  selectedModelId: string;
  mode: DemoMode;
  musicProviderMode: MusicProviderMode;
}

export interface ChatResponse extends DemoBootstrap {
  reply: string;
  warnings: string[];
}

export interface TokenUsageStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
}

export interface ChatTraceEvent {
  type: "trace";
  key: string;
  label: string;
  status: TraceStatus;
  detail?: string;
}

export interface ChatUsageEvent {
  type: "usage";
  key: string;
  label: string;
  usage: TokenUsageStats;
  cumulative: TokenUsageStats;
}

export interface ChatReplyDeltaEvent {
  type: "reply_delta";
  delta: string;
}

export interface ChatFinalEvent {
  type: "final";
  data: ChatResponse;
}

export interface ChatErrorEvent {
  type: "error";
  error: string;
}

export type ChatStreamEvent =
  | ChatTraceEvent
  | ChatUsageEvent
  | ChatReplyDeltaEvent
  | ChatFinalEvent
  | ChatErrorEvent;
