import type { DemoMode, MusicProviderMode } from "@/apps/tunee/lib/types/tunee";

export const DEMO_USER_ID = "demo-user";
export const DEMO_PROJECT_ID = "demo-project";
export const DEMO_PROJECT_TITLE = "Neon Skyline Demo";
export const DEMO_MODEL_ID = "demo/mock";
export const DEFAULT_LIVE_MODEL = "gpt-5.4";
export const MODEL_SUGGESTIONS = [
  "gpt-5.4",
  "gpt-5.3-codex",
  "gpt-5.2",
  "gpt-4.1"
];

export function normalizeModelId(value?: string | null): string {
  const raw = value?.trim();
  if (!raw) {
    return process.env.DEFAULT_MODEL_ID?.trim() || DEMO_MODEL_ID;
  }

  return raw;
}

export function toMastraModelId(modelId: string): string {
  if (modelId === DEMO_MODEL_ID) {
    return modelId;
  }

  if (modelId.startsWith("openai/")) {
    return modelId;
  }

  return `openai/${modelId}`;
}

export function resolveDemoMode(modelId: string): DemoMode {
  if (modelId === DEMO_MODEL_ID) {
    return "mock";
  }

  return process.env.OPENAI_API_KEY?.trim() ? "live" : "mock";
}

export function resolveMusicProviderMode(): MusicProviderMode {
  if (
    process.env.MOCK_MUSIC_PROVIDER === "false" &&
    process.env.MUSIC_PROVIDER_API_KEY?.trim()
  ) {
    return "real";
  }

  return "mock";
}

export function getMissingModelConfig(modelId: string): string | null {
  if (modelId === DEMO_MODEL_ID) {
    return null;
  }

  if (!process.env.OPENAI_API_KEY?.trim()) {
    return "OPENAI_API_KEY";
  }

  return null;
}
