import { api } from "/common.js";
import { accountState } from "/account.js";
const storageKey = owner => `reportDrafts:v1:${owner}`;
const activeKey = owner => `activeReportDraft:v1:${owner}`;
const pending = new Map(), work = new Map(), revisions = new Map(), blocked = new Map();
const cloud = owner => accountState?.authenticated && accountState.ownerId === owner;
const sameContent = (a, b) => JSON.stringify(a.fields) === JSON.stringify(b.fields) && a.scrollY === b.scrollY;
function acceptSaved(owner, saved, snapshot) {
  const key = owner + ":" + saved.id; revisions.set(key, saved.revision);
  const drafts = listDrafts(owner), local = drafts.find(d => d.id === saved.id);
  if (local) { local.revision = saved.revision; local._dirty = !sameContent(local, snapshot); localStorage.setItem(storageKey(owner), JSON.stringify(drafts)); }
}
function queueDraft(owner, draft) {
  const key = owner + ":" + draft.id;
  if (!revisions.has(key)) revisions.set(key, draft.revision || 0);
  clearTimeout(pending.get(key)?.timer);
  if (blocked.has(key)) return;
  pending.set(key, { owner, draft: JSON.parse(JSON.stringify(draft)), timer: setTimeout(() => flushDrafts(owner).catch(error => window.dispatchEvent(new CustomEvent("draft-sync-error", { detail: error.message }))), 250) });
}
export async function syncDrafts(owner) {
  if (!cloud(owner)) return;
  await flushDrafts(owner);
  const drafts = await api("/api/drafts");
  for (const local of listDrafts(owner).filter(d => d._dirty)) {
    const index = drafts.findIndex(d => d.id === local.id), remote = drafts[index], key = owner + ":" + local.id;
    if (remote && sameContent(local, remote)) continue;
    // Preserve edits made while GET was in flight, including edits in another tab.
    if ((!remote && !local.revision) || remote?.revision === local.revision) { if (index < 0) drafts.unshift(local); else drafts[index] = local; queueDraft(owner, local); }
    else {
      const backupKey = `reportDraftConflictBackups:v1:${owner}`;
      const backups = JSON.parse(localStorage.getItem(backupKey) || "[]"); backups.unshift(local); localStorage.setItem(backupKey, JSON.stringify(backups));
      blocked.delete(key);
    }
  }
  for (const draft of drafts) if (!pending.has(owner + ":" + draft.id) && !work.has(owner + ":" + draft.id)) revisions.set(owner + ":" + draft.id, draft.revision || 0);
  localStorage.setItem(storageKey(owner), JSON.stringify(drafts));
  if (!drafts.some(d => d.id === localStorage.getItem(activeKey(owner)))) clearActiveDraft(owner);
}
export async function flushDrafts(owner, keepalive = false) {
  const tasks = [];
  for (const [key, item] of pending) if (item.owner === owner) {
    clearTimeout(item.timer); pending.delete(key);
    const promise = (work.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
      if (blocked.has(key)) throw blocked.get(key);
      try {
        const saved = await api("/api/drafts/" + item.draft.id, { method: "PUT", body: JSON.stringify({ ...item.draft, revision: revisions.get(key) || 0 }), keepalive });
        acceptSaved(owner, saved, item.draft);
      } catch (error) { if ([409, 410].includes(error.status)) blocked.set(key, error); throw error; }
    });
    work.set(key, promise); tasks.push(promise);
    promise.finally(() => { if (work.get(key) === promise) work.delete(key); }).catch(() => {});
  }
  for (const [key, promise] of work) if (key.startsWith(owner + ":")) tasks.push(promise);
  await Promise.all(tasks);
  for (const [key, error] of blocked) if (key.startsWith(owner + ":")) throw error;
}
window.addEventListener("pagehide", () => { if (accountState?.authenticated) flushDrafts(accountState.ownerId, true).catch(() => {}); });
export function listDrafts(owner) {
  const values = JSON.parse(localStorage.getItem(storageKey(owner)) || "[]");
  return Array.isArray(values) ? values.filter(d => d && typeof d.id === "string" && d.fields) : [];
}
export function getDraft(owner, id) { return listDrafts(owner).find(d => d.id === id); }
export function activeDraft(owner) { return getDraft(owner, localStorage.getItem(activeKey(owner))); }
export function saveDraft(owner, draft) {
  const drafts = listDrafts(owner), index = drafts.findIndex(d => d.id === draft.id);
  const saved = { ...draft, revision: drafts[index]?.revision || draft.revision || 0, _dirty: !!cloud(owner) };
  if (index < 0) drafts.unshift(saved); else drafts[index] = saved;
  localStorage.setItem(storageKey(owner), JSON.stringify(drafts));
  localStorage.setItem(activeKey(owner), draft.id);
  if (cloud(owner)) {
    queueDraft(owner, saved);
  }
}
export function clearActiveDraft(owner) { localStorage.removeItem(activeKey(owner)); }
export async function removeDraft(owner, id) {
  if (cloud(owner)) { await flushDrafts(owner); await api("/api/drafts/" + id, { method: "DELETE", body: JSON.stringify({ revision: revisions.get(owner + ":" + id) || getDraft(owner, id)?.revision || 0 }) }); revisions.delete(owner + ":" + id); }
  localStorage.setItem(storageKey(owner), JSON.stringify(listDrafts(owner).filter(d => d.id !== id)));
  if (localStorage.getItem(activeKey(owner)) === id) clearActiveDraft(owner);
  return storeLocalAttachment(owner, id, null);
}
let database;
function openDatabase() {
  return database ||= new Promise((resolve, reject) => {
    const request = indexedDB.open("reportDraftAttachments", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch(error => { database = null; throw error; });
}
export async function storeAttachment(owner, id, file) {
  await storeLocalAttachment(owner, id, file);
  if (cloud(owner)) {
    await flushDrafts(owner);
    const data = file ? await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(",")[1]); reader.onerror = reject; reader.readAsDataURL(file); }) : null;
    const mime = file?.type || ({ txt: "text/plain", pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", mp4: "video/mp4" }[file?.name.split(".").pop().toLowerCase()] || "");
    const key = owner + ":" + id;
    const promise = (work.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
      if (blocked.has(key)) throw blocked.get(key);
      const saved = await api("/api/drafts/" + id + "/attachment", { method: "PUT", body: JSON.stringify({ revision: revisions.get(key) || 0, attachment: file ? { name: file.name, mime, data } : null }) });
      revisions.set(key, saved.revision);
      const drafts = listDrafts(owner), local = drafts.find(d => d.id === id); if (local) { local.revision = saved.revision; local.attachmentName = saved.attachmentName; localStorage.setItem(storageKey(owner), JSON.stringify(drafts)); }
    }).catch(error => { if ([409, 410].includes(error.status)) blocked.set(key, error); throw error; });
    work.set(key, promise);
    promise.finally(() => { if (work.get(key) === promise) work.delete(key); }).catch(() => {});
    await promise;
  }
}
async function storeLocalAttachment(owner, id, file) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("files", "readwrite"), files = transaction.objectStore("files"), key = `${owner}:${id}`;
    if (file) files.put(file, key); else files.delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error || Error("附件保存失败"));
  });
}
export async function loadAttachment(owner, id) {
  if (cloud(owner)) {
    const value = await api("/api/drafts/" + id + "/attachment");
    if (!value) return null;
    return new File([Uint8Array.from(atob(value.data), c => c.charCodeAt(0))], value.name, { type: value.mime });
  }
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction("files").objectStore("files").get(`${owner}:${id}`);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
