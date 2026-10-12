// Provider identity is independent of model version and gateway route.
const brands = {
  gemini: { name: "Gemini", icon: "/assets/Gemini.svg" },
  openai: { name: "OpenAI", icon: "/assets/OpenAI.svg" },
  claude: { name: "Claude", icon: "/assets/Claude.svg" },
  deepseek: { name: "DeepSeek", icon: "/assets/deepseek.svg" },
  grok: { name: "xAI", icon: "/assets/GROK.svg" },
  glm: { name: "智谱", icon: "/assets/GLM.svg" },
  kimi: { name: "Moonshot", icon: "/assets/kimi.svg" },
  minimax: { name: "MiniMax", icon: "/assets/minimax-color.svg" },
  longcat: { name: "LongCat", icon: "/assets/longcat-bright.svg" },
  generic: { name: "AI", icon: "/assets/AI.svg" }
};
export const rawModelId = id => String(id || "").replace(/^(?:jianzhile|fuka):/, "");
export const canonicalModelId = id => rawModelId(id).replace(/^\[[^\]]+\]/, "").replace(/[\u2460-\u2473\u3251-\u325f\u32b1-\u32bf]+$/u, "").toLowerCase();
export function modelBrand(id, owner = "") {
  const label = canonicalModelId(id);
  const brand = /gemini/.test(label) ? "gemini" : /gpt|chatgpt|codex|(?:^|[\/:])o[1-9](?:-|$)/.test(label) ? "openai" : /claude/.test(label) ? "claude" : /deepseek/.test(label) ? "deepseek" : /grok/.test(label) ? "grok" : /glm/.test(label) ? "glm" : /kimi|moonshot/.test(label) ? "kimi" : /minimax/.test(label) ? "minimax" : /longcat/.test(label) ? "longcat" : /openai/i.test(owner) ? "openai" : "generic";
  return { brand, brandName: brands[brand].name, icon: brands[brand].icon };
}
export function displayModelName(id) {
  const raw = canonicalModelId(id);
  if (/^gpt-/i.test(raw)) return "GPT-" + raw.slice(4).split("-").map(word => word[0]?.toUpperCase() + word.slice(1)).join(" ");
  if (/^gemini-/i.test(raw)) return "Gemini " + raw.slice(7).split("-").map(word => word[0]?.toUpperCase() + word.slice(1)).join(" ");
  if (/^claude-/i.test(raw)) return "Claude " + raw.slice(7).split("-").map(word => word[0]?.toUpperCase() + word.slice(1)).join(" ");
  if (/^deepseek-/i.test(raw)) return "DeepSeek " + raw.slice(9).split("-").map(word => word[0]?.toUpperCase() + word.slice(1)).join(" ");
  if (/^glm-/i.test(raw)) return "GLM-" + raw.slice(4);
  return raw;
}
