import pdfParse from "pdf-parse";

const MAX_CHARS = 5000;

const TEXT_MIME_PREFIXES = ["text/"];
const TEXT_MIME_EXACT = new Set(["application/json", "application/xml", "application/csv"]);

/**
 * Pulls readable text out of a file when practical: PDFs get parsed with pdf-parse,
 * plain-text-ish MIME types are decoded directly. Anything else (images, office
 * binaries we don't have a parser for, etc.) returns "" and the caller falls back
 * to filename-based classification - this is a best-effort layer, not a document
 * pipeline, per the "don't overcomplicate this" instruction in the spec.
 */
export async function extractText(buffer: Buffer, mimeType: string): Promise<string> {
  try {
    if (mimeType === "application/pdf") {
      const result = await pdfParse(buffer);
      return result.text.slice(0, MAX_CHARS);
    }
    if (TEXT_MIME_PREFIXES.some((p) => mimeType.startsWith(p)) || TEXT_MIME_EXACT.has(mimeType)) {
      return buffer.toString("utf8").slice(0, MAX_CHARS);
    }
  } catch {
    // Corrupt/encrypted/unsupported PDF, bad encoding, etc. - fall back silently.
  }
  return "";
}
