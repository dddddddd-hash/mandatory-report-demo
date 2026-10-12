import { legalContext, sources } from "./content.js";
import { readEvents } from "./public/event-stream.js";
import { modelConfig, modelRoutes } from "./model-registry.js";

export const defaultModel = modelConfig().defaultModel;
export function validateModel(model) {
  modelRoutes(model);
  return model;
}
export const aiConfig = modelConfig;
export const qaSystem = `你是未成年人保护与强制报告制度的问答助手，围绕案例、报告制度及相关保护实践，与用户自然交流。
根据用户的问题灵活展开，可以分析案例、解释制度、讨论沟通方式、报告流程或保护措施。先回答用户关心的内容，简单问题直接回答，复杂问题再适当展开；不强制固定结构、逐项清单或统一篇幅，也不必每次重复免责声明。
下方制度摘要是背景参考，不是回答范围的唯一来源。可以结合通用知识、合理推理和虚构示例帮助理解；虚构案例应说明是示例。区分已知事实、推测和建议，不编造真实案例出处、法条、判决或政策；不确定的内容说明不确定，不把初步分析当作最终法律认定。
讨论案例时使用匿名或虚构信息，不主动索取真实未成年人的姓名、电话、精确住址或图片。只有涉及现实紧急危险时，优先提醒安全与110求助。

本项目已有的制度背景参考（目前未接入专用案例知识库）：
${legalContext}
参考来源：
${sources.map(s => `${s.title} ${s.url}`).join("\n")}`;
export const feedbackSystem = `你是未成年人保护与强制报告实训的复盘教练，围绕本次案例、用户的沟通和作答提供反馈。
规则分数已经确定，保留总分和各项分数。结合五项评分和具体对话，解释做得好的地方、遗漏与可改进的做法，也可以补充与本案例相关的制度和保护实践。根据需要组织内容和展开，不限制固定篇幅。
下方制度摘要是背景参考，可以结合通用知识进行解释；不编造法条或真实案例出处，不确定之处说明不确定。提及模拟上报时，说明它只属于训练，未实际发送公安。
制度背景参考：${legalContext}`;
export async function complete(model, messages, onDelta) {
  const candidates = modelRoutes(model).filter(route => route.key);
  if (!candidates.length) { const e = Error("所选模型通道尚未配置密钥，请配置环境变量后重启服务"); e.status = 503; throw e; }
  let error, emitted = false;
  const deadline = Date.now() + Number(process.env.AI_TIMEOUT_MS || 60000);
  for (const route of candidates) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await invoke(route, messages, onDelta ? content => { emitted = true; onDelta(content); } : undefined, Math.max(1, deadline - Date.now())); }
      catch (e) {
        error = e; if (emitted) throw e;
        if (e.retryAfterMs && attempt < 2 && Date.now() + e.retryAfterMs + 500 < deadline) { await new Promise(resolve => setTimeout(resolve, e.retryAfterMs)); continue; }
        break;
      }
    }
    if (Date.now() >= deadline) break;
  }
  throw error;
}
async function invoke({ endpoint, key, upstreamId }, messages, onDelta, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint + "/chat/completions", {
      method: "POST", redirect: "error", signal: controller.signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json; charset=utf-8", Accept: onDelta ? "text/event-stream" : "application/json" },
      body: JSON.stringify({ model: upstreamId, messages, temperature: 0.5, max_tokens: 2048, stream: !!onDelta })
    });
    if (!response.ok) {
      const error = Error(response.status === 429 ? "模型服务限流，请稍后重试或切换模型" : response.status === 401 || response.status === 403 ? "模型服务鉴权失败，请检查服务端密钥权限" : `模型服务返回 HTTP ${response.status}，请重试或切换模型`);
      const retryAfter = Number(response.headers.get("retry-after"));
      if (response.status === 429 && retryAfter > 0 && retryAfter <= 10) error.retryAfterMs = retryAfter * 1000;
      error.status = 502; throw error;
    }
    let content;
    if (onDelta) {
      if (!response.headers.get("content-type")?.includes("text/event-stream")) { const e = Error("模型服务未返回流式响应，请重试或切换模型"); e.status = 502; throw e; }
      content = "";
      let finished = false;
      await readEvents(response.body, ({ data }) => {
        if (data.trim() === "[DONE]") { finished = true; return false; }
        const chunk = JSON.parse(data);
        if (chunk.error) { const e = Error("模型流式响应中断，请重试或切换模型"); e.status = 502; throw e; }
        const choice = chunk.choices?.[0];
        if (choice?.finish_reason) finished = true;
        const delta = choice?.delta?.content;
        if (typeof delta === "string" && delta) {
          if (content.length + delta.length > 20000) { const e = Error("模型回复过长，请缩短问题后重试"); e.status = 502; throw e; }
          content += delta; onDelta(delta);
        }
      });
      if (!finished) { const e = Error("模型连接中断，回答尚未完成，请重试"); e.status = 502; throw e; }
    } else {
      const data = await response.json();
      content = data.choices?.[0]?.message?.content;
    }
    if (typeof content !== "string" || !content.trim()) { const e = Error("模型未返回有效文本，请重试或切换模型"); e.status = 502; throw e; }
    return content.trim().slice(0, 20000);
  } catch (e) {
    if (e.status) throw e;
    const error = Error(controller.signal.aborted ? "模型响应超时，请重试或切换模型" : "暂时无法连接模型服务，请重试或切换模型");
    error.status = 502; throw error;
  } finally { clearTimeout(timeout); }
}
