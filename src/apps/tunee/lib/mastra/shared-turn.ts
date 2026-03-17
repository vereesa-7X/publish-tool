import { createId } from "@/apps/tunee/lib/utils/id";
import { inferPreferenceSignals, summarizeTasteProfile, TasteMemoryStore } from "@/apps/tunee/lib/memory/taste-memory";
import {
  runAssistantReplySkill,
  runLyricsSkill,
  runMusicPromptSkill
} from "@/apps/tunee/lib/mastra/tunee-agent";
import { createMusicProvider } from "@/apps/tunee/lib/providers/music-provider";
import {
  getLatestLyrics,
  getLatestPrompt,
  ProjectStore,
  summarizeConversationHistory,
  summarizeProject
} from "@/apps/tunee/lib/projects/project-store";
import type { MessagePart, MusicGeneration, ProjectRecord, TasteProfile, TokenUsageStats } from "@/apps/tunee/lib/types/tunee";

export interface TurnResult {
  reply: string;
  parts: MessagePart[];
}

export interface TurnTrace {
  key: string;
  label: string;
  status: "running" | "completed";
  detail?: string;
}

export interface TurnUsage {
  key: string;
  label: string;
  usage: TokenUsageStats;
  cumulative: TokenUsageStats;
}

const SKILL_TIMEOUT_MS = 20000;

interface RunTurnInput {
  userId: string;
  projectId: string;
  modelId: string;
  message: string;
  source: "mastra" | "mock";
  onTrace?: (trace: TurnTrace) => Promise<void> | void;
  onUsage?: (usage: TurnUsage) => Promise<void> | void;
  onReplyDelta?: (delta: string) => Promise<void> | void;
}

interface TurnIntent {
  wantsLyrics: boolean;
  wantsPrompt: boolean;
  wantsGeneration: boolean;
}

function inferLanguage(message: string, profile: TasteProfile): string {
  if (/英文|english/i.test(message)) {
    return "English";
  }

  if (/日文|日语|japanese/i.test(message)) {
    return "Japanese";
  }

  const savedLanguage = profile.memories.find((memory) => memory.category === "language");
  if (savedLanguage?.summary.includes("English")) {
    return "English";
  }

  if (savedLanguage?.summary.includes("Japanese")) {
    return "Japanese";
  }

  return "Chinese";
}

function inferMoodTags(message: string, profile: TasteProfile): string[] {
  const tags = new Set<string>();

  if (/city\s*pop|城市流行/i.test(message)) {
    tags.add("city pop");
  }
  if (/治愈|warm|healing/i.test(message)) {
    tags.add("warm");
  }
  if (/emo|伤感|melancholy/i.test(message)) {
    tags.add("melancholic");
  }
  if (/快一点|upbeat|energetic|轻盈/i.test(message)) {
    tags.add("light");
  }
  if (/慢一点|ballad|slow/i.test(message)) {
    tags.add("ballad");
  }
  if (/梦幻|dreamy|ethereal/i.test(message)) {
    tags.add("dreamy");
  }

  for (const memory of profile.memories) {
    if (memory.category === "genre" || memory.category === "mood") {
      tags.add(memory.summary.replace(/^Likes |^Leans toward /, ""));
    }
  }

  return Array.from(tags).slice(0, 5);
}

function inferStructure(message: string): string | undefined {
  if (/四句|4句/i.test(message) && /副歌|chorus/i.test(message)) {
    return "4-line chorus";
  }

  if (/主歌|verse/i.test(message) && /副歌|chorus/i.test(message)) {
    return "verse and chorus";
  }

  if (/副歌|chorus/i.test(message)) {
    return "chorus only";
  }

  return undefined;
}

function buildStyleTags(message: string, profile: TasteProfile): string[] {
  const tags = new Set<string>();
  const genres = profile.memories
    .filter((memory) => memory.category === "genre")
    .map((memory) => memory.summary.replace(/^Likes |^Leans toward /, ""));
  const voice = profile.memories.find((memory) => memory.category === "voice")?.summary;
  const moods = inferMoodTags(message, profile);

  for (const genre of genres) {
    tags.add(genre);
  }

  for (const mood of moods) {
    tags.add(mood);
  }

  if (voice?.includes("female")) {
    tags.add("female vocals");
  } else if (voice?.includes("male")) {
    tags.add("male vocals");
  }

  return Array.from(tags).slice(0, 6);
}

function buildStyleNotes(message: string, profile: TasteProfile): string {
  const tags = buildStyleTags(message, profile);
  const negatives = profile.memories
    .filter((memory) => memory.category === "negative")
    .map((memory) => memory.summary);

  return [
    tags.length > 0 ? `Focus tags: ${tags.join(", ")}` : null,
    negatives.length > 0 ? `Avoid: ${negatives.join(", ")}` : null
  ]
    .filter(Boolean)
    .join(String.fromCharCode(10));
}

async function withTimeout<T>(
  task: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

async function emitTrace(
  input: RunTurnInput,
  trace: TurnTrace
): Promise<void> {
  await input.onTrace?.(trace);
}

function sumUsage(left: TokenUsageStats, right: TokenUsageStats): TokenUsageStats {
  const reasoningTokens = (left.reasoningTokens || 0) + (right.reasoningTokens || 0);
  const cachedInputTokens =
    (left.cachedInputTokens || 0) + (right.cachedInputTokens || 0);

  return {
    promptTokens: left.promptTokens + right.promptTokens,
    completionTokens: left.completionTokens + right.completionTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    ...(reasoningTokens > 0 ? { reasoningTokens } : {}),
    ...(cachedInputTokens > 0 ? { cachedInputTokens } : {})
  };
}

function hasUsage(usage: TokenUsageStats | undefined): usage is TokenUsageStats {
  return Boolean(usage && usage.totalTokens > 0);
}

function splitGeneratedVariants(input: {
  title: string;
  externalTaskIds?: string[];
  provider: string;
  providerMode: "real" | "mock";
  status: MusicGeneration["status"];
  audioUrl?: string | null;
  coverImageUrl?: string | null;
  notes: string;
  requestSnapshot: {
    modelId: string;
    prompt: string;
    lyrics?: string;
  };
}): Array<{
  title: string;
  externalTaskIds?: string[];
  provider: string;
  providerMode: "real" | "mock";
  status: MusicGeneration["status"];
  audioUrl?: string | null;
  coverImageUrl?: string | null;
  notes: string;
  requestSnapshot: {
    modelId: string;
    prompt: string;
    lyrics?: string;
  };
}> {
  const taskIds = input.externalTaskIds?.filter(Boolean) ?? [];

  if (taskIds.length <= 1) {
    return [input];
  }

  return taskIds.map((taskId, index) => ({
    ...input,
    title: `${input.title} · 候选 ${index + 1}`,
    externalTaskIds: [taskId],
    notes: `候选 ${index + 1}/${taskIds.length}。${input.notes}`
  }));
}

async function emitUsage(
  input: RunTurnInput,
  usage: TurnUsage
): Promise<void> {
  await input.onUsage?.(usage);
}

async function streamReplyText(
  input: RunTurnInput,
  reply: string
): Promise<void> {
  if (!input.onReplyDelta || !reply) {
    return;
  }

  await input.onReplyDelta(reply);
}

function detectIntent(
  message: string,
  project: ProjectRecord
): TurnIntent {
  const latestLyrics = getLatestLyrics(project);
  const latestPrompt = getLatestPrompt(project);
  const hasSongContext = project.messages.length > 1 || Boolean(project.summary.trim());
  const wantsSongDraft =
    /写歌|写一首歌|做一首歌|写首歌|来首歌|做首歌|做一版歌|写一版歌/i.test(message) ||
    /写.{0,24}(歌|demo)|做.{0,24}(歌|demo)/i.test(message) ||
    (/做一首/i.test(message) && /歌|demo/i.test(message));
  const hasRevisionVerb = /改|重写|再来|调整|优化|润色|继续|更|换成|试试/i.test(message);
  const wantsCombinedDraft =
    hasSongContext &&
    /一起出|一起做|一并出|都出|都做|那就出|那就做|顺手出|顺手做|一起搞|一起整/i.test(
      message
    );
  const wantsGeneration = /生成|来一版|出一版|render|generate|试听|做出来|跑一版|做个音频/i.test(
    message
  );
  const generationOnly =
    wantsGeneration &&
    Boolean(latestLyrics || latestPrompt) &&
    !/先写|补一版|补个|重写|改|调整|优化|换成|重新做|重新写/i.test(message);
  const wantsPrompt =
    !generationOnly &&
    (wantsSongDraft ||
      wantsCombinedDraft ||
      /prompt|编曲|制作|arrangement|suno|udio|风格|配器|氛围|前奏|鼓点|合成器/i.test(
        message
      ) ||
      (hasRevisionVerb &&
        Boolean(latestPrompt) &&
        /节奏|层次|配器|鼓点|前奏|风格|氛围|更空灵|更大气/i.test(message)));
  const wantsLyrics =
    !generationOnly &&
    (wantsSongDraft ||
      wantsCombinedDraft ||
      /歌词|lyric|verse|chorus|hook|主歌|副歌|桥段|词|写一版|写首/i.test(message) ||
      (hasRevisionVerb &&
        Boolean(latestLyrics) &&
        !wantsPrompt &&
        /更抓耳|更顺|更自然|更像|副歌|主歌|押韵|情绪|hook|词/i.test(message)));

  return {
    wantsLyrics,
    wantsPrompt,
    wantsGeneration
  };
}

function isChineseMessage(message: string): boolean {
  return /[\u4e00-\u9fff]/.test(message);
}

function buildLocalReply(input: {
  message: string;
  actionNotes: string[];
  rememberedNotes: string[];
  intent: TurnIntent;
}): string {
  const zh = isChineseMessage(input.message);
  const didLyrics = input.intent.wantsLyrics;
  const didPrompt = input.intent.wantsPrompt;
  const didGeneration = input.intent.wantsGeneration;

  if (zh) {
    if (didLyrics && didPrompt && !didGeneration) {
      return "按你的要求，我先给你一版歌词和 music prompt，都放在下面了。";
    }

    if (didLyrics && !didPrompt && !didGeneration) {
      return "我先写了一版歌词，放在下面。";
    }

    if (!didLyrics && didPrompt && !didGeneration) {
      return "我先整理了一版 music prompt，放在下面。";
    }

    if (didGeneration) {
      return "我已经提交生成了，结果会留在这段对话里。";
    }

    if (input.rememberedNotes.length > 0) {
      return `我记住了：${input.rememberedNotes.join("，")}。你可以继续让我基于这个方向直接写歌词和 music prompt。`;
    }

    return "方向我接住了。你可以直接让我沿着当前会话继续改歌词、改 prompt，或者直接生成一版。";
  }

  if (didLyrics && didPrompt && !didGeneration) {
    return "I put together both lyrics and a music prompt for you below.";
  }

  if (didLyrics && !didPrompt && !didGeneration) {
    return "I drafted the lyrics below.";
  }

  if (!didLyrics && didPrompt && !didGeneration) {
    return "I prepared the music prompt below.";
  }

  if (didGeneration) {
    return "I submitted the generation and the result will stay in this conversation.";
  }

  if (input.rememberedNotes.length > 0) {
    return `I remembered this for later: ${input.rememberedNotes.join(", ")}. Ask me to keep writing lyrics, refine the prompt, or generate a version.`;
  }

  return "I have the direction. Ask me to keep revising the current thread, write lyrics, refine the prompt, or generate a version.";
}

function buildMockLyrics(input: {
  project: ProjectRecord;
  profile: TasteProfile;
  message: string;
}): {
  title: string;
  language: string;
  moodTags: string[];
  content: string;
  usage?: TokenUsageStats;
} {
  const language = inferLanguage(input.message, input.profile);
  const moodTags = inferMoodTags(input.message, input.profile);
  const title = input.project.title;

  if (language === "English") {
    return {
      title,
      language,
      moodTags,
      content: [
        "[Verse]",
        "Blue reflections on the taxi glass, the city breathing low and slow,",
        "You lean back and let the midnight wires hum underneath the stereo,",
        "Every signal turns to silver, every shadow knows our name,",
        "We are saving one more chorus from the morning and the rain.",
        "",
        "[Chorus]",
        "Stay in the soft light, stay in the afterglow,",
        "Let the drums fall gentle, let the skyline move in slow motion,",
        "If the whole world rushes, we can keep our own tempo,",
        "You and I, one small song inside the neon."
      ].join("\n")
    };
  }

  return {
    title,
    language,
    moodTags,
    content: [
      "【主歌】",
      "夜风把霓虹吹成一条河，刚好流到你眼睛里面，",
      "车窗有一点雾，像没说完的话，停在副歌前一瞬间，",
      "城市不必太吵，鼓点也不用急着把心事都讲完，",
      "我想让这一段慢一点，好让喜欢有地方靠岸。",
      "",
      "【副歌】",
      "就留在这片柔软灯光里，别把清晨太快说穿，",
      "让贝斯轻轻托住呼吸，让合成器像海风打转，",
      "如果今晚要有一句最抓耳，就让它刚好落在你名字上，",
      "我想把这份心动唱得很近，又唱得很宽。"
    ].join("\n")
  };
}

function buildMockPrompt(input: {
  project: ProjectRecord;
  profile: TasteProfile;
  message: string;
  lyrics?: string;
  existingPrompt?: string;
}): {
  title: string;
  content: string;
  styleTags: string[];
  usage?: TokenUsageStats;
} {
  const title = input.project.title;
  const styleTags = inferMoodTags(input.message, input.profile);
  const voice =
    input.profile.memories.find((memory) => memory.category === "voice")?.summary ??
    "Flexible lead vocal";

  const content = [
    `Title: ${title}`,
    input.existingPrompt ? `Refine from current prompt:\n${input.existingPrompt}` : null,
    "Create a polished demo with a short intro, a vivid chorus lift, and a vocal-forward topline.",
    `Style: ${styleTags.join(", ") || "pop, cinematic, modern"}.`,
    `Voice: ${voice}.`,
    "Arrangement: warm pads, defined bass, restrained drums, one memorable synth motif, no clutter.",
    "Structure: short intro, verse, pre, chorus, optional post-chorus, clean ending.",
    "Mix goals: intimate vocal, clean low end, spacious but not noisy.",
    input.lyrics ? `Lyrics anchor:\n${input.lyrics}` : "Lyrics anchor: build around a memorable chorus."
  ]
    .filter(Boolean)
    .join("\n");

  return {
    title,
    content,
    styleTags
  };
}

export async function runTurn(input: RunTurnInput): Promise<TurnResult> {
  const projectStore = new ProjectStore();
  const memoryStore = new TasteMemoryStore();
  const musicProvider = createMusicProvider();
  let project = await projectStore.get(input.projectId);
  const profile = await memoryStore.get(input.userId);
  const tasteSummary = summarizeTasteProfile(profile);
  const intent = detectIntent(input.message, project);
  const rememberedNotes = inferPreferenceSignals(input.message).map((signal) => signal.summary);
  const createdParts: MessagePart[] = [];
  const actionNotes: string[] = [];
  const usedSkills: string[] = [];
  let latestLyrics = getLatestLyrics(project);
  let latestPrompt = getLatestPrompt(project);
  let cumulativeUsage: TokenUsageStats = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0
  };

  if (rememberedNotes.length > 0) {
    usedSkills.push("Taste Memory");
  }

  if (intent.wantsLyrics) {
    usedSkills.push("Lyrics Skill");
    await emitTrace(input, {
      key: "lyrics",
      label: "调用 Lyrics Skill",
      status: "running"
    });
    const draft =
      input.source === "mastra"
        ? await withTimeout(
            runLyricsSkill({
              modelId: input.modelId,
              projectTitle: project.title,
            brief: input.message,
            language: inferLanguage(input.message, profile),
            mood: inferMoodTags(input.message, profile).join(", "),
            structure: inferStructure(input.message),
            existingLyrics: latestLyrics?.content,
            existingPrompt: latestPrompt?.content,
            conversationHistory: summarizeConversationHistory(project),
            tasteSummary
          }),
            SKILL_TIMEOUT_MS,
            "lyrics skill"
          ).catch(() =>
            buildMockLyrics({
              project,
              profile,
              message: input.message
            })
          )
        : buildMockLyrics({
            project,
            profile,
            message: input.message
          });

    latestLyrics = await projectStore.saveLyricsVersion(input.projectId, {
      title: draft.title,
      brief: input.message,
      content: draft.content,
      language: draft.language,
      moodTags: draft.moodTags,
      source: input.source
    });

    createdParts.push({
      id: createId("part"),
      type: "lyrics",
      title: latestLyrics.title,
      content: latestLyrics.content,
      language: latestLyrics.language,
      moodTags: latestLyrics.moodTags,
      versionId: latestLyrics.id
    });
    actionNotes.push(
      isChineseMessage(input.message)
        ? `我先写出了一版歌词《${latestLyrics.title}》，已经放在这段对话里。`
        : `I drafted a lyric version called "${latestLyrics.title}" and kept it in this conversation.`
    );
    project = await projectStore.get(input.projectId);
    await emitTrace(input, {
      key: "lyrics",
      label: "调用 Lyrics Skill",
      status: "completed",
      detail: "已保存最新歌词"
    });
    if (hasUsage(draft.usage)) {
      cumulativeUsage = sumUsage(cumulativeUsage, draft.usage);
      await emitUsage(input, {
        key: "lyrics",
        label: "Lyrics Skill",
        usage: draft.usage,
        cumulative: cumulativeUsage
      });
    }
  }

  if (intent.wantsPrompt) {
    usedSkills.push("Music Prompt Skill");
    await emitTrace(input, {
      key: "prompt",
      label: "调用 Music Prompt Skill",
      status: "running"
    });
    const draft =
      input.source === "mastra"
        ? await withTimeout(
            runMusicPromptSkill({
              modelId: input.modelId,
              projectTitle: project.title,
            brief: input.message,
            lyrics: latestLyrics?.content,
            styleNotes: buildStyleNotes(input.message, profile),
            existingPrompt: latestPrompt?.content,
            conversationHistory: summarizeConversationHistory(project),
            tasteSummary
          }),
            SKILL_TIMEOUT_MS,
            "music prompt skill"
          ).catch(() =>
            buildMockPrompt({
              project,
              profile,
              message: input.message,
              lyrics: latestLyrics?.content,
              existingPrompt: latestPrompt?.content
            })
          )
        : buildMockPrompt({
            project,
            profile,
            message: input.message,
            lyrics: latestLyrics?.content,
            existingPrompt: latestPrompt?.content
          });

    latestPrompt = await projectStore.savePromptVersion(input.projectId, {
      title: draft.title,
      brief: input.message,
      content: draft.content,
      styleTags: draft.styleTags,
      negativePrompt: "Avoid muddy low end and overcrowded percussion.",
      source: input.source
    });

    createdParts.push({
      id: createId("part"),
      type: "prompt",
      title: latestPrompt.title,
      content: latestPrompt.content,
      styleTags: latestPrompt.styleTags,
      negativePrompt: latestPrompt.negativePrompt,
      versionId: latestPrompt.id
    });
    actionNotes.push(
      isChineseMessage(input.message)
        ? `我也整理了一版可直接用于生成的音乐 prompt。`
        : "I also prepared a generation-ready music prompt."
    );
    project = await projectStore.get(input.projectId);
    await emitTrace(input, {
      key: "prompt",
      label: "调用 Music Prompt Skill",
      status: "completed",
      detail: "已整理最新音乐 prompt"
    });
    if (hasUsage(draft.usage)) {
      cumulativeUsage = sumUsage(cumulativeUsage, draft.usage);
      await emitUsage(input, {
        key: "prompt",
        label: "Music Prompt Skill",
        usage: draft.usage,
        cumulative: cumulativeUsage
      });
    }
  }

  if (intent.wantsGeneration) {
    if (!latestLyrics) {
      if (!usedSkills.includes("Lyrics Skill")) {
        usedSkills.push("Lyrics Skill");
      }
      await emitTrace(input, {
        key: "lyrics",
        label: "调用 Lyrics Skill",
        status: "running"
      });
      const generatedLyrics =
        input.source === "mastra"
          ? await withTimeout(
              runLyricsSkill({
                modelId: input.modelId,
                projectTitle: project.title,
                brief: input.message,
                language: inferLanguage(input.message, profile),
                mood: inferMoodTags(input.message, profile).join(", "),
                structure: inferStructure(input.message),
                existingPrompt: latestPrompt?.content,
                conversationHistory: summarizeConversationHistory(project),
                tasteSummary
              }),
              SKILL_TIMEOUT_MS,
              "lyrics skill"
            ).catch(() =>
              buildMockLyrics({
                project,
                profile,
                message: input.message
              })
            )
          : buildMockLyrics({
              project,
              profile,
              message: input.message
            });

      latestLyrics = await projectStore.saveLyricsVersion(input.projectId, {
        title: generatedLyrics.title,
        brief: input.message,
        content: generatedLyrics.content,
        language: generatedLyrics.language,
        moodTags: generatedLyrics.moodTags,
        source: input.source
      });

      createdParts.push({
        id: createId("part"),
        type: "lyrics",
        title: latestLyrics.title,
        content: latestLyrics.content,
        language: latestLyrics.language,
        moodTags: latestLyrics.moodTags,
        versionId: latestLyrics.id
      });
      project = await projectStore.get(input.projectId);
      await emitTrace(input, {
        key: "lyrics",
        label: "调用 Lyrics Skill",
        status: "completed",
        detail: "已补齐生成所需歌词"
      });
      if (hasUsage(generatedLyrics.usage)) {
        cumulativeUsage = sumUsage(cumulativeUsage, generatedLyrics.usage);
        await emitUsage(input, {
          key: "lyrics",
          label: "Lyrics Skill",
          usage: generatedLyrics.usage,
          cumulative: cumulativeUsage
        });
      }
    }

    if (!latestPrompt) {
      if (!usedSkills.includes("Music Prompt Skill")) {
        usedSkills.push("Music Prompt Skill");
      }
      await emitTrace(input, {
        key: "prompt",
        label: "调用 Music Prompt Skill",
        status: "running"
      });
      const fallbackPrompt =
        input.source === "mastra"
          ? await withTimeout(
              runMusicPromptSkill({
                modelId: input.modelId,
                projectTitle: project.title,
                brief: input.message,
                lyrics: latestLyrics?.content,
                styleNotes: buildStyleNotes(input.message, profile),
                existingPrompt: undefined,
                conversationHistory: summarizeConversationHistory(project),
                tasteSummary
              }),
              SKILL_TIMEOUT_MS,
              "music prompt skill"
            ).catch(() =>
              buildMockPrompt({
                project,
                profile,
                message: input.message,
                lyrics: latestLyrics?.content,
                existingPrompt: undefined
              })
            )
          : buildMockPrompt({
              project,
              profile,
              message: input.message,
              lyrics: latestLyrics?.content,
              existingPrompt: undefined
            });

      latestPrompt = await projectStore.savePromptVersion(input.projectId, {
        title: fallbackPrompt.title,
        brief: input.message,
        content: fallbackPrompt.content,
        styleTags: fallbackPrompt.styleTags,
        negativePrompt: "Avoid muddy low end and overcrowded percussion.",
        source: input.source
      });

      createdParts.push({
        id: createId("part"),
        type: "prompt",
        title: latestPrompt.title,
        content: latestPrompt.content,
        styleTags: latestPrompt.styleTags,
        negativePrompt: latestPrompt.negativePrompt,
        versionId: latestPrompt.id
      });
      project = await projectStore.get(input.projectId);
      await emitTrace(input, {
        key: "prompt",
        label: "调用 Music Prompt Skill",
        status: "completed",
        detail: "已补齐生成所需 prompt"
      });
      if (hasUsage(fallbackPrompt.usage)) {
        cumulativeUsage = sumUsage(cumulativeUsage, fallbackPrompt.usage);
        await emitUsage(input, {
          key: "prompt",
          label: "Music Prompt Skill",
          usage: fallbackPrompt.usage,
          cumulative: cumulativeUsage
        });
      }
    }

    if (!latestPrompt) {
      throw new Error("No music prompt is available for generation.");
    }

    usedSkills.push("Generate Music Skill");
    await emitTrace(input, {
      key: "generate",
      label: "调用 Generate Music Skill",
      status: "running"
    });

    const generated = await musicProvider.generateTrack({
      title: latestPrompt.title,
      prompt: latestPrompt.content,
      lyrics: latestLyrics?.content,
      modelId: input.modelId,
      styleTags: latestPrompt.styleTags,
      negativePrompt: latestPrompt.negativePrompt
    });

    const generationVariants = splitGeneratedVariants(generated);
    const promptVersionId = latestPrompt.id;
    const savedGenerations = [];

    for (const variant of generationVariants) {
      savedGenerations.push(
        await projectStore.saveGeneration(input.projectId, {
          title: variant.title,
          promptVersionId,
          lyricVersionId: latestLyrics?.id,
          externalTaskIds: variant.externalTaskIds,
          provider: variant.provider,
          providerMode: variant.providerMode,
          status: variant.status,
          audioUrl: variant.audioUrl,
          coverImageUrl: variant.coverImageUrl,
          notes: variant.notes,
          requestSnapshot: variant.requestSnapshot
        })
      );
    }

    createdParts.push(
      ...savedGenerations.map((savedGeneration) => ({
        id: createId("part"),
        type: "audio" as const,
        title: savedGeneration.title,
        generationId: savedGeneration.id,
        status: savedGeneration.status,
        provider: savedGeneration.provider,
        providerMode: savedGeneration.providerMode,
        notes: savedGeneration.notes,
        audioUrl: savedGeneration.audioUrl,
        coverImageUrl: savedGeneration.coverImageUrl
      }))
    );
    actionNotes.push(
      savedGenerations[0].providerMode === "real"
        ? isChineseMessage(input.message)
          ? `我已经按 custom 模式提交了 ${savedGenerations.length} 首候选版本：歌词和音乐 prompt 是分开发送的，结果会继续在这里更新。`
          : `I submitted ${savedGenerations.length} candidate versions in custom mode with separate lyrics and music prompt, and the results will update here.`
        : isChineseMessage(input.message)
          ? `我已经走通了一次 mock 生成链路，目前返回了 ${savedGenerations.length} 个候选音频位。`
          : `I ran the full mock generation path and returned ${savedGenerations.length} candidate audio slots.`
    );
    project = await projectStore.get(input.projectId);
    await emitTrace(input, {
      key: "generate",
      label: "调用 Generate Music Skill",
      status: "completed",
      detail:
        savedGenerations[0].providerMode === "real"
          ? `已按 custom 模式提交 ${savedGenerations.length} 个音频版本`
          : `已生成 ${savedGenerations.length} 个 mock 音频位`
    });
  }

  const updatedProject = await projectStore.get(input.projectId);
  let reply: string;

  if (input.source === "mastra") {
    try {
      await emitTrace(input, {
        key: "reply",
        label: "整理回复",
        status: "running"
      });
      const replyResult = await withTimeout(
        runAssistantReplySkill({
          modelId: input.modelId,
          message: input.message,
          projectSummary: summarizeProject(updatedProject),
          tasteSummary: summarizeTasteProfile(profile),
          conversationHistory: summarizeConversationHistory(updatedProject),
          actionSummary: [...rememberedNotes.map((note) => `Remembered: ${note}`), ...actionNotes].join(String.fromCharCode(10)),
          onTextDelta: input.onReplyDelta
        }),
        12000,
        "assistant reply skill"
      );
      reply = replyResult.text;
      await emitTrace(input, {
        key: "reply",
        label: "整理回复",
        status: "completed"
      });
      if (hasUsage(replyResult.usage)) {
        cumulativeUsage = sumUsage(cumulativeUsage, replyResult.usage);
        await emitUsage(input, {
          key: "reply",
          label: "Assistant Reply",
          usage: replyResult.usage,
          cumulative: cumulativeUsage
        });
      }
    } catch {
      reply = buildLocalReply({
        message: input.message,
        actionNotes,
        rememberedNotes,
        intent
      });
      await emitTrace(input, {
        key: "reply",
        label: "整理回复",
        status: "completed"
      });
      await streamReplyText(input, reply);
    }
  } else {
    reply = buildLocalReply({
      message: input.message,
      actionNotes,
      rememberedNotes,
      intent
    });
    await streamReplyText(input, reply);
  }

  return {
    reply,
    parts: [
      ...(usedSkills.length > 0
        ? [
            {
              id: createId("part"),
              type: "skills" as const,
              title: "Skills used",
              items: Array.from(new Set(usedSkills))
            }
          ]
        : []),
      {
        id: createId("part"),
        type: "text",
        text: reply
      },
      ...createdParts
    ]
  };
}
