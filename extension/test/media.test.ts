import assert from "node:assert/strict";
import test from "node:test";
import {
  extFromContentType,
  extFromUrl,
  fileNameFromUrl,
  normalizeUrl,
  sniffExt,
  toBase64,
} from "../src/lib/media";

const bytes = (...parts: Array<string | number[]>): Uint8Array => {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === "string") out.push(...Buffer.from(part, "latin1"));
    else out.push(...part);
  }
  return new Uint8Array(out);
};

test("normalizeUrl 剥掉 B站 CDN 的 @ 后缀", () => {
  assert.equal(
    normalizeUrl("https://i0.hdslb.com/bfs/emote/x.gif@320w_200h.webp"),
    "https://i0.hdslb.com/bfs/emote/x.gif",
  );
  assert.equal(
    normalizeUrl("https://i0.hdslb.com/bfs/emote/x.webp@!webp"),
    "https://i0.hdslb.com/bfs/emote/x.webp",
  );
  const plain = "https://i0.hdslb.com/bfs/emote/x.png";
  assert.equal(normalizeUrl(plain), plain);
});

test("sniffExt 按文件头认格式", () => {
  assert.equal(sniffExt(bytes("GIF89a", [0, 0])), "gif");
  assert.equal(sniffExt(bytes("GIF87a", [0, 0])), "gif");
  assert.equal(sniffExt(bytes("RIFF", [1, 2, 3, 4], "WEBP")), "webp");
  assert.equal(sniffExt(bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a])), "png");
  assert.equal(sniffExt(bytes([0xff, 0xd8, 0xff, 0xe0])), "jpg");
  assert.equal(sniffExt(bytes("BM", [0, 0])), "bmp");
  assert.equal(sniffExt(bytes("hello world")), null);
});

test("extFromUrl / extFromContentType 兜底", () => {
  assert.equal(extFromUrl("https://i0.hdslb.com/bfs/x.GIF"), "gif");
  assert.equal(extFromUrl("https://i0.hdslb.com/bfs/x.jpeg"), "jpg");
  assert.equal(extFromUrl("https://i0.hdslb.com/bfs/x"), null);
  assert.equal(extFromContentType("image/webp; charset=binary"), "webp");
  assert.equal(extFromContentType("image/jpeg"), "jpg");
  assert.equal(extFromContentType("text/html"), null);
});

test("fileNameFromUrl 用路径末段，猜不出就给兜底名", () => {
  assert.equal(
    fileNameFromUrl("https://i0.hdslb.com/bfs/emote/%E7%8C%AB.gif", "gif"),
    "猫.gif",
  );
  const fallback = fileNameFromUrl("https://i0.hdslb.com/bfs/emote/abc", "gif");
  assert.match(fallback, /^bilibili-\d+\.gif$/);
});

test("toBase64 与 Node 的编码一致", () => {
  const data = new Uint8Array(70_000);
  for (let i = 0; i < data.length; i++) data[i] = i % 251;
  assert.equal(toBase64(data), Buffer.from(data).toString("base64"));
});
