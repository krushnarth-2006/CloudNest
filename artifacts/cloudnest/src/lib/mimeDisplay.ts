export interface FileTypeMetric {
  label: string;
  value: number;
}

export interface FileCompositionItem extends FileTypeMetric {
  colorIndex: number;
}

const MIME_LABELS: Record<string, string> = {
  "application/vnd.google-apps.spreadsheet": "Google Sheets",
  "application/vnd.google-apps.document": "Google Docs",
  "application/vnd.google-apps.presentation": "Google Slides",
  "application/vnd.google.colaboratory": "Google Colab",
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word Document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PowerPoint Presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel Spreadsheet",
  "application/msword": "Word Document",
  "application/vnd.ms-powerpoint": "PowerPoint Presentation",
  "application/vnd.ms-excel": "Excel Spreadsheet",
  "text/plain": "Text File",
  "text/csv": "CSV File",
  "image/jpeg": "JPEG Image",
  "image/jpg": "JPEG Image",
  "image/png": "PNG Image",
  "image/gif": "GIF Image",
  "image/webp": "WebP Image",
  "application/zip": "ZIP Archive",
  "application/x-zip-compressed": "ZIP Archive",
};

const EXTENSION_LABELS: Record<string, string> = {
  csv: "CSV File", doc: "Word Document", docx: "Word Document", gif: "GIF Image",
  jpeg: "JPEG Image", jpg: "JPEG Image", json: "JSON File", md: "Markdown File", pdf: "PDF", png: "PNG Image",
  ppt: "PowerPoint Presentation", pptx: "PowerPoint Presentation", txt: "Text File",
  webp: "WebP Image", xls: "Excel Spreadsheet", xlsx: "Excel Spreadsheet", zip: "ZIP Archive",
};

function readableSubtype(subtype: string): string | null {
  const clean = subtype
    .replace(/^vnd\./i, "")
    .replace(/^x-/, "")
    .replace(/^(?:application|x-)?vnd\./i, "")
    .replace(/[.+_-]+/g, " ")
    .trim();
  if (!clean || /^(octet stream|binary|unknown)$/i.test(clean)) return null;
  return clean.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** Convert provider MIME values into short labels suitable for user-facing UI. */
export function getMimeDisplayName(mimeType?: string | null, fileName?: string | null): string {
  const mime = mimeType?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (MIME_LABELS[mime]) return MIME_LABELS[mime];

  const extension = fileName?.split(".").pop()?.toLowerCase();
  if (extension && extension !== fileName?.toLowerCase()) {
    if (EXTENSION_LABELS[extension]) return EXTENSION_LABELS[extension];
    if (/^[a-z0-9]{1,10}$/.test(extension)) {
      return `${extension.replace(/\b\w/g, (letter) => letter.toUpperCase())} File`;
    }
  }

  const [major, subtype] = mime.split("/");
  if (major === "image" && subtype) {
    return `${subtype.replace(/^x-/, "").toUpperCase()} Image`;
  }
  if (major === "audio" && subtype) {
    return `${subtype.replace(/^x-/, "").toUpperCase()} Audio`;
  }
  if (major === "video" && subtype) {
    return `${subtype.replace(/^x-/, "").toUpperCase()} Video`;
  }
  const readable = readableSubtype(subtype ?? "");
  if (readable) return `${readable} File`;
  return "Unknown File Type";
}

/** Merge MIME aliases into display labels, sort by count, and group the long tail. */
export function buildFileComposition(
  metrics: FileTypeMetric[] = [],
  maxIndividualTypes = 5,
): FileCompositionItem[] {
  const byLabel = new Map<string, number>();
  for (const metric of metrics) {
    const label = metric.label === "Other" ? "Other" : getMimeDisplayName(metric.label);
    byLabel.set(label, (byLabel.get(label) ?? 0) + metric.value);
  }

  const otherValue = byLabel.get("Other") ?? 0;
  const sorted = [...byLabel]
    .filter(([label]) => label !== "Other")
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const visible = sorted.slice(0, maxIndividualTypes);
  const remainder = sorted.slice(maxIndividualTypes);
  const groupedValue = otherValue + remainder.reduce((sum, [, value]) => sum + value, 0);
  if (groupedValue > 0) {
    visible.push(["Other", groupedValue]);
  }
  return visible.map(([label, value], colorIndex) => ({ label, value, colorIndex }));
}
