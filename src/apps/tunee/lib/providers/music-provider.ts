import { resolveMusicProviderMode } from "@/shared/config";
import { ProjectStore } from "@/apps/tunee/lib/projects/project-store";
import type { MusicGeneration, MusicProviderMode } from "@/apps/tunee/lib/types/tunee";

interface GenerateTrackInput {
  title: string;
  prompt: string;
  lyrics?: string;
  styleTags?: string[];
  negativePrompt?: string;
  modelId: string;
}

interface GeneratedTrack {
  title: string;
  externalTaskIds?: string[];
  provider: string;
  providerMode: MusicProviderMode;
  status: MusicGeneration["status"];
  audioUrl?: string | null;
  coverImageUrl?: string | null;
  notes: string;
  requestSnapshot: MusicGeneration["requestSnapshot"];
}

interface PolledTrack {
  status: MusicGeneration["status"];
  audioUrl?: string | null;
  coverImageUrl?: string | null;
  notes: string;
}

interface MusicProvider {
  generateTrack(input: GenerateTrackInput): Promise<GeneratedTrack>;
  pollTask(taskId: string): Promise<PolledTrack>;
}

function extractTaskIds(payload: unknown): string[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }

      if (entry && typeof entry === "object" && "task_id" in entry) {
        const value = entry.task_id;
        if (typeof value === "string") {
          return value;
        }
      }

      return null;
    })
    .filter((entry): entry is string => Boolean(entry));
}

function toGenerationStatus(rawState?: string): MusicGeneration["status"] {
  const state = rawState?.toLowerCase();

  if (!state) {
    return "queued";
  }

  if (["success", "succeeded", "complete", "completed"].includes(state)) {
    return "completed";
  }

  if (["failed", "error"].includes(state)) {
    return "failed";
  }

  return "queued";
}

function normalizeStyleTags(tags?: string[]): string | undefined {
  const deduped = Array.from(
    new Map(
      (tags ?? [])
        .map((tag) => tag.replace(/^[A-Za-z ]+:\s*/, "").trim())
        .filter(Boolean)
        .map((tag) => [tag.toLowerCase(), tag] as const)
    ).values()
  );
  const normalized = deduped.join(", ");

  return normalized || undefined;
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function clampText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return value.slice(0, maxLength).trim();
}

function buildStylePrompt(input: GenerateTrackInput): string | undefined {
  const normalizedTags = normalizeStyleTags(input.styleTags);
  const rawPrompt = input.prompt
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/Title:.*$/gim, " ")
    .replace(/Refine from current prompt:\s*/gi, " ")
    .replace(/Use these lyrics:[\s\S]*/gi, " ")
    .replace(/Lyrics anchor:[\s\S]*/gi, " ")
    .replace(/[“”]/g, '"');

  const segments = rawPrompt
    .replace(/[.;]+/g, String.fromCharCode(10))
    .split(String.fromCharCode(10))
    .map((segment) => compactWhitespace(segment))
    .map((segment) =>
      segment.replace(/^(style|sound|voice|arrangement|mix goals?|structure|tempo)\s*:\s*/i, "")
    )
    .filter(Boolean)
    .filter(
      (segment) =>
        !/(rewrite|adapt|translate|provided lyrics|paste the lyrics|use these lyrics|lyrics anchor)/i.test(
          segment
        )
    )
    .filter(
      (segment) =>
        /(female|male|vocal|city pop|pop|r&b|synth|bass|drums|guitar|piano|rhodes|groove|romantic|cinematic|warm|glossy|retro|80s|night|tempo|bpm|urban|nostalgic|airy|polish|funk|disco)/i.test(
          segment
        )
    );

  const uniqueSegments = Array.from(
    new Set([normalizedTags, ...segments].filter((segment): segment is string => Boolean(segment)))
  );
  const compactPrompt = clampText(uniqueSegments.join(", "), 260);

  if (compactPrompt) {
    return compactPrompt;
  }

  const fallbackPrompt = clampText(compactWhitespace(rawPrompt), 260);
  return fallbackPrompt || normalizedTags;
}

class MockMusicProvider implements MusicProvider {
  async generateTrack(input: GenerateTrackInput): Promise<GeneratedTrack> {
    const seed = Date.now();

    return {
      title: input.title,
      externalTaskIds: [`mock-${seed}-1`, `mock-${seed}-2`],
      provider: "mock-music-provider",
      providerMode: "mock",
      status: "completed",
      audioUrl: null,
      coverImageUrl: null,
      notes:
        "演示模式下这次生成会返回两首候选版本。接入真实音乐 API 后，这里会变成真实的音频任务。",
      requestSnapshot: {
        modelId: input.modelId,
        prompt: input.prompt,
        lyrics: input.lyrics
      }
    };
  }

  async pollTask(): Promise<PolledTrack> {
    return {
      status: "completed",
      audioUrl: null,
      coverImageUrl: null,
      notes: "演示模式下的生成始终会立即完成。"
    };
  }
}

class DuomiMusicProvider implements MusicProvider {
  private readonly baseUrl =
    process.env.MUSIC_PROVIDER_BASE_URL?.trim() || "https://api.wike.cc";

  private get headers(): HeadersInit {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.MUSIC_PROVIDER_API_KEY ?? ""}`
    };
  }

  async generateTrack(input: GenerateTrackInput): Promise<GeneratedTrack> {
    const lyrics = input.lyrics?.trim();
    const customMode = Boolean(lyrics);
    const stylePrompt = buildStylePrompt(input);
    const payload = {
      mv: process.env.MUSIC_PROVIDER_MODEL?.trim() || "chirp-v4-5",
      custom_mode: customMode ? 1 : 0,
      make_instrumental: false,
      title: input.title,
      prompt: customMode ? lyrics : stylePrompt || input.prompt,
      tags: customMode ? stylePrompt : normalizeStyleTags(input.styleTags),
      negative_tags: input.negativePrompt || undefined,
      metadata: customMode
        ? {
            create_mode: "custom"
          }
        : undefined
    };

    const response = await fetch(`${this.baseUrl}/api/suno/generate`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Duomi generate failed with ${response.status}.`);
    }

    const data = (await response.json()) as {
      code?: number;
      msg?: string;
      data?: unknown;
    };

    const taskIds = extractTaskIds(data.data);
    const hasTasks = taskIds.length > 0;

    return {
      title: input.title,
      externalTaskIds: taskIds,
      provider: "duomi-suno",
      providerMode: "real",
      status: hasTasks ? "queued" : "failed",
      audioUrl: null,
      coverImageUrl: null,
      notes: hasTasks
        ? customMode
          ? `Submitted ${taskIds.length} task(s) in custom mode with separate lyrics and style prompt.`
          : `Submitted ${taskIds.length} inspiration task(s).`
        : data.msg || "No task id was returned by the provider.",
      requestSnapshot: {
        modelId: input.modelId,
        prompt: stylePrompt || input.prompt,
        lyrics: input.lyrics
      }
    };
  }

  async pollTask(taskId: string): Promise<PolledTrack> {
    const url = new URL(`${this.baseUrl}/api/suno/feed`);
    url.searchParams.set("task_id", taskId);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${process.env.MUSIC_PROVIDER_API_KEY ?? ""}`
      }
    });

    if (!response.ok) {
      throw new Error(`Duomi feed lookup failed with ${response.status}.`);
    }

    const data = (await response.json()) as {
      msg?: string;
      data?: {
        state?: string;
        audio_url?: string;
        image_url?: string;
        title?: string;
        msg?: string;
      };
    };

    return {
      status: toGenerationStatus(data.data?.state),
      audioUrl: data.data?.audio_url ?? null,
      coverImageUrl: data.data?.image_url ?? null,
      notes: data.data?.msg || data.msg || data.data?.title || "Provider status refreshed."
    };
  }
}

export function createMusicProvider(): MusicProvider {
  if (
    resolveMusicProviderMode() === "real" &&
    process.env.MUSIC_PROVIDER_API_KEY?.trim()
  ) {
    return new DuomiMusicProvider();
  }

  return new MockMusicProvider();
}

export async function refreshQueuedGenerations(projectId: string): Promise<void> {
  if (resolveMusicProviderMode() !== "real") {
    return;
  }

  const provider = createMusicProvider();
  const projectStore = new ProjectStore();
  const project = await projectStore.get(projectId);

  for (const generation of project.generations) {
    if (
      generation.status !== "queued" ||
      !generation.externalTaskIds ||
      generation.externalTaskIds.length === 0
    ) {
      continue;
    }

    const results = await Promise.all(
      generation.externalTaskIds.map(async (taskId) => {
        try {
          return await provider.pollTask(taskId);
        } catch {
          return null;
        }
      })
    );

    const completed = results.find((result) => result?.status === "completed");
    const failed = results.every((result) => result?.status === "failed");

    if (completed) {
      await projectStore.updateGeneration(projectId, generation.id, {
        status: "completed",
        audioUrl: completed.audioUrl,
        coverImageUrl: completed.coverImageUrl,
        notes: completed.notes
      });
      continue;
    }

    if (failed) {
      await projectStore.updateGeneration(projectId, generation.id, {
        status: "failed",
        notes: results.find((result) => result?.notes)?.notes || "All provider tasks failed."
      });
    }
  }
}

export async function refreshQueuedGenerationsForUser(
  userId: string
): Promise<void> {
  const projectStore = new ProjectStore();
  const conversations = await projectStore.listConversations(userId);

  await Promise.all(
    conversations
      .filter((conversation) => conversation.hasQueuedGeneration)
      .map((conversation) => refreshQueuedGenerations(conversation.id))
  );
}
