export interface CategorizationResult {
  category: string;
  confidence: number;
  reason: string;
}

const CATEGORIES = ["Career", "Education", "Finance", "Identity", "Personal", "Work", "Other"];

/** Same keyword heuristic as the AI service's own fallback, used only if the AI service
 * itself is unreachable (e.g. not started locally) so uploads never hard-fail. */
function localFallback(filename: string): CategorizationResult {
  const name = filename.toLowerCase();
  let category = "Other";
  if (/(resume|cv|portfolio|cover)/.test(name)) category = "Career";
  else if (/(budget|invoice|tax|bank)/.test(name)) category = "Finance";
  else if (/(assignment|research|course|lecture|project)/.test(name)) category = "Education";
  else if (/(work|meeting|report|client)/.test(name)) category = "Work";
  return { category, confidence: category !== "Other" ? 0.6 : 0.3, reason: "AI service unreachable; category inferred locally from the file name." };
}

export async function categorizeFile(params: { filename: string; mimeType: string; text?: string }): Promise<CategorizationResult> {
  const baseUrl = process.env.AI_SERVICE_URL;
  if (!baseUrl) return localFallback(params.filename);

  try {
    const response = await fetch(`${baseUrl}/categorize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: params.filename, mime_type: params.mimeType, text: params.text ?? "" }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return localFallback(params.filename);
    const json = await response.json() as CategorizationResult;
    if (!CATEGORIES.includes(json.category)) return localFallback(params.filename);
    return json;
  } catch {
    return localFallback(params.filename);
  }
}
