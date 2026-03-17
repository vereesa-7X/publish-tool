"use client";

import { Fragment, type ChangeEvent, useEffect, useMemo, useState } from "react";
import {
  buildFallbackTabs,
  buildMetadata,
  buildScreenshotCopy,
  defaultFields,
  type Fields,
  type Metadata,
  type ScreenshotCopy,
  type TabBlock
} from "@/apps/publish-tool/lib/publish-tool";

type CardSnapshot = {
  id: string;
  title: string;
  fields: Fields;
  tabs: TabBlock[];
  screenshotCopy: ScreenshotCopy[];
  metadata: Metadata;
  createdAt: string;
};

type CardDraft = {
  title: string;
  fields: Fields;
  tabs: TabBlock[];
  screenshotCopy: ScreenshotCopy[];
  metadata: Metadata;
};

const SAVED_CARDS_STORAGE_KEY = "publish-tool.saved-cards.v2";
const ACTIVE_CARD_STORAGE_KEY = "publish-tool.active-card.v2";

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function renderLimitStatus(current: number, max: number, unit: string) {
  const isOver = current > max;

  return (
    <span className={`publish-limit-chip ${isOver ? "is-over" : "is-safe"}`}>
      {current}/{max} {unit}
    </span>
  );
}

const nowString = () =>
  new Date().toLocaleString("zh-CN", {
    hour12: false
  });

const createCardSnapshot = (
  fields: Fields,
  tabs: TabBlock[],
  screenshotCopy: ScreenshotCopy[],
  metadata: Metadata
): CardSnapshot => ({
  id: `${Date.now()}-${Math.floor(Math.random() * 1000)}`,
  title: metadata.name,
  fields: { ...fields },
  tabs,
  screenshotCopy,
  metadata,
  createdAt: nowString()
});

const createCardDraft = (card: CardSnapshot): CardDraft => ({
  title: card.title,
  fields: { ...card.fields },
  tabs: card.tabs.map((tab) => ({ ...tab })),
  screenshotCopy: card.screenshotCopy.map((copy) => ({ ...copy })),
  metadata: {
    ...card.metadata,
    keywords: [...card.metadata.keywords]
  }
});

export function PublishToolApp(): React.JSX.Element {
  const initialCard = useMemo(() => {
    const initialTabs = buildFallbackTabs(defaultFields);
    const initialScreenshotCopy = buildScreenshotCopy(defaultFields);
    const initialMetadata = buildMetadata(defaultFields);
    return createCardSnapshot(
      defaultFields,
      initialTabs,
      initialScreenshotCopy,
      initialMetadata
    );
  }, []);
  const [fields, setFields] = useState<Fields>(defaultFields);
  const [tabs, setTabs] = useState<TabBlock[]>(initialCard.tabs);
  const [screenshotCopy, setScreenshotCopy] = useState<ScreenshotCopy[]>(
    initialCard.screenshotCopy
  );
  const [metadata, setMetadata] = useState<Metadata>(initialCard.metadata);
  const [savedCards, setSavedCards] = useState<CardSnapshot[]>([]);
  const [activeCardId, setActiveCardId] = useState<string>("");
  const [isEditingCard, setIsEditingCard] = useState(false);
  const [cardDraft, setCardDraft] = useState<CardDraft>(() => createCardDraft(initialCard));
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [generationHint, setGenerationHint] = useState(
    "点击按钮后按固定四栏框架生成，可直接用于需求整理。"
  );

  useEffect(() => {
    try {
      const rawCards = window.localStorage.getItem(SAVED_CARDS_STORAGE_KEY);
      const rawActiveCardId = window.localStorage.getItem(ACTIVE_CARD_STORAGE_KEY);

      if (!rawCards) {
        return;
      }

      const parsed = JSON.parse(rawCards) as CardSnapshot[];
      if (!Array.isArray(parsed) || parsed.length === 0) {
        return;
      }

      const cards = parsed.filter(
        (card) =>
          card &&
          typeof card.id === "string" &&
          typeof card.title === "string" &&
          card.fields &&
          typeof card.fields.productDirection === "string" &&
          typeof card.fields.targetUser === "string" &&
          typeof card.fields.experienceFlow === "string" &&
          Array.isArray(card.tabs) &&
          Array.isArray(card.screenshotCopy) &&
          card.metadata &&
          typeof card.metadata.name === "string" &&
          typeof card.metadata.subtitle === "string" &&
          typeof card.metadata.description === "string" &&
          Array.isArray(card.metadata.keywords) &&
          typeof card.createdAt === "string"
      );

      if (cards.length === 0) {
        return;
      }

      const nextActiveCard =
        cards.find((card) => card.id === rawActiveCardId) ?? cards[0];

      setSavedCards(cards);
      setActiveCardId(nextActiveCard.id);
      setFields(nextActiveCard.fields);
      setTabs(nextActiveCard.tabs);
      setScreenshotCopy(nextActiveCard.screenshotCopy);
      setMetadata(nextActiveCard.metadata);
      setCardDraft(createCardDraft(nextActiveCard));
      setIsEditingCard(false);
      setGenerationHint("已恢复上次保存的卡片内容。");
    } catch {
      window.localStorage.removeItem(SAVED_CARDS_STORAGE_KEY);
      window.localStorage.removeItem(ACTIVE_CARD_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(SAVED_CARDS_STORAGE_KEY, JSON.stringify(savedCards));
      window.localStorage.setItem(ACTIVE_CARD_STORAGE_KEY, activeCardId);
    } catch {
      // Ignore storage failures and keep the in-memory experience available.
    }
  }, [activeCardId, savedCards]);

  const activeCard = savedCards.find((card) => card.id === activeCardId) ?? null;
  const keywordText = metadata.keywords.join(",");
  const keywordBytes = utf8ByteLength(keywordText);
  const draftKeywordBytes = utf8ByteLength(cardDraft.metadata.keywords.join(","));

  const handleFieldChange =
    (field: keyof Fields) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setFields((previous) => ({
        ...previous,
        [field]: event.target.value
      }));
    };

  const handleGenerate = async (): Promise<{
    snapshotFields: Fields;
    nextTabs: TabBlock[];
    nextScreenshotCopy: ScreenshotCopy[];
    nextMetadata: Metadata;
  }> => {
    const snapshot: Fields = { ...fields };
    setIsGenerating(true);
    setGenerationHint("正在生成更贴近产品方向的四栏结构...");

    try {
      const response = await fetch("/api/publish-tool/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          fields: snapshot
        })
      });
      const result = (await response.json()) as {
        tabs?: TabBlock[];
        screenshotCopy?: ScreenshotCopy[];
        metadata?: Metadata;
        source?: "live" | "fallback";
        error?: string;
        reason?: string;
      };

      if (!response.ok || !result.tabs || !result.screenshotCopy || !result.metadata) {
        throw new Error(result.error || "生成失败，请稍后重试。");
      }

      setTabs(result.tabs);
      setScreenshotCopy(result.screenshotCopy);
      setMetadata(result.metadata);
      setGenerationHint(
        result.source === "live"
          ? "已按固定框架生成 Tab、截图文案和商店页文案。"
          : `AI 暂不可用（${result.reason || "请求失败"}），已按受控规则生成完整文案。`
      );

      return {
        snapshotFields: snapshot,
        nextTabs: result.tabs,
        nextScreenshotCopy: result.screenshotCopy,
        nextMetadata: result.metadata
      };
    } catch (error) {
      const fallbackTabs = buildFallbackTabs(snapshot);
      const fallbackScreenshotCopy = buildScreenshotCopy(snapshot);
      const fallbackMetadata = buildMetadata(snapshot);
      setTabs(fallbackTabs);
      setScreenshotCopy(fallbackScreenshotCopy);
      setMetadata(fallbackMetadata);
      setGenerationHint(
        `AI 暂不可用（${error instanceof Error ? error.message : "请求异常"}），已按受控规则生成完整文案。`
      );

      return {
        snapshotFields: snapshot,
        nextTabs: fallbackTabs,
        nextScreenshotCopy: fallbackScreenshotCopy,
        nextMetadata: fallbackMetadata
      };
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateClick = async () => {
    await handleGenerate();
  };

  const handleSave = async () => {
    setIsSaving(true);
    setGenerationHint("正在保存当前卡片...");

    try {
      const card = createCardSnapshot(
        fields,
        tabs,
        screenshotCopy,
        metadata
      );
      setSavedCards((previous) => [card, ...previous]);
      setActiveCardId(card.id);
      setGenerationHint("卡片已保存，可导出或继续编辑。");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCardSelect = (cardId: string) => {
    const card = savedCards.find((entry) => entry.id === cardId);
    if (!card) {
      return;
    }

    setActiveCardId(card.id);
    setFields(card.fields);
    setTabs(card.tabs);
    setScreenshotCopy(card.screenshotCopy);
    setMetadata(card.metadata);
    setIsEditingCard(false);
    setCardDraft(createCardDraft(card));
    setGenerationHint("已恢复该卡片对应的四栏结果。");
  };

  const handleDeleteCard = (cardId: string) => {
    const nextCards = savedCards.filter((card) => card.id !== cardId);
    setSavedCards(nextCards);

    if (nextCards.length === 0) {
      setActiveCardId("");
      setGenerationHint("卡片已删除。");
      return;
    }

    const nextActive = nextCards[0];
    setActiveCardId(nextActive.id);
    setFields(nextActive.fields);
    setTabs(nextActive.tabs);
    setScreenshotCopy(nextActive.screenshotCopy);
    setMetadata(nextActive.metadata);
    setIsEditingCard(false);
    setCardDraft(createCardDraft(nextActive));
    setGenerationHint("卡片已删除，已切换到下一张卡片。");
  };

  const handleClearAllCards = () => {
    window.localStorage.removeItem(SAVED_CARDS_STORAGE_KEY);
    window.localStorage.removeItem(ACTIVE_CARD_STORAGE_KEY);
    setSavedCards([]);
    setActiveCardId("");
    setFields(defaultFields);
    setTabs(buildFallbackTabs(defaultFields));
    setScreenshotCopy(buildScreenshotCopy(defaultFields));
    setMetadata(buildMetadata(defaultFields));
    setCardDraft(createCardDraft(initialCard));
    setIsEditingCard(false);
    setGenerationHint("已清空全部本地卡片。");
  };

  const handleStartCardEdit = () => {
    if (!activeCard) {
      return;
    }

    setCardDraft(createCardDraft(activeCard));
    setIsEditingCard(true);
    setGenerationHint("已进入卡片编辑状态，保存后会覆盖当前卡片。");
  };

  const handleCancelCardEdit = () => {
    if (activeCard) {
      setCardDraft(createCardDraft(activeCard));
    }
    setIsEditingCard(false);
    setGenerationHint("已取消卡片编辑。");
  };

  const handleDraftFieldChange =
    (field: keyof Fields) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = event.target.value;
      setCardDraft((previous) => ({
        ...previous,
        fields: {
          ...previous.fields,
          [field]: value
        }
      }));
    };

  const handleDraftTabChange =
    (index: number, field: keyof TabBlock) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = event.target.value;
      setCardDraft((previous) => ({
        ...previous,
        tabs: previous.tabs.map((tab, tabIndex) =>
          tabIndex === index ? { ...tab, [field]: value } : tab
        )
      }));
    };

  const handleDraftScreenshotChange =
    (index: number, field: keyof ScreenshotCopy) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = event.target.value;
      setCardDraft((previous) => ({
        ...previous,
        screenshotCopy: previous.screenshotCopy.map((copy, copyIndex) =>
          copyIndex === index ? { ...copy, [field]: value } : copy
        )
      }));
    };

  const handleDraftMetadataChange =
    (field: keyof Metadata) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = event.target.value;
      setCardDraft((previous) => ({
        ...previous,
        title: field === "name" ? value : previous.title,
        metadata: {
          ...previous.metadata,
          [field]:
            field === "keywords"
              ? value
                  .split(/[,，、]/)
                  .map((item) => item.trim())
                  .filter(Boolean)
              : value
        }
      }));
    };

  const handleUpdateCard = () => {
    if (!activeCard) {
      return;
    }

    const nextCard: CardSnapshot = {
      ...activeCard,
      title: cardDraft.metadata.name.trim() || cardDraft.title,
      fields: { ...cardDraft.fields },
      tabs: cardDraft.tabs.map((tab) => ({ ...tab })),
      screenshotCopy: cardDraft.screenshotCopy.map((copy) => ({ ...copy })),
      metadata: {
        ...cardDraft.metadata,
        name: cardDraft.metadata.name.trim() || activeCard.metadata.name,
        subtitle: cardDraft.metadata.subtitle.trim(),
        description: cardDraft.metadata.description.trim(),
        keywords: cardDraft.metadata.keywords.map((item) => item.trim()).filter(Boolean)
      }
    };

    setSavedCards((previous) =>
      previous.map((card) => (card.id === activeCard.id ? nextCard : card))
    );
    setFields(nextCard.fields);
    setTabs(nextCard.tabs);
    setScreenshotCopy(nextCard.screenshotCopy);
    setMetadata(nextCard.metadata);
    setActiveCardId(nextCard.id);
    setCardDraft(createCardDraft(nextCard));
    setIsEditingCard(false);
    setGenerationHint("卡片修改已保存。");
  };

  const handleExportCard = (card: CardSnapshot) => {
    const lines = [
      `# ${card.title}`,
      "",
      `创建时间：${card.createdAt}`,
      `产品方向：${card.fields.productDirection}`,
      `目标用户：${card.fields.targetUser}`,
      `核心体验：${card.fields.experienceFlow}`,
      "",
      "## Tab 功能概览",
      ...card.tabs.flatMap((tab, index) => [
        `${index + 1}. ${tab.title}`,
        `${tab.description}`,
        ""
      ]),
      "## 商店页截图文案",
      ...card.screenshotCopy.flatMap((copy, index) => [
        `${index + 1}. 标题：${copy.title}`,
        `副标题：${copy.subtitle}`,
        ""
      ]),
      "## 商店页文案",
      `应用名称：${card.metadata.name}`,
      `副标题：${card.metadata.subtitle}`,
      `描述：${card.metadata.description}`,
      `关键词：${card.metadata.keywords.join(", ")}`
    ];

    const blob = new Blob([lines.join("\n")], {
      type: "text/markdown;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const safeTitle = card.title.replace(/[\\/:*?\"<>|]/g, "-");
    anchor.href = url;
    anchor.download = `${safeTitle || "publish-card"}.md`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setGenerationHint("卡片已导出为 Markdown。");
  };

  return (
    <div className="publish-shell">
      <header className="publish-hero">
        <p className="publish-hero__eyebrow">发布工具 · AI 协作</p>
        <h1>AI 导向的作品输出小助手</h1>
        <p>
          输入产品方向、目标用户与核心体验后，点击「生成文案」即可在固定四栏框架里生成更可用于需求文档的内容；保存后可沉淀为卡片快照。
        </p>
      </header>

      <section className="publish-block publish-block--inputs">
        <div className="publish-block__header">
          <h2>输入区（只需填写产品方向）</h2>
          <p>更改输入后点击「生成文案」，系统会根据最新字段刷新 Tab、商店页文案与截图内容。</p>
        </div>
        <div className="publish-form">
          <label>
            <span>产品方向</span>
            <input
              type="text"
              value={fields.productDirection}
              onChange={handleFieldChange("productDirection")}
              placeholder="例如：香气记忆"
            />
          </label>
          <label>
            <span>目标用户</span>
            <input
              type="text"
              value={fields.targetUser}
              onChange={handleFieldChange("targetUser")}
              placeholder="例如：20-35岁喜欢记录日常的创意人"
            />
          </label>
          <label>
            <span>核心体验</span>
            <textarea
              rows={3}
              value={fields.experienceFlow}
              onChange={handleFieldChange("experienceFlow")}
              placeholder="例如：选择照片、写一句感受，系统自动提炼关键词。"
            />
          </label>
        </div>
        <div className="publish-actions">
          <button
            type="button"
            className="publish-button"
            onClick={handleGenerateClick}
            disabled={isGenerating || isSaving}
          >
            {isGenerating ? "生成中..." : "生成文案"}
          </button>
          <button
            type="button"
            className="publish-button publish-button--secondary"
            onClick={handleSave}
            disabled={isGenerating || isSaving}
          >
            {isSaving ? "保存中..." : "保存卡片"}
          </button>
          <p className="publish-actions__hint">{generationHint}</p>
        </div>
      </section>

      <section className="publish-block">
        <div className="publish-block__header">
          <h2>Tab 功能概览</h2>
          <p>固定输出四个主模块，分别承载主流程入口、内容管理、复盘洞察与设置支持。</p>
        </div>
        <div className="publish-grid">
          {tabs.map((tab) => (
            <article className="publish-card" key={tab.title}>
              <p className="publish-card__eyebrow">{tab.title}</p>
              <p className="publish-card__body">{tab.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="publish-block">
        <div className="publish-block__header">
          <h2>商店页截图文案</h2>
          <p>每张截图只保留标题与副标题，并以表格形式展示，便于直接整理进提报材料。</p>
        </div>
        <div className="publish-table-shell">
          <table className="publish-copy-table">
            <tbody>
              {screenshotCopy.map((copy, index) => (
                <Fragment key={copy.title}>
                  <tr>
                    <td className="publish-copy-table__index" rowSpan={2}>
                      {index + 1}
                    </td>
                    <td className="publish-copy-table__label">标题</td>
                    <td className="publish-copy-table__value">{copy.title}</td>
                  </tr>
                  <tr>
                    <td className="publish-copy-table__label">副标题</td>
                    <td className="publish-copy-table__value">{copy.subtitle}</td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div className="publish-metadata">
          <h3>商店页文案</h3>
          <div className="publish-metadata__row">
            <p>
              <strong>应用名称：</strong>
              {metadata.name}
            </p>
            {renderLimitStatus(metadata.name.length, 30, "字符")}
          </div>
          <div className="publish-metadata__row">
            <p>
              <strong>副标题：</strong>
              {metadata.subtitle}
            </p>
            {renderLimitStatus(metadata.subtitle.length, 30, "字符")}
          </div>
          <div className="publish-metadata__row">
            <p>
              <strong>描述：</strong>
              {metadata.description}
            </p>
            {renderLimitStatus(metadata.description.length, 4000, "字符")}
          </div>
          <div className="publish-metadata__row">
            <p>
              <strong>关键词：</strong>
              {metadata.keywords.join(", ")}
            </p>
            {renderLimitStatus(keywordBytes, 100, "bytes")}
          </div>
        </div>
      </section>

      <section className="publish-block">
        <div className="publish-block__header">
          <h2>保存卡片 / 展开详情</h2>
          <p>点击卡片即可恢复输入并查看当时的 Tab、商店页与 metadata 内容。</p>
        </div>
        <div className="publish-card-toolbar">
          <button
            type="button"
            className="publish-inline-button publish-inline-button--danger"
            onClick={handleClearAllCards}
            disabled={isEditingCard || isSaving || isGenerating}
          >
            清空全部卡片
          </button>
        </div>
        <div className="publish-saved-panel">
          <div className="publish-saved-list">
            {savedCards.map((card) => (
              <button
                key={card.id}
                type="button"
                className={`publish-chip ${card.id === activeCardId ? "is-active" : ""}`}
                onClick={() => handleCardSelect(card.id)}
              >
                <span>{card.title}</span>
                <small>{card.createdAt}</small>
              </button>
            ))}
          </div>
          <div className="publish-card-detail">
            {activeCard ? (
              <>
                <div className="publish-card-detail__head">
                  <h3>{activeCard.title}</h3>
                  <div className="publish-card-detail__actions">
                    <button
                      type="button"
                      className="publish-inline-button"
                      onClick={isEditingCard ? handleCancelCardEdit : handleStartCardEdit}
                    >
                      {isEditingCard ? "取消编辑" : "编辑"}
                    </button>
                    {isEditingCard ? (
                      <button
                        type="button"
                        className="publish-inline-button"
                        onClick={handleUpdateCard}
                      >
                        保存修改
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="publish-inline-button"
                      onClick={() => handleExportCard(activeCard)}
                      disabled={isEditingCard}
                    >
                      导出
                    </button>
                    <button
                      type="button"
                      className="publish-inline-button publish-inline-button--danger"
                      onClick={() => handleDeleteCard(activeCard.id)}
                      disabled={isEditingCard}
                    >
                      删除
                    </button>
                  </div>
                </div>
                {isEditingCard ? (
                  <div className="publish-card-editor">
                    <div className="publish-form publish-form--single">
                      <label>
                        <span>产品方向</span>
                        <input
                          type="text"
                          value={cardDraft.fields.productDirection}
                          onChange={handleDraftFieldChange("productDirection")}
                        />
                      </label>
                      <label>
                        <span>目标用户</span>
                        <input
                          type="text"
                          value={cardDraft.fields.targetUser}
                          onChange={handleDraftFieldChange("targetUser")}
                        />
                      </label>
                      <label>
                        <span>核心体验</span>
                        <textarea
                          rows={3}
                          value={cardDraft.fields.experienceFlow}
                          onChange={handleDraftFieldChange("experienceFlow")}
                        />
                      </label>
                    </div>
                    <details open>
                      <summary>Tab 功能概览</summary>
                      <div className="publish-edit-stack">
                        {cardDraft.tabs.map((tab, index) => (
                          <div className="publish-edit-card" key={`${activeCard.id}-tab-${index}`}>
                            <label>
                              <span>标题</span>
                              <input
                                type="text"
                                value={tab.title}
                                onChange={handleDraftTabChange(index, "title")}
                              />
                            </label>
                            <label>
                              <span>描述</span>
                              <textarea
                                rows={3}
                                value={tab.description}
                                onChange={handleDraftTabChange(index, "description")}
                              />
                            </label>
                          </div>
                        ))}
                      </div>
                    </details>
                    <details>
                      <summary>商店页截图文案</summary>
                      <div className="publish-edit-stack">
                        {cardDraft.screenshotCopy.map((copy, index) => (
                          <div className="publish-edit-card" key={`${activeCard.id}-copy-${index}`}>
                            <label>
                              <span>标题 {index + 1}</span>
                              <input
                                type="text"
                                value={copy.title}
                                onChange={handleDraftScreenshotChange(index, "title")}
                              />
                            </label>
                            <label>
                              <span>副标题 {index + 1}</span>
                              <input
                                type="text"
                                value={copy.subtitle}
                                onChange={handleDraftScreenshotChange(index, "subtitle")}
                              />
                            </label>
                          </div>
                        ))}
                      </div>
                    </details>
                    <details>
                      <summary>商店页文案</summary>
                      <div className="publish-form publish-form--single">
                        <label>
                          <span className="publish-edit-label">
                            <span>应用名称</span>
                            {renderLimitStatus(cardDraft.metadata.name.length, 30, "字符")}
                          </span>
                          <input
                            type="text"
                            value={cardDraft.metadata.name}
                            onChange={handleDraftMetadataChange("name")}
                          />
                        </label>
                        <label>
                          <span className="publish-edit-label">
                            <span>副标题</span>
                            {renderLimitStatus(cardDraft.metadata.subtitle.length, 30, "字符")}
                          </span>
                          <input
                            type="text"
                            value={cardDraft.metadata.subtitle}
                            onChange={handleDraftMetadataChange("subtitle")}
                          />
                        </label>
                        <label>
                          <span className="publish-edit-label">
                            <span>描述</span>
                            {renderLimitStatus(cardDraft.metadata.description.length, 4000, "字符")}
                          </span>
                          <textarea
                            rows={5}
                            value={cardDraft.metadata.description}
                            onChange={handleDraftMetadataChange("description")}
                          />
                        </label>
                        <label>
                          <span className="publish-edit-label">
                            <span>关键词（逗号分隔）</span>
                            {renderLimitStatus(draftKeywordBytes, 100, "bytes")}
                          </span>
                          <input
                            type="text"
                            value={cardDraft.metadata.keywords.join(", ")}
                            onChange={handleDraftMetadataChange("keywords")}
                          />
                        </label>
                      </div>
                    </details>
                  </div>
                ) : (
                  <>
                    <p className="publish-card-detail__tag">{activeCard.fields.targetUser}</p>
                    <p className="publish-card-detail__item">
                      <strong>产品方向：</strong>
                      {activeCard.fields.productDirection}
                    </p>
                    <p className="publish-card-detail__item">
                      <strong>核心体验：</strong>
                      {activeCard.fields.experienceFlow}
                    </p>
                    <details open>
                      <summary>Tab 功能概览</summary>
                      <ul>
                        {activeCard.tabs.map((tab) => (
                          <li key={tab.title}>
                            <strong>{tab.title}： </strong>
                            {tab.description}
                          </li>
                        ))}
                      </ul>
                    </details>
                    <details>
                      <summary>商店页截图文案</summary>
                      <div className="publish-table-shell publish-table-shell--compact">
                        <table className="publish-copy-table">
                          <tbody>
                            {activeCard.screenshotCopy.map((copy, index) => (
                              <Fragment key={copy.title}>
                                <tr>
                                  <td className="publish-copy-table__index" rowSpan={2}>
                                    {index + 1}
                                  </td>
                                  <td className="publish-copy-table__label">标题</td>
                                  <td className="publish-copy-table__value">{copy.title}</td>
                                </tr>
                                <tr>
                                  <td className="publish-copy-table__label">副标题</td>
                                  <td className="publish-copy-table__value">{copy.subtitle}</td>
                                </tr>
                              </Fragment>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                    <details>
                      <summary>商店页文案</summary>
                      <div className="publish-metadata__row">
                        <p>
                          <strong>应用名称：</strong>
                          {activeCard.metadata.name}
                        </p>
                        {renderLimitStatus(activeCard.metadata.name.length, 30, "字符")}
                      </div>
                      <div className="publish-metadata__row">
                        <p>
                          <strong>副标题：</strong>
                          {activeCard.metadata.subtitle}
                        </p>
                        {renderLimitStatus(activeCard.metadata.subtitle.length, 30, "字符")}
                      </div>
                      <div className="publish-metadata__row">
                        <p>
                          <strong>描述：</strong>
                          {activeCard.metadata.description}
                        </p>
                        {renderLimitStatus(activeCard.metadata.description.length, 4000, "字符")}
                      </div>
                      <div className="publish-metadata__row">
                        <p>
                          <strong>关键词：</strong>
                          {activeCard.metadata.keywords.join(", ")}
                        </p>
                        {renderLimitStatus(
                          utf8ByteLength(activeCard.metadata.keywords.join(",")),
                          100,
                          "bytes"
                        )}
                      </div>
                    </details>
                  </>
                )}
              </>
            ) : (
              <p>保存后点击卡片查看详情。</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
