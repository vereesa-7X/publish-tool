export type Fields = {
  productDirection: string;
  targetUser: string;
  experienceFlow: string;
};

export type TabBlock = {
  title: string;
  description: string;
};

export type ScreenshotCopy = {
  title: string;
  subtitle: string;
};

export type Metadata = {
  name: string;
  subtitle: string;
  description: string;
  keywords: string[];
};

export const defaultFields: Fields = {
  productDirection: "照片清理助手",
  targetUser: "相册内容多、手机存储紧张的 iPhone 用户",
  experienceFlow:
    "扫描相册后自动识别重复照片、相似照片和大文件，用户可快速勾选并清理，释放存储空间。"
};

function clampText(value: string, maxChars: number): string {
  return value.trim().slice(0, maxChars).trim();
}

function buildSafeSubtitle(fields: Fields): string {
  const candidates = [
    `${fields.productDirection}智能整理工具`,
    `${fields.productDirection}高效管理助手`,
    `${fields.productDirection}一键整理方案`
  ];

  return candidates.map((item) => clampText(item, 30)).find(Boolean) || "高效整理助手";
}

export function buildFallbackTabs(fields: Fields): TabBlock[] {
  return [
    {
      title: "生成页",
      description: `输入或上传与${fields.productDirection}相关的内容后，系统生成可查看的结果卡片，并支持继续保存或进入下一步整理。`
    },
    {
      title: "档案馆",
      description: `集中浏览历史生成记录和已保存卡片，支持按时间或主题查看，便于持续管理${fields.productDirection}相关内容。`
    },
    {
      title: "回看页",
      description: `以时间线、日历或场景视角回看生成结果，帮助用户从历史记录中快速定位某次${fields.productDirection}内容。`
    },
    {
      title: "设置",
      description: "统一管理隐私政策、用户协议、通知开关、反馈入口和版本信息，保持使用规则清晰可查。"
    }
  ];
}

export function buildScreenshotCopy(fields: Fields): ScreenshotCopy[] {
  return [
    {
      title: "智能扫描",
      subtitle: `扫描相册并识别${fields.productDirection}内容`
    },
    {
      title: "相册整理",
      subtitle: `快速筛出重复照片和大文件`
    },
    {
      title: "清理回看",
      subtitle: `回看清理结果和空间释放情况`
    },
    {
      title: "设置",
      subtitle: "统一管理隐私权限与使用设置"
    }
  ];
}

export function buildMetadata(fields: Fields): Metadata {
  const name = clampText(fields.productDirection, 30) || "灵感记录";
  const subtitle = buildSafeSubtitle(fields);
  const description = clampText(
    `${fields.experienceFlow} 帮助用户高效完成核心任务，并沉淀可持续复用的内容与记录。`,
    180
  );

  return {
    name,
    subtitle,
    description,
    keywords: [fields.productDirection, "记录", "整理", "效率"]
  };
}
