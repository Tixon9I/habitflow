from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def _parse_origins(raw: str) -> list[str]:
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


@dataclass(frozen=True)
class Settings:
    gemini_api_key: str = field(
        default_factory=lambda: os.getenv("GEMINI_API_KEY", "").strip()
    )
    gemini_model: str = field(
        default_factory=lambda: os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip()
    )
    gemini_timeout_seconds: float = field(
        default_factory=lambda: float(os.getenv("GEMINI_TIMEOUT_SECONDS", "2.0"))
    )
    cors_origins: list[str] = field(
        default_factory=lambda: _parse_origins(
            os.getenv(
                "CORS_ORIGINS",
                "http://localhost:4200,http://127.0.0.1:4200",
            )
        )
    )
    model_artifact_path: Path = field(
        default_factory=lambda: BASE_DIR
        / os.getenv("MODEL_ARTIFACT_PATH", "app/models/habit_risk_rf.joblib")
    )
    cold_start_min_days: int = 14
    analysis_window_days: int = 30


settings = Settings()
