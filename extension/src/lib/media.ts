/** 与桥、扩展双侧约定的体积上限。 */
export const MAX_BYTES = 10 * 1024 * 1024;

/**
 * B站 CDN 的图片 URL 常带 `@` 处理后缀（`xxx.gif@320w_200h.webp`、`@!webp`）。
 * 从第一个 `@` 截断，才能拿回原图/原动图。
 */
export function normalizeUrl(raw: string): string {
  if (!/^https?:/i.test(raw)) return raw;
  const at = raw.indexOf("@");
  return at > 0 ? raw.slice(0, at) : raw;
}

/** 按文件头认格式；认不出返回 null。 */
export function sniffExt(bytes: Uint8Array): string | null {
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.subarray(start, end));

  if (bytes.length >= 6 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) {
    return "gif";
  }
  if (bytes.length >= 8 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    return "webp";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    ascii(1, 4) === "PNG" &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a
  ) {
    return "png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpg";
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return "bmp";
  }
  return null;
}

/** 从 URL 路径猜扩展名，B站原始文件名常是 `xxx.gif`。 */
export function extFromUrl(url: string): string | null {
  try {
    const path = new URL(url).pathname;
    const m = /\.(gif|webp|png|jpe?g|bmp)$/i.exec(path);
    if (!m?.[1]) return null;
    const ext = m[1].toLowerCase();
    return ext === "jpeg" ? "jpg" : ext;
  } catch {
    return null;
  }
}

/** 从 Content-Type 兜底（CDN 偶尔不带后缀）。 */
export function extFromContentType(contentType: string | null): string | null {
  if (!contentType) return null;
  const type = contentType.split(";")[0]?.trim().toLowerCase();
  switch (type) {
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/bmp":
      return "bmp";
    default:
      return null;
  }
}

export function fileNameFromUrl(url: string, ext: string): string {
  try {
    const path = new URL(url).pathname;
    const base = decodeURIComponent(path.split("/").pop() ?? "");
    if (base && /\.[a-z0-9]{2,5}$/i.test(base)) return base;
  } catch {
    // URL 不合法就走下面的兜底名
  }
  return `bilibili-${Date.now()}.${ext}`;
}

/** SW 里没有 btoa(ArrayBuffer)：分块转二进制字符串，避免大图爆栈。 */
export function toBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
