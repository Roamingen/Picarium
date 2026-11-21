// 与 src-tauri/src/bridge.rs 的 TOKEN 必须一致；改两边一起改。
export const BRIDGE_URL = "http://127.0.0.1:17800";
export const TOKEN = "picarium-local-7f3c9a2e";

export interface ImportPayload {
  ext: string;
  name: string;
  source: string;
  source_ref: string;
  data: string;
  /** 复制流程用：入库但别让桌面端弹「已存入」提示。 */
  quiet?: boolean;
}

export interface ImportResult {
  ok: boolean;
  sha?: string;
  added?: boolean;
  error?: string;
}

/** 探测本机 Picarium 是否在跑；没开返回 null。 */
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
        "X-Picarium-Token": TOKEN,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, error: "连不上 Picarium，先启动桌面端" };
  }

  const body = (await res.json().catch(() => null)) as ImportResult | null;
  if (!res.ok) {
    return { ok: false, error: body?.error ?? `HTTP ${res.status}` };
  }
  return body ?? { ok: false, error: "桥返回了空响应" };
}

/** 让桌面端把库里的原文件放进剪贴板；粘贴到聊天窗口是文件而不是位图。 */
export async function copyAsset(sha: string): Promise<{ ok: boolean; error?: string }> {
  let res: Response;
  try {
    res = await fetch(`${BRIDGE_URL}/copy`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Picarium-Token": TOKEN,
      },
      body: JSON.stringify({ sha }),
    });
  } catch {
    return { ok: false, error: "连不上 Picarium，先启动桌面端" };
  }

  const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (res.status === 404 && body?.error === "not found") {
    return { ok: false, error: "桌面端版本太旧，升级到 0.14.0 后才能复制为文件" };
  }
  if (!res.ok || !body?.ok) {
    return { ok: false, error: body?.error ?? `HTTP ${res.status}` };
  }
  return { ok: true };
}

/** 「仅复制」：字节交给桌面端写临时文件再进剪贴板，不落库。 */
export async function copyRaw(payload: {
  ext: string;
  name: string;
  data: string;
}): Promise<{ ok: boolean; error?: string }> {
  let res: Response;
  try {
    res = await fetch(`${BRIDGE_URL}/copy-raw`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Picarium-Token": TOKEN,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, error: "连不上 Picarium，先启动桌面端" };
  }

  const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (res.status === 404 && body?.error === "not found") {
    return { ok: false, error: "桌面端版本太旧，升级到 0.14.0 后才能仅复制" };
  }
  if (!res.ok || !body?.ok) {
    return { ok: false, error: body?.error ?? `HTTP ${res.status}` };
  }
  return { ok: true };
}
