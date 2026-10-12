import { execFileSync } from "node:child_process";
import { models as legacyModels } from "./content.js";
import { modelBrand, displayModelName, canonicalModelId } from "./public/model-brand.js";

const allowedSecrets = new Set(["FREE_API_KEY", "FREE_API_KEY_2", "FREE_API_KEY_3", "FREE_API_KEY_4"]);
const credentials = new Map();
function credential(name) {
  if (!allowedSecrets.has(name)) throw Error("无效的模型通道配置");
  if (credentials.has(name)) return credentials.get(name);
  let value = process.env[name]?.trim();
  if (!value && process.platform === "win32") {
    try {
      value = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `$v=[Environment]::GetEnvironmentVariable('${name}','User'); if(!$v){$v=[Environment]::GetEnvironmentVariable('${name}','Machine')}; $v`], { encoding: "utf8", windowsHide: true, timeout: 5000 }).trim();
    } catch { /* Only availability, never a credential value, is exposed. */ }
  }
  credentials.set(name, value || ""); return value || "";
}
function apiBase(value) { const base = value.replace(/\/+$/, ""); return base.endsWith("/v1") ? base : base + "/v1"; }
const primary = apiBase(process.env.AI_BASE_URL || "https://api.fuka.win/v1");
const secondary = apiBase(process.env.AI_SECONDARY_BASE_URL || "https://jianzhile.vip/v1");
const third = apiBase(process.env.AI_KEY_3_BASE_URL || "https://api.fuka.win/v1");
const routes = new Map();
const identities = new Map();
const primaryKey = credential("FREE_API_KEY");
const publicModels = legacyModels.map(model => {
  routes.set(model.id, [{ endpoint: primary, key: primaryKey, upstreamId: model.id }]);
  identities.set(canonicalModelId(model.id), model.id);
  return { ...model, ...modelBrand(model.id), provider: "api.fuka.win", available: !!primaryKey };
});
const channels = [];
const selectedClaude = new Set(["claude-5-opus", "claude-fable-5"]);
const domesticBrands = new Set(["deepseek", "glm", "kimi", "minimax", "longcat"]);
const chatCapable = id => !/(?:embedding|rerank|whisper|tts|dall-e|image|imagen|veo|sora|stable-diffusion|flux)/i.test(id);
async function discover(slot) {
  const key = credential("FREE_API_KEY_" + slot);
  if (!key) return { slot, configured: false, state: "missing", models: [] };
  try {
    const configuredEndpoint = slot === 3 ? third : secondary;
    let endpoint = configuredEndpoint, response = await fetch(endpoint + "/models", { headers: { Authorization: `Bearer ${key}` }, redirect: "error", signal: AbortSignal.timeout(15000) });
    if (response.status === 404) {
      endpoint = configuredEndpoint.replace(/\/v1$/, "");
      response = await fetch(endpoint + "/models", { headers: { Authorization: `Bearer ${key}` }, redirect: "error", signal: AbortSignal.timeout(15000) });
    }
    if (!response.ok) return { slot, configured: true, state: "error", status: response.status, models: [] };
    const body = await response.json();
    if (!Array.isArray(body.data)) return { slot, configured: true, state: "invalid", models: [] };
    const models = body.data.filter(m => typeof m?.id === "string" && m.id.length <= 200 && chatCapable(m.id));
    return { slot, configured: true, state: models.length ? "ready" : "empty", models, endpoint, key };
  } catch { return { slot, configured: true, state: "unreachable", models: [] }; }
}
// Tests explicitly disable discovery or point both gateways at local protocol servers.
if (process.env.AI_CATALOG_ENABLED !== "0") {
  const results = await Promise.all([2, 3, 4].map(discover));
  for (const channel of results) {
    channels.push({ slot: channel.slot, configured: channel.configured, state: channel.state, modelCount: channel.models.length, ...(channel.status ? { status: channel.status } : {}) });
    for (const model of channel.models) {
      const identity = canonicalModelId(model.id);
      // Key 3 adds only the selected Claude editions and domestic models.
      // Existing options may still use this channel as a fallback route.
      if (channel.slot === 3 && !identities.has(identity) &&
          !selectedClaude.has(identity) && !domesticBrands.has(modelBrand(model.id, model.owned_by).brand)) continue;
      const id = identities.get(identity) || (channel.slot === 3 ? "fuka:" : "jianzhile:") + model.id;
      const route = { endpoint: channel.endpoint, key: channel.key, upstreamId: model.id };
      if (routes.has(id)) { routes.get(id).push(route); publicModels.find(m => m.id === id).available = true; continue; }
      routes.set(id, [route]);
      identities.set(identity, id);
      publicModels.push({ id, name: displayModelName(model.id), ...modelBrand(model.id, model.owned_by), provider: channel.slot === 3 ? "api.fuka.win" : "jianzhile.vip", available: true });
    }
  }
}
export function modelRoutes(id) {
  const candidates = routes.get(id);
  if (!candidates) { const error = Error("请选择已配置的模型"); error.status = 400; throw error; }
  return candidates;
}
export function modelConfig() {
  return { configured: publicModels.some(m => m.available), models: publicModels, defaultModel: primaryKey ? legacyModels[0].id : publicModels.find(m => m.available)?.id || legacyModels[0].id, provider: "多通道模型服务", channels, knowledgeBase: false, capabilities: { search: { enabled: true, strength: "medium", mode: "application-tool", maxResults: 5 }, images: false, memory: true, reportDrafts: true } };
}
