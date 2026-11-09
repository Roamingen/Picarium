// 与 src-tauri/src/bridge.rs 的 TOKEN 必须一致；改两边一起改。
export const BRIDGE_URL = "http://127.0.0.1:17800";
export const TOKEN = "stickerbox-local-7f3c9a2e";

export interface ImportPayload {
  ext: string;
  name: string;
  source: string;
  source_ref: string;
  data: string;
}

export interface ImportResult {
  ok: boolean;
  sha?: string;
  added?: boolean;
  error?: string;
}

/** 探测本机 StickerBox 是否在跑；没开返回 null。 */
export async function ping(): Promise<{ ok: boolean; version?: string } | null> {
  try {
    const res = await fetch(`${BRIDGE_URL}/ping`, { cache: "no-store" });
    return (await res.json()) as { ok: boolean; version?: string };
  } catch {
    return null;
  }
}

/** 把一张图的字节送进库；失败时返回带 error 的对象，不抛异常。 */
export async function importImage(payload: ImportPayload): Promise<ImportResult> {
  let res: Response;
  try {
    res = await fetch(`${BRIDGE_URL}/import`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-StickerBox-Token": TOKEN,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, error: "连不上 StickerBox，先启动桌面端" };
  }

  const body = (await res.json().catch(() => null)) as ImportResult | null;
  if (!res.ok) {
    return { ok: false, error: body?.error ?? `HTTP ${res.status}` };
  }
  return body ?? { ok: false, error: "桥返回了空响应" };
}
