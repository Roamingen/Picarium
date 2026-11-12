import { copyAsset, copyRaw, importImage } from "./lib/bridge";
import {
  MAX_BYTES,
  extFromContentType,
  extFromUrl,
  fileNameFromUrl,
  normalizeUrl,
  sniffExt,
  toBase64,
} from "./lib/media";

const SAVE_MENU_ID = "stickerbox-save-image";
const COPY_SAVE_MENU_ID = "stickerbox-copy-save-image";
const COPY_ONLY_MENU_ID = "stickerbox-copy-only-image";
const MENU_DOMAINS = ["https://*.bilibili.com/*"];

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: SAVE_MENU_ID,
      title: "存入 StickerBox",
      contexts: ["image"],
      // 只在 B 站页面出现：其他站点的图既没有 host 权限、也没有存的语义
      documentUrlPatterns: MENU_DOMAINS,
    });
    chrome.contextMenus.create({
      id: COPY_SAVE_MENU_ID,
      title: "复制并保存到 StickerBox",
      contexts: ["image"],
      documentUrlPatterns: MENU_DOMAINS,
    });
    chrome.contextMenus.create({
      id: COPY_ONLY_MENU_ID,
      title: "仅复制（不存入）",
      contexts: ["image"],
      documentUrlPatterns: MENU_DOMAINS,
    });
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (!info.srcUrl) return;
  if (info.menuItemId === SAVE_MENU_ID) void saveImage(info.srcUrl);
  else if (info.menuItemId === COPY_SAVE_MENU_ID) void copyImage(info.srcUrl);
  else if (info.menuItemId === COPY_ONLY_MENU_ID) void copyOnly(info.srcUrl);
});

interface Reply {
  ok: boolean;
  added?: boolean;
  copied?: boolean;
  error?: string;
}

/** P3 页面按钮 / 菜单共用一条链路：{type:'save'|'copy', url}。 */
chrome.runtime.onMessage.addListener(
  (message: { type?: string; url?: string }, _sender, sendResponse) => {
    if (!message?.url) return false;
    if (message.type === "save") {
      saveImage(message.url).then(sendResponse, (e: unknown) =>
        sendResponse({ ok: false, error: String(e) }),
      );
      return true;
    }
    if (message.type === "copy") {
      copyImage(message.url).then(sendResponse, (e: unknown) =>
        sendResponse({ ok: false, error: String(e) }),
      );
      return true;
    }
    if (message.type === "copyOnly") {
      copyOnly(message.url).then(sendResponse, (e: unknown) =>
        sendResponse({ ok: false, error: String(e) }),
      );
      return true;
    }
    return false;
  },
);

interface Grabbed {
  url: string;
  bytes: Uint8Array;
  ext: string;
  name: string;
}

async function grab(rawUrl: string): Promise<Grabbed> {
  const url = normalizeUrl(rawUrl);
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

  return { url, bytes, ext, name: fileNameFromUrl(url, ext) };
}

async function pushToLibrary(g: Grabbed, quiet = false): Promise<{ sha: string; added: boolean }> {
  const result = await importImage({
    ext: g.ext,
    name: g.name,
    source: "bilibili",
    source_ref: g.url,
    data: toBase64(g.bytes),
    quiet,
  });
  if (!result.ok || !result.sha) throw new Error(result.error ?? "入库失败");
  return { sha: result.sha, added: result.added !== false };
}

async function saveImage(rawUrl: string): Promise<Reply> {
  try {
    const { added } = await pushToLibrary(await grab(rawUrl));
    flash(
      added ? "✓" : "=",
      added ? "#2e7d32" : "#1565c0",
      added ? "已存入 StickerBox" : "库里已有这张，已跳过",
    );
    return { ok: true, added };
  } catch (e) {
    return failed(e, rawUrl, "导入失败");
  }
}

/** 复制并保存：先入库再按 sha 把原文件放进剪贴板。 */
async function copyImage(rawUrl: string): Promise<Reply> {
  try {
    const g = await grab(rawUrl);
    const { sha } = await pushToLibrary(g, true);
    const copied = await copyAsset(sha);
    if (!copied.ok) throw new Error(copied.error ?? "复制失败");
    flash("✓", "#2e7d32", "已复制并存入 StickerBox");
    return { ok: true, copied: true };
  } catch (e) {
    return failed(e, rawUrl, "复制失败");
  }
}

/** 仅复制：不写库，桌面端落临时文件后进剪贴板。 */
async function copyOnly(rawUrl: string): Promise<Reply> {
  try {
    const g = await grab(rawUrl);
    const copied = await copyRaw({ ext: g.ext, name: g.name, data: toBase64(g.bytes) });
    if (!copied.ok) throw new Error(copied.error ?? "复制失败");
    flash("✓", "#2e7d32", "已复制为文件，去聊天窗口直接粘贴");
    return { ok: true, copied: true };
  } catch (e) {
    return failed(e, rawUrl, "复制失败");
  }
}

function failed(e: unknown, url: string, phase: string): Reply {
  const message = e instanceof Error ? e.message : String(e);
  flash("!", "#c62828", `StickerBox ${phase}：${message}`);
  console.warn("[StickerBox]", phase, message, url);
  return { ok: false, error: message };
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
