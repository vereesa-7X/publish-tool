
"use client";

const descriptionText = `选择照片、填写关键词与句子感受，系统自动提炼气味、口感与情绪标签。
按标签、口味或场景浏览所有记录卡，支持快速搜索与收藏。
以时间轴和故事卡视图展现不同咖啡时刻的感受变化。`;

import { useState } from "react";

const defaultFields = {
  productIdea: "照片咖啡",
  targetUser: "20-35岁喜欢记录日常的创意人",
  coreExperience: "按时间整理咖啡照片 → 记录风味与感受 → 生成可分享的故事卡",
  keywords: "照片咖啡,coffee,memo,story"
};

const modules = [
  {
    title: "风味记录",
    text:
      "选择照片、填写关键词与句子感受，系统自动提炼气味、口感与情绪标签，形成高保真记忆卡片。"
  },
  {
    title: "风味笔记",
    text:
      "按标签、口味或场景浏览所有记录卡，支持快速搜索与收藏，形成自己的味道画册。"
  },
  {
    title: "咖啡时刻",
    text:
      "以时间轴和故事卡视图展现不同咖啡时刻的感受变化，帮助你回看心情的前后流动。"
  }
];

const galleryHeadings = [
  { label: "首页", title: "风味记录：上传咖啡照片，记录风味关键词与当下感受" },
  { label: "风味笔记", title: "按口味/标签浏览，收集自己的味道画册" },
  { label: "咖啡时刻", title: "时间/场景维度，回看心情变化" },
  { label: "设置", title: "隐私政策、用户协议、版本信息" }
];

function buildStoreEntries() {
  return [
    {
      title: "风味记录",
      subtitle: "上传、标记、保存"
    },
    {
      title: "标签管理",
      subtitle: "按口味/场景归档"
    },
    {
      title: "相册整理",
      subtitle: "一键回顾与收藏"
    },
    {
      title: "日历回顾",
      subtitle: "时间轴故事卡"
    }
  ];
}

function buildDescriptionLines() {
  return descriptionText.split('\n');
}

export function PublishToolApp(): React.JSX.Element {
  const [fields, setFields] = useState(defaultFields);
  const [storeEntries, setStoreEntries] = useState(buildStoreEntries());
  const [savedCards, setSavedCards] = useState<{
    title: string;
    createdAt: string;
    description: string;
    targetUser: string;
    coreExperience: string;
  }[]>([]);
  const [showCard, setShowCard] = useState<string | null>(null);

  function handleGenerate() {
    setStoreEntries(buildStoreEntries());
  }

  return (
    <main className="publish-shell">
      <section className="publish-panel">
        <header className="publish-heading">
          <h1>Publish Tool</h1>
          <p>按照基础包格式，生成规范的商店页文案与产品信息。</p>
        </header>

        <article className="publish-box">
          <h2>输入区</h2>
          <div className="publish-fields">
            <label>
              产品方向
              <input
                value={fields.productIdea}
                onChange={(event) => setFields((prev) => ({ ...prev, productIdea: event.target.value }))}
                placeholder="照片咖啡"
              />
            </label>
            <label>
              目标用户 / 调性
              <input
                value={fields.targetUser}
                onChange={(event) => setFields((prev) => ({ ...prev, targetUser: event.target.value }))}
                placeholder="20-35岁..."
              />
            </label>
            <label>
              核心体验流程
              <textarea
                value={fields.coreExperience}
                onChange={(event) => setFields((prev) => ({ ...prev, coreExperience: event.target.value }))}
              />
            </label>
          </div>
          <div className="publish-actions">
            <button type="button" className="publish-button" onClick={handleGenerate}>
              生成文案
            </button>
            <button
              type="button"
              className="publish-button secondary"
            onClick={() => {
              if (!savedCards.some((card) => card.title === fields.productIdea)) {
                setSavedCards((cards) => [
                  ...cards,
                  {
                    title: fields.productIdea,
                    createdAt: new Date().toLocaleString(),
                    description: descriptionText,
                    targetUser: fields.targetUser,
                    coreExperience: fields.coreExperience
                  }
                ]);
              }
            }}
            >
              保存
            </button>
          </div>
        </article>

        <article className="publish-box">
          <h2>Tab 功能概览</h2>
          <div className="publish-tabs">
            {galleryHeadings.map((item) => (
              <div key={item.title} className="publish-tab">
                <strong>{item.label}</strong>
                <p>{item.title}</p>
              </div>
            ))}
          </div>
        </article>

        <article className="publish-box">
          <h2>商店页文案</h2>
          <p>应用名称：照片咖啡 Memo</p>
          <p>副标题：{fields.targetUser} 的感受记录神器</p>
          <p>关键词：{fields.keywords}</p>
          <div className="publish-description">
            <strong>描述</strong>
            {descriptionText.split('\n').map((line, idx) => (
              <p key={line}>
                <strong>{modules[idx].title}：</strong><span>{line}</span>
              </p>
            ))}
          </div>
        </article>

        <article className="publish-box">
          <h2>商店页截图文案</h2>
          <div className="publish-table">
            <div className="publish-table-head">
              <span>序号</span>
              <span>标题</span>
              <span>副标题</span>
            </div>
            {storeEntries.map((item, index) => (
              <div className="publish-table-row" key={item.title}>
                <span>{index + 1}</span>
                <span>{item.title}</span>
                <span>{item.subtitle}</span>
              </div>
            ))}
          </div>
        </article>

        {savedCards.length > 0 ? (
          <article className="publish-box saved-cards">
            <h2>已保存卡片</h2>
            <div className="publish-card-list">
              {savedCards.map((card) => (
                <button
                  key={card.title}
                  type="button"
                  className={card.title === showCard ? "card is-active" : "card"}
                  onClick={() => setShowCard(card.title)}
                >
                  <strong>{card.title}</strong>
                  <span>{card.createdAt}</span>
                </button>
              ))}
            </div>
            {showCard ? (
              <div className="publish-card-detail">
                <h3>{showCard}</h3>
                <p>{savedCards.find((card) => card.title === showCard)?.description}</p>
              </div>
            ) : null}
          </article>
        ) : null}
      </section>
    </main>
  );
}
