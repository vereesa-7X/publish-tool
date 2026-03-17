import { createId } from "@/apps/tunee/lib/utils/id";
import { readJsonFile, writeJsonFile } from "@/apps/tunee/lib/utils/json-store";
import type {
  PreferenceCategory,
  TasteMemoryItem,
  TasteProfile
} from "@/apps/tunee/lib/types/tunee";

const MEMORY_LIMIT = 14;

function now(): string {
  return new Date().toISOString();
}

function buildEmptyProfile(userId: string): TasteProfile {
  const timestamp = now();

  return {
    userId,
    displayName: "TUNEE Demo User",
    memories: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function summarizeTasteProfile(profile: TasteProfile): string {
  if (profile.memories.length === 0) {
    return "No durable taste memory yet.";
  }

  return profile.memories
    .slice(0, 6)
    .map((memory) => `${memory.category}: ${memory.summary}`)
    .join("\n");
}

export function inferPreferenceSignals(
  message: string
): Array<{
  category: PreferenceCategory;
  summary: string;
  evidence: string;
}> {
  const rules: Array<{
    pattern: RegExp;
    category: PreferenceCategory;
    summary: string;
  }> = [
    { pattern: /city\s*pop|城市流行/i, category: "genre", summary: "Leans toward city pop" },
    { pattern: /r&b|rnb/i, category: "genre", summary: "Likes R&B influenced songs" },
    { pattern: /lo-?fi/i, category: "genre", summary: "Likes lo-fi textures" },
    { pattern: /民谣|folk/i, category: "genre", summary: "Likes folk songwriting" },
    { pattern: /中文|chinese/i, category: "language", summary: "Prefers Chinese lyrics" },
    { pattern: /英文|english/i, category: "language", summary: "Prefers English lyrics" },
    { pattern: /日语|日文|japanese/i, category: "language", summary: "Prefers Japanese lyrics" },
    { pattern: /双语|bilingual/i, category: "language", summary: "Likes bilingual toplines" },
    { pattern: /女声|female vocals?/i, category: "voice", summary: "Prefers female vocals" },
    { pattern: /男声|male vocals?/i, category: "voice", summary: "Prefers male vocals" },
    { pattern: /慢一点|ballad|slow/i, category: "tempo", summary: "Likes slower tempos" },
    { pattern: /快一点|upbeat|energetic/i, category: "tempo", summary: "Likes upbeat tempos" },
    { pattern: /治愈|warm|healing/i, category: "mood", summary: "Likes warm and healing moods" },
    { pattern: /emo|伤感|melancholy/i, category: "mood", summary: "Likes emotional and melancholic moods" },
    { pattern: /不要说唱|no rap/i, category: "negative", summary: "Avoid rap sections" },
    {
      pattern: /不要太吵|less busy|not too dense/i,
      category: "negative",
      summary: "Avoid dense, noisy arrangements"
    }
  ];

  return rules
    .filter((rule) => rule.pattern.test(message))
    .map((rule) => ({
      category: rule.category,
      summary: rule.summary,
      evidence: message
    }));
}

export class TasteMemoryStore {
  async get(userId: string): Promise<TasteProfile> {
    return readJsonFile(["users", `${userId}.json`], () => buildEmptyProfile(userId));
  }

  async remember(input: {
    userId: string;
    category: PreferenceCategory;
    summary: string;
    evidence: string;
    confidence?: TasteMemoryItem["confidence"];
  }): Promise<TasteProfile> {
    const profile = await this.get(input.userId);
    const normalizedSummary = input.summary.trim();
    const timestamp = now();

    if (!normalizedSummary) {
      return profile;
    }

    const existingIndex = profile.memories.findIndex(
      (memory) =>
        memory.category === input.category &&
        memory.summary.toLowerCase() === normalizedSummary.toLowerCase()
    );

    if (existingIndex >= 0) {
      profile.memories[existingIndex] = {
        ...profile.memories[existingIndex],
        evidence: input.evidence,
        confidence: input.confidence ?? profile.memories[existingIndex].confidence,
        updatedAt: timestamp
      };
    } else {
      profile.memories.unshift({
        id: createId("memory"),
        category: input.category,
        summary: normalizedSummary,
        evidence: input.evidence,
        confidence: input.confidence ?? "medium",
        createdAt: timestamp,
        updatedAt: timestamp
      });
    }

    profile.memories = profile.memories.slice(0, MEMORY_LIMIT);
    profile.updatedAt = timestamp;
    await writeJsonFile(["users", `${input.userId}.json`], profile);
    return profile;
  }
}
