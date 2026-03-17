# AI 测款与上架工作台

首页现在是一个面向工具产品团队的 AI 工作台原型，用来把“产品方向输入 → 定位建议 → 上架 metadata → A/B 版本对比 → 实验计划”串成一个可演示的 MVP。

当前版本已经实现：

- 工具产品测款场景的输入表单
- 结构化输出定位建议、PRD 大纲和功能模块
- 生成两套 App Store metadata 版本
- 输出国家版本建议与实验计划
- 若配置了 OpenAI 兼容模型，优先走实时 AI 生成；否则自动回退到模板推演

原来的音乐聊天 demo 仍然保留在 `/tunee`。

## 这版 demo 的定位

这不是最终生产架构，而是为了尽快做出一个适合面试展示的 AI 产品原型：

`tool-product context + AI-assisted launch planning + version comparison + experiment design`

现在的重点是：让这个工作台能把你的久邦相关经历自然翻译成“AI 产品经理作品”。

## 当前架构

- `Next.js App Router`
  - 工作台首页
  - API routes
- `Launchpad generator`
  - 优先走 OpenAI 兼容接口
  - 失败时回退到模板推演
- `Legacy TUNEE demo`
  - 仍保留在 `/tunee`

## 关键目录

```text
src/
  app/
    api/
      chat/route.ts
      conversations/route.ts
      publish-tool/route.ts
      state/route.ts
    globals.css
    layout.tsx
    page.tsx
    tunee/page.tsx
  components/
    publish-tool-app.tsx
    tunee-demo-app.tsx
  lib/
    bootstrap.ts
    config.ts
    publish-tool/
      generate-launchpad.ts
      live-generator.ts
      mock-generator.ts
      schema.ts
    mastra/
      live-engine.ts
      mock-engine.ts
      shared-turn.ts
      tunee-agent.ts
    memory/
      taste-memory.ts
    projects/
      project-store.ts
    providers/
      music-provider.ts
  types/
    tunee.ts
```

## 启动方式

```bash
./run-demo.sh
```

然后访问首页：

```text
http://localhost:3000
```

原音乐 demo 在：

```text
http://localhost:3000/tunee
```

脚本会优先使用你系统里的 `node/npm`。
如果系统里没有，也会尝试使用项目内的 `.tools/node/` 运行时。

## 检查命令

```bash
./check-demo.sh
```

它会执行：

- `npm run lint`
- `npm run build`

## 环境变量

`.env.local` 里至少支持这些：

```bash
OPENAI_API_KEY=
OPENAI_BASE_URL=
DEFAULT_MODEL_ID=demo/mock
MUSIC_PROVIDER_BASE_URL=https://api.wike.cc
MUSIC_PROVIDER_API_KEY=
MUSIC_PROVIDER_MODEL=chirp-v4-5
MOCK_MUSIC_PROVIDER=true
```

### 模型

- 只要求 OpenAI 兼容协议
- 页面里可以直接改 `modelId`
- 如果 `DEFAULT_MODEL_ID=demo/mock`，就走 mock 路径

### 音乐生成

- `MOCK_MUSIC_PROVIDER=true` 时，走 mock provider
- `MOCK_MUSIC_PROVIDER=false` 且提供 `MUSIC_PROVIDER_API_KEY` 时，走真实 provider
- 真实 provider 结果会通过 `/api/state` 自动轮询刷新，并回填到聊天历史中的音频卡片

## 交互逻辑

首页工作台会根据你输入的工具产品方向、目标用户、国家和商业模式，输出一份结构化方案，包括：

- 一句话定位和为什么先测这个方向
- PRD 大纲与功能模块建议
- 两套 metadata 文案和截图标题
- 国家版本的表达建议
- 首轮实验假设、指标与止损条件

如果环境里配置了可用的 OpenAI 兼容模型，页面会优先请求实时生成；否则自动回退到本地模板逻辑。

## Demo 和最终方案的关系

这版 demo 选择了最快能落地、也最接近最终产品体验的路线。

如果明天继续往最终方案走，推荐方向是：

- 存储从 JSON 升级到 `Postgres`
- 记忆和检索升级到 `pgvector`
- 音乐/视频长任务接入队列系统
- skills 做版本化与评估
- 进一步拆出正式的 agent orchestration 层

`LangChain` 当然能做，但如果你是为了尽快做成一个能跑、能展示、能继续扩展的产品原型，这一版基于 `Mastra + custom orchestration` 更直接，也更省事。
