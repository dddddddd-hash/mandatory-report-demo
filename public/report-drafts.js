const storageKey = owner => `reportDrafts:v1:${owner}`;
const activeKey = owner => `activeReportDraft:v1:${owner}`;
export function listDrafts(owner) {
  const values = JSON.parse(localStorage.getItem(storageKey(owner)) || "[]");
  return Array.isArray(values) ? values.filter(d => d && typeof d.id === "string" && d.fields) : [];
}
export function getDraft(owner, id) { return listDrafts(owner).find(d => d.id === id); }
export function activeDraft(owner) { return getDraft(owner, localStorage.getItem(activeKey(owner))); }
export function saveDraft(owner, draft) {
  const drafts = listDrafts(owner), index = drafts.findIndex(d => d.id === draft.id);
  if (index < 0) drafts.unshift(draft); else drafts[index] = draft;
  localStorage.setItem(storageKey(owner), JSON.stringify(drafts));
  localStorage.setItem(activeKey(owner), draft.id);
}
export function clearActiveDraft(owner) { localStorage.removeItem(activeKey(owner)); }
export function removeDraft(owner, id) {
  localStorage.setItem(storageKey(owner), JSON.stringify(listDrafts(owner).filter(d => d.id !== id)));
  if (localStorage.getItem(activeKey(owner)) === id) clearActiveDraft(owner);
  return storeAttachment(owner, id, null);
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
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("files", "readwrite"), files = transaction.objectStore("files"), key = `${owner}:${id}`;
    if (file) files.put(file, key); else files.delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error || Error("附件保存失败"));
  });
}
export async function loadAttachment(owner, id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction("files").objectStore("files").get(`${owner}:${id}`);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
