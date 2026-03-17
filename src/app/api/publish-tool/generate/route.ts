import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  buildFallbackTabs,
  buildMetadata,
  buildScreenshotCopy,
  type Fields
} from "@/apps/publish-tool/lib/publish-tool";
import { DEFAULT_LIVE_MODEL, DEMO_MODEL_ID, normalizeModelId } from "@/shared/config";

export const dynamic = "force-dynamic";

const fieldsSchema = z.object({
  productDirection: z.string().min(1),
  targetUser: z.string().optional().default(""),
  experienceFlow: z.string().optional().default("")
});

const bodySchema = z.object({
  fields: fieldsSchema
});

const tabSchema = z.object({
  title: z.string().min(1).max(12),
  description: z.string().min(12).max(120)
});

const screenshotSchema = z.object({
  title: z.string().min(1).max(12),
  subtitle: z.string().min(6).max(40)
});

const metadataSchema = z.object({
  name: z.string().min(1).max(30),
  subtitle: z.string().min(4).max(30),
  description: z.string().min(12).max(4000),
  keywords: z.union([
    z.array(z.string().min(1).max(20)).min(1).max(6),
    z.string().min(1).max(120)
  ])
});

const responseSchema = z.object({
  tabs: z.array(tabSchema).length(4),
  screenshotCopy: z.array(screenshotSchema).length(4),
  metadata: metadataSchema
});

type OpenAIMessageContent =
  | string
  | Array<{
      type?: string;
      text?: string;
    }>;

function resolveModelId(): string {
  const configured = normalizeModelId(process.env.DEFAULT_MODEL_ID);
  return configured === DEMO_MODEL_ID ? DEFAULT_LIVE_MODEL : configured;
}

function getMessageText(content: OpenAIMessageContent): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => (part?.type === "text" || !part?.type ? part.text || "" : ""))
    .join("")
    .trim();
}

function extractJsonObject(value: string): string {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return value.slice(start, end + 1);
  }

  return value;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function clampText(value: string, maxChars: number): string {
  return value.trim().slice(0, maxChars).trim();
}

function normalizeFields(fields: Fields): Fields {
  const productDirection = fields.productDirection.trim();
  const targetUser = fields.targetUser.trim() || "希望高效完成核心任务的用户";
  const experienceFlow =
    fields.experienceFlow.trim() ||
    `围绕${productDirection}快速完成核心操作，并获得清晰、可执行的结果反馈。`;

  return {
    productDirection,
    targetUser,
    experienceFlow
  };
}

function cleanSubtitle(value: string, fallbackName: string): string {
  const normalized = clampText(value, 30)
    .replace(/^[的地得\-—:：,，.。;；、\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (
    !normalized ||
    normalized.length < 4 ||
    /^(的|地|得)/.test(normalized) ||
    /^[助手工具软件应用平台系统]+$/.test(normalized)
  ) {
    return clampText(`${fallbackName}智能整理工具`, 30);
  }

  return normalized;
}

function normalizeMetadata(parsed: z.infer<typeof metadataSchema>) {
  const rawKeywords = Array.isArray(parsed.keywords)
    ? parsed.keywords
    : parsed.keywords
        .split(/[,，、]/)
        .map((item) => item.trim())
        .filter(Boolean);
  const normalizedKeywords: string[] = [];

  for (const keyword of rawKeywords) {
    const next = keyword.trim().replace(/\s+/g, "");
    if (!next) {
      continue;
    }

    const exists = normalizedKeywords.some(
      (item) => item.localeCompare(next, "zh-CN", { sensitivity: "base" }) === 0
    );
    if (exists) {
      continue;
    }

    const candidate = [...normalizedKeywords, next].join(",");
    if (utf8ByteLength(candidate) > 100) {
      continue;
    }

    normalizedKeywords.push(next);
  }

  return {
    name: clampText(parsed.name, 30),
    subtitle: cleanSubtitle(parsed.subtitle, clampText(parsed.name, 30) || "应用"),
    description: clampText(parsed.description, 4000),
    keywords:
      normalizedKeywords.length >= 3
        ? normalizedKeywords
        : rawKeywords.slice(0, 3).map((item) => item.trim().replace(/\s+/g, ""))
  };
}

function buildSystemPrompt(): string {
  return [
    "You generate controlled app-store and PRD-ready product copy.",
    "Return exactly one valid JSON object.",
    "Keep the tab structure constrained to these roles:",
    "1. main workflow entry",
    "2. content library or management",
    "3. progress, insight, or scenario review",
    "4. settings, support, or account",
    "Rules:",
    "- Output only valid JSON shaped as {\"tabs\":[...],\"screenshotCopy\":[...],\"metadata\":{...}}",
    "- Make each tab distinct and non-overlapping.",
    "- Stay grounded in the provided product direction, target user, and core experience.",
    "- Avoid unrelated defaults such as coffee, social, music, or creator features unless the input explicitly asks for them.",
    "- Keep titles short and product-oriented.",
    "- Keep descriptions concise, concrete, and suitable for a requirement document.",
    "- Each tab description must describe the actual page function, not a slogan.",
    "- Prefer page-level flows such as input -> AI/system action -> output/result -> save/manage.",
    "- Mention concrete artifacts when relevant, such as cards, records, reports, plans, tags, calendar items, or history entries.",
    "- Avoid vague filler such as improve experience or meet user needs without specifics.",
    "- Tab 1 should emphasize starting the workflow and receiving the first result.",
    "- Tab 2 should emphasize browsing or managing saved/generated artifacts.",
    "- Tab 3 should emphasize a structurally different review mode such as timeline, calendar, trend, or scenario view.",
    "- Tab 4 should stay focused on privacy, agreement, permissions, feedback, support, and version info.",
    "- screenshotCopy must contain four items matching the four tabs, each with only title and subtitle.",
    "- screenshot subtitles should sound like concise App Store screenshot copy, not paragraph descriptions.",
    "- metadata must include app name, subtitle, store description, and 3 to 6 keywords.",
    "- App name must be 30 characters or fewer.",
    "- Subtitle must be 30 characters or fewer.",
    "- Subtitle must be a complete phrase and must not begin with particles like 的/地/得.",
    "- Description must stay within Apple's 4000-character limit.",
    "- Keywords must fit within Apple's 100-byte limit when joined by commas.",
    "- Avoid competitor names, unverifiable claims, prices, or review-risky language.",
    "- Use Chinese output."
  ].join("\n");
}

function buildUserPrompt(fields: Fields): string {
  return [
    `产品方向：${fields.productDirection}`,
    `目标用户：${fields.targetUser}`,
    `核心体验：${fields.experienceFlow}`,
    "",
    "请基于以上信息，生成 4 个固定框架内的 Tab：",
    "1. 主流程入口",
    "2. 内容库/管理",
    "3. 进度/洞察/场景复盘",
    "4. 设置/支持",
    "",
    "输出要求：",
    "1. tabs: 每个 Tab 只输出标题和一句关键描述，描述应可直接进入需求文档。",
    "2. tabs.description 要写页面功能本身，优先描述用户操作、系统输出、结果展示、保存或回看方式。",
    "3. tabs.description 不要写空泛价值，比如“提升体验”“满足需求”“帮助用户更高效”，除非同时说明具体动作或结果。",
    "4. 对 AI 类产品，要尽量写清 AI 产物是什么，例如卡片、摘要、标签、报告、计划、日历记录等。",
    "5. 可以参考这种风格：上传内容 -> AI生成结果 -> 展示结果卡片 -> 支持保存。",
    "6. screenshotCopy: 按同一框架输出 4 组商店页截图文案，每组只包含 title、subtitle，不要 description。",
    "7. metadata: 输出 name、subtitle、description、keywords。",
    "8. metadata.subtitle 必须是完整短句，不能以“的”开头，不能是残句。",
    "9. 三部分内容必须基于同一产品理解，彼此一致。"
  ].join("\n");
}

async function generateTabsWithAI(fields: Fields) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const baseUrl = process.env.OPENAI_BASE_URL?.trim();

  if (!apiKey || !baseUrl) {
    return {
      source: "fallback" as const,
      tabs: buildFallbackTabs(fields),
      screenshotCopy: buildScreenshotCopy(fields),
      metadata: buildMetadata(fields)
    };
  }

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: resolveModelId(),
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content: buildSystemPrompt()
        },
        {
          role: "user",
          content: buildUserPrompt(fields)
        }
      ]
    }),
    cache: "no-store"
  });

  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(
      `AI generate failed with ${response.status}${detail ? `: ${detail}` : "."}`
    );
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: OpenAIMessageContent;
      };
    }>;
  };

  const content = getMessageText(payload.choices?.[0]?.message?.content || "");
  const parsed = responseSchema.parse(JSON.parse(extractJsonObject(content)));
  const metadata = normalizeMetadata(parsed.metadata);

  return {
    source: "live" as const,
    tabs: parsed.tabs,
    screenshotCopy: parsed.screenshotCopy,
    metadata
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const parsed = bodySchema.parse(await request.json());
    const normalizedFields = normalizeFields(parsed.fields);

    try {
      const result = await generateTabsWithAI(normalizedFields);
      return NextResponse.json(result);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown";
      return NextResponse.json({
        source: "fallback" as const,
        tabs: buildFallbackTabs(normalizedFields),
        screenshotCopy: buildScreenshotCopy(normalizedFields),
        metadata: buildMetadata(normalizedFields),
        reason
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "生成失败，请稍后重试。";
    return NextResponse.json(
      {
        error: message
      },
      {
        status: 500
      }
    );
  }
}
