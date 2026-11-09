import { importImage } from "./lib/bridge";
import {
  MAX_BYTES,
  extFromContentType,
  extFromUrl,
  fileNameFromUrl,
  normalizeUrl,
  sniffExt,
  toBase64,
} from "./lib/media";

const MENU_ID = "stickerbox-save-image";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "存入 StickerBox",
      contexts: ["image"],
      // 只在 B 站页面出现：其他站点的图既没有 host 权限、也没有存的语义
      documentUrlPatterns: ["https://*.bilibili.com/*"],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== MENU_ID || !info.srcUrl) return;
  void saveImage(info.srcUrl);
});

/** 给 P3 的页面内按钮预留：页面脚本发 {type:'save', url} 即可复用同一条链路。 */
chrome.runtime.onMessage.addListener((message: { type?: string; url?: string }, _sender, sendResponse) => {
  if (message?.type !== "save" || !message.url) return false;
  saveImage(message.url).then(sendResponse, (e: unknown) =>
    sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }),
  );
  return true; // 异步响应
});

async function saveImage(rawUrl: string): Promise<{ ok: boolean; added?: boolean; error?: string }> {
  const url = normalizeUrl(rawUrl);
  try {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error(`抓图失败 HTTP ${res.status}`);

    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) {
      throw new Error(`图片 ${(bytes.byteLength / 1048576).toFixed(1)} MB，超过 10 MB 上限`);
    }

    const ext =
      sniffExt(bytes) ??
      extFromUrl(url) ??
      extFromContentType(res.headers.get("content-type"));
    if (!ext) throw new Error("认不出图片格式");

    const result = await importImage({
      ext,
      name: fileNameFromUrl(url, ext),
      source: "bilibili",
      source_ref: url,
      data: toBase64(bytes),
    });
    if (!result.ok) throw new Error(result.error ?? "入库失败");

    flash(result.added ? "✓" : "=", result.added ? "#2e7d32" : "#1565c0",
      result.added ? "已存入 StickerBox" : "库里已有这张，已跳过");
    return { ok: true, added: result.added };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    flash("!", "#c62828", `StickerBox 导入失败：${message}`);
    console.warn("[StickerBox]", message, url);
    return { ok: false, error: message };
  }
}

/** 点扩展图标时在角标上给个短反馈；悬停标题能看文字原因。 */
function flash(text: string, color: string, title: string) {
  void chrome.action.setBadgeBackgroundColor({ color });
  void chrome.action.setBadgeText({ text });
  void chrome.action.setTitle({ title });
  setTimeout(() => {
    void chrome.action.setBadgeText({ text: "" });
    void chrome.action.setTitle({ title: "StickerBox：右键图片可导入" });
  }, 3000);
}
