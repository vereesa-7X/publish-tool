import type { SkillCard } from "@/apps/tunee/lib/types/tunee";

export const skillCards: SkillCard[] = [
  {
    id: "lyrics",
    name: "Lyrics Skill",
    summary: "把用户 brief 变成可唱的段落、hook 和副歌版本。",
    output: "歌词版本"
  },
  {
    id: "music-prompt",
    name: "Music Prompt Skill",
    summary: "把歌词和风格方向整理成音乐生成模型更容易理解的 prompt。",
    output: "音乐 prompt 版本"
  },
  {
    id: "music-generate",
    name: "Generate Music Skill",
    summary: "把最新 prompt 交给音乐 provider，并把结果记录进项目历史。",
    output: "生成记录"
  },
  {
    id: "taste-memory",
    name: "Taste Memory",
    summary: "记住语言、曲风、声线、不要什么，为下一轮创作提供偏好上下文。",
    output: "长期偏好"
  }
];
