import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_health_unconfigured(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "unavailable"


def test_categorize_falls_back_to_filename_keywords(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    response = client.post("/categorize", json={"filename": "Krushnarth_Resume.pdf", "mime_type": "application/pdf"})
    assert response.status_code == 200
    body = response.json()
    assert body["category"] == "Career"
    assert 0 <= body["confidence"] <= 1


def test_categorize_defaults_to_other_for_unrecognized_filename(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    response = client.post("/categorize", json={"filename": "zzz123.bin"})
    assert response.status_code == 200
    assert response.json()["category"] == "Other"
