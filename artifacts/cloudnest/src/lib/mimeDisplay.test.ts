import assert from "node:assert/strict";
import test from "node:test";
import { buildFileComposition, getMimeDisplayName } from "./mimeDisplay.ts";

test("maps common Google, Office, and standard MIME types to friendly names", () => {
  assert.equal(getMimeDisplayName("application/vnd.google-apps.spreadsheet"), "Google Sheets");
  assert.equal(getMimeDisplayName("application/vnd.google-apps.document"), "Google Docs");
  assert.equal(getMimeDisplayName("application/vnd.google.colaboratory"), "Google Colab");
  assert.equal(getMimeDisplayName("application/pdf"), "PDF");
  assert.equal(getMimeDisplayName("application/vnd.openxmlformats-officedocument.wordprocessingml.document"), "Word Document");
  assert.equal(getMimeDisplayName("application/vnd.openxmlformats-officedocument.presentationml.presentation"), "PowerPoint Presentation");
  assert.equal(getMimeDisplayName("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), "Excel Spreadsheet");
  assert.equal(getMimeDisplayName("text/plain"), "Text File");
  assert.equal(getMimeDisplayName("text/csv"), "CSV File");
  assert.equal(getMimeDisplayName("image/jpeg"), "JPEG Image");
  assert.equal(getMimeDisplayName("image/png"), "PNG Image");
  assert.equal(getMimeDisplayName("application/zip"), "ZIP Archive");
});

test("uses a readable extension or MIME subtype for unknown types", () => {
  assert.equal(getMimeDisplayName("application/octet-stream", "notes.md"), "Markdown File");
  assert.equal(getMimeDisplayName("application/x-custom-report"), "Custom Report File");
  assert.equal(getMimeDisplayName("application/octet-stream"), "Unknown File Type");
  assert.notEqual(getMimeDisplayName("application/x-custom-report"), "application/x-custom-report");
});

test("returns no composition items for empty or zero-valued data", () => {
  assert.deepEqual(buildFileComposition(), []);
  assert.deepEqual(buildFileComposition([{ label: "application/pdf", value: 0 }]), []);
});

test("merges equivalent labels and groups the long tail without losing counts", () => {
  const items = buildFileComposition([
    { label: "image/jpeg", value: 4 },
    { label: "image/jpg", value: 3 },
    { label: "application/pdf", value: 5 },
    { label: "text/plain", value: 2 },
    { label: "image/png", value: 1 },
    { label: "application/zip", value: 1 },
    { label: "Other", value: 2 },
  ]);
  assert.deepEqual(items.map(({ label, value }) => [label, value]), [
    ["JPEG Image", 7], ["PDF", 5], ["Text File", 2], ["PNG Image", 1], ["ZIP Archive", 1], ["Other", 2],
  ]);
  assert.equal(items.reduce((sum, item) => sum + item.value, 0), 18);
  assert.equal(items[0].value / 18 * 100, 7 / 18 * 100);
});
