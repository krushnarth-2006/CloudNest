const GENERIC_MIME_TYPES = new Set(["", "application/octet-stream", "binary/octet-stream"]);

const OFFICE_MIME_BY_ZIP_ENTRY: Array<[string, string]> = [
  ["word/document.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ["xl/workbook.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ["ppt/presentation.xml", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
];

function hasPrefix(buffer: Buffer, signature: number[], offset = 0): boolean {
  return signature.every((byte, index) => buffer[offset + index] === byte);
}

function detectText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  if (sample.includes(0)) return false;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(sample);
    return !/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/.test(text);
  } catch {
    return false;
  }
}

/** Prefer signatures from the file bytes; provider and browser MIME values are fallbacks. */
export function detectMimeType(buffer: Buffer, declaredMimeType?: string | null): string {
  if (buffer.length >= 5 && buffer.subarray(0, 1024).includes(Buffer.from("%PDF-"))) return "application/pdf";
  if (hasPrefix(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (hasPrefix(buffer, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (buffer.subarray(0, 6).toString("ascii").match(/^GIF8[79]a$/)) return "image/gif";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp") {
    const brand = buffer.toString("ascii", 8, 12);
    if (["avif", "avis"].includes(brand)) return "image/avif";
  }

  if (hasPrefix(buffer, [0x50, 0x4b, 0x03, 0x04]) || hasPrefix(buffer, [0x50, 0x4b, 0x05, 0x06])) {
    for (const [entry, mimeType] of OFFICE_MIME_BY_ZIP_ENTRY) {
      if (buffer.includes(Buffer.from(entry))) return mimeType;
    }
    return "application/zip";
  }

  if (detectText(buffer)) return "text/plain";

  const declared = declaredMimeType?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (GENERIC_MIME_TYPES.has(declared)) return "application/octet-stream";
  // Do not trust metadata that claims PDF or OOXML when the corresponding
  // signatures above do not match the downloaded bytes.
  if (declared === "application/pdf" || declared.includes("wordprocessingml.document") || declared.includes("spreadsheetml.sheet")) {
    return "application/octet-stream";
  }
  return declared;
}

export function isPreviewableMimeType(mimeType: string): boolean {
  return mimeType === "application/pdf"
    || mimeType === "text/plain"
    || mimeType === "text/csv"
    || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    || mimeType.startsWith("image/")
    || mimeType.startsWith("video/");
}

export function contentDisposition(disposition: "inline" | "attachment", filename: string): string {
  const safeName = filename.replace(/[\r\n"\\]/g, "_").trim() || "file";
  const asciiName = safeName.replace(/[^\x20-\x7E]/g, "_");
  return `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}

export function fileResponseHeaders(disposition: "inline" | "attachment", mimeType: string, filename: string): Record<string, string> {
  return {
    "Content-Type": mimeType.startsWith("text/") ? `${mimeType}; charset=utf-8` : mimeType,
    "Content-Disposition": contentDisposition(disposition, filename),
    "X-Content-Type-Options": "nosniff",
  };
}
