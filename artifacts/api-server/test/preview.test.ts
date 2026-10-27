import assert from "node:assert/strict";
import test from "node:test";
import { googleDriveProvider } from "../src/providers/googleDrive";
import { oneDriveProvider } from "../src/providers/oneDrive";
import { detectMimeType, fileResponseHeaders, isPreviewableMimeType } from "../src/services/mimeDetection";
import type { CloudProvider } from "../src/providers/types";

const docxBytes = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]),
  Buffer.from("[Content_Types].xml word/document.xml PK\u0005\u0006"),
]);

const samples = [
  { name: "report.pdf", mimeType: "application/pdf", bytes: Buffer.from("%PDF-1.7\npreview"), expected: "application/pdf" },
  // Simulate stale OneDrive/Drive metadata that calls a DOCX a PDF; byte detection must win.
  { name: "assignment.docx", mimeType: "application/pdf", bytes: docxBytes, expected: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  { name: "photo.png", mimeType: "image/png", bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]), expected: "image/png" },
  { name: "notes.txt", mimeType: "text/plain", bytes: Buffer.from("CloudNest preview text\n", "utf8"), expected: "text/plain" },
];

async function withMockFetch<T>(fetchMock: typeof fetch, action: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    return await action();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

for (const { provider, providerId } of [
  { provider: googleDriveProvider, providerId: "google-drive" },
  { provider: oneDriveProvider, providerId: "onedrive" },
]) {
  test(`${providerId}: Preview and Download preserve original bytes and use correct MIME/headers`, async (t) => {
    for (const sample of samples) {
      await t.test(sample.name, async () => {
        const originalId = "file-123";
        let call = 0;
        await withMockFetch(async (input) => {
          call++;
          const url = String(input);
          if (call === 1) {
            return providerId === "google-drive"
              ? jsonResponse({ id: originalId, name: sample.name, mimeType: sample.mimeType })
              : jsonResponse({ id: originalId, name: sample.name, file: { mimeType: sample.mimeType } });
          }
          if (providerId === "google-drive") assert.match(url, /alt=media/);
          else assert.match(url, /\/content$/);
          return new Response(sample.bytes, { status: 200, headers: { "content-type": sample.mimeType } });
        }, async () => {
          const downloaded = await (provider as CloudProvider).downloadFile({ accessToken: "test-token" }, originalId);
          assert.deepEqual(downloaded.buffer, sample.bytes);
          const actualMimeType = detectMimeType(downloaded.buffer, downloaded.mimeType);
          assert.equal(actualMimeType, sample.expected);
          assert.equal(isPreviewableMimeType(actualMimeType), true);

          const previewHeaders = fileResponseHeaders("inline", actualMimeType, downloaded.name ?? sample.name);
          assert.equal(previewHeaders["Content-Type"], sample.expected.startsWith("text/") ? `${sample.expected}; charset=utf-8` : sample.expected);
          assert.match(previewHeaders["Content-Disposition"], /^inline;/);

          const downloadHeaders = fileResponseHeaders("attachment", actualMimeType, downloaded.name ?? sample.name);
          assert.match(downloadHeaders["Content-Disposition"], /^attachment;/);
          assert.deepEqual(downloaded.buffer, sample.bytes, "Download must retain the provider's original bytes");
        });
      });
    }
  });
}

test("Google Drive native Docs files export to a valid DOCX preview payload", async () => {
  const urls: string[] = [];
  const downloaded = await withMockFetch(async (input) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("fields=name,mimeType")) return jsonResponse({ name: "Assignment", mimeType: "application/vnd.google-apps.document" });
    return new Response(docxBytes, { status: 200 });
  }, () => googleDriveProvider.downloadFile({ accessToken: "test-token" }, "google-native-doc"));

  assert.match(urls[1], /\/export\?mimeType=application%2Fvnd\.openxmlformats-officedocument\.wordprocessingml\.document/);
  assert.equal(downloaded.mimeType, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(downloaded.name, "Assignment.docx");
  assert.equal(detectMimeType(downloaded.buffer, downloaded.mimeType), downloaded.mimeType);
});

test("unsupported binary content is not marked previewable or forced inline", () => {
  const mimeType = detectMimeType(Buffer.from([0x00, 0x01, 0x02]), "application/octet-stream");
  assert.equal(mimeType, "application/octet-stream");
  assert.equal(isPreviewableMimeType(mimeType), false);
  assert.match(fileResponseHeaders("attachment", mimeType, "archive.bin")["Content-Disposition"], /^attachment;/);
});
