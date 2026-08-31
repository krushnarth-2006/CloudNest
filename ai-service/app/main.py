import os
import json
import urllib.request
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="CloudNest AI service")

class CategorizeRequest(BaseModel):
    filename: str
    mime_type: str = "application/octet-stream"
    text: str = ""

@app.get("/health")
def health():
    return {"status": "available" if os.getenv("GEMINI_API_KEY") else "unavailable", "message": "AI service not configured." if not os.getenv("GEMINI_API_KEY") else "AI service ready"}

@app.post("/categorize")
def categorize(payload: CategorizeRequest):
    api_key = os.getenv("GEMINI_API_KEY")
    if api_key:
        # Extracted document text (when the caller could pull any - see the backend's
        # services/textExtraction.ts) is far more reliable than the filename alone,
        # so it takes priority in the prompt whenever present.
        excerpt = payload.text.strip()[:4000]
        content_section = (
            "Document text excerpt:\n" + excerpt
            if excerpt
            else "No extractable text was available for this file; classify from the filename and MIME type alone."
        )
        prompt = (
            "Classify this document into exactly one category: Career, Education, Finance, "
            "Identity, Personal, Work, or Other. Return JSON only with category, confidence "
            "between 0 and 1, and a short reason (mention what in the content led to the category "
            "when you had text to read). Filename: " + payload.filename +
            ". MIME type: " + payload.mime_type + ".\n" + content_section
        )
        request = urllib.request.Request(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=" + api_key,
            data=json.dumps({"contents": [{"parts": [{"text": prompt}]}]}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=12) as response:
                raw = json.loads(response.read())
                text = raw["candidates"][0]["content"]["parts"][0]["text"].replace("```json", "").replace("```", "").strip()
                parsed = json.loads(text)
                allowed = {"Career", "Education", "Finance", "Identity", "Personal", "Work", "Other"}
                if parsed.get("category") in allowed and 0 <= float(parsed.get("confidence", 0)) <= 1:
                    return {"category": parsed["category"], "confidence": float(parsed["confidence"]), "reason": str(parsed.get("reason", "Gemini classification"))}
        except (OSError, KeyError, ValueError, TypeError):
            pass
    name = payload.filename.lower()
    category = "Other"
    if any(word in name for word in ("resume", "cv", "portfolio", "cover")):
        category = "Career"
    elif any(word in name for word in ("budget", "invoice", "tax", "bank")):
        category = "Finance"
    elif any(word in name for word in ("assignment", "research", "course", "lecture", "project")):
        category = "Education"
    elif any(word in name for word in ("work", "meeting", "report", "client")):
        category = "Work"
    return {"category": category, "confidence": 0.72 if category != "Other" else 0.35, "reason": "Category inferred from the file name and metadata."}