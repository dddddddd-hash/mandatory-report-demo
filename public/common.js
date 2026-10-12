export const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
export const time = v => v ? new Date(v).toLocaleString("zh-CN", { hour12: false }) : "—";
let cachedChatUser;
export function chatUserId() {
  if (cachedChatUser) return cachedChatUser;
  try { const stored = localStorage.getItem("chatUserId"); if (/^[a-f0-9-]{36}$/i.test(stored || "")) return cachedChatUser = stored; cachedChatUser = crypto.randomUUID(); localStorage.setItem("chatUserId", cachedChatUser); } catch { cachedChatUser ||= crypto.randomUUID(); }
  return cachedChatUser;
}
export async function api(url, options = {}, role = "公安") { const r = await fetch(url, { ...options, headers: { "Content-Type": "application/json", "X-Demo-Role": encodeURIComponent(role), "X-Chat-User": chatUserId(), ...options.headers } }); const data = await r.json(); if (!r.ok) throw Error(data.error || "请求失败"); return data; }
export const post = (url, data, role) => api(url, { method: "POST", body: JSON.stringify(data) }, role);
export function toast(message) { const t = document.getElementById("toast"); t.textContent = message; t.hidden = false; clearTimeout(window.toastTimer); window.toastTimer = setTimeout(() => t.hidden = true, 5000); }
export function icon(name) {
  const paths = {
    shield: '<path d="M12 3 4 6v6c0 4 4 7 8 9 4-2 8-5 8-9V6l-8-3Z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    home: '<path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-7h6v7"/>',
    book: '<path d="M12 5C9 3 5 3 3 4v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-2-1-6-1-9 1Zm0 0v15"/>',
    heart: '<path d="M20.8 5.8a5 5 0 0 0-7.1 0L12 7.5l-1.7-1.7a5 5 0 0 0-7.1 7.1L12 22l8.8-9.1a5 5 0 0 0 0-7.1Z"/>',
    scale: '<path d="M12 3v18m-6 0h12M4 7h16M6 7l-4 8h8L6 7Zm12 0-4 8h8l-4-8Z"/>',
    inbox: '<path d="M5 4h14l3 13v3H2v-3L5 4Zm-3 12h6l2 3h4l2-3h6"/>',
    review: '<path d="M9 3H5v18h14V3h-4m-6 0h6v4H9V3Zm-1 10 3 3 5-5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    file: '<path d="M14 2H5v20h14V7l-5-5Zm0 0v6h5M8 13h8m-8 4h6"/>',
    spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>'
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.file}</svg>`;
}
export function openDialog(dialog) {
  if (!dialog.open) { dialog.showModal(); document.body.style.overflow = "hidden"; }
}
export function bindDialog(dialog) {
  dialog.addEventListener("close", () => { document.body.style.overflow = ""; });
}
