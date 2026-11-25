from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


FrequencyType = Literal["daily", "custom"]
RiskLevel = Literal["low", "medium", "high"]
MainFactor = Literal["late_checkin", "weekend_drop", "low_regularity"]
RecommendationStatus = Literal["pending", "accepted", "dismissed"]


class HabitInputDto(BaseModel):
    """Exact Firestore `habits` document contract."""

    model_config = ConfigDict(extra="ignore")

    idHabit: str = Field(..., min_length=1)
    idUser: str = Field(..., min_length=1)
    title: str = Field(..., min_length=1)
    category: str = Field(default="Інше")
    frequencyType: FrequencyType = Field(default="daily")
    targetDays: list[int] = Field(default_factory=lambda: [1, 2, 3, 4, 5, 6, 7])
    reminderTime: str = Field(..., pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    scheduleHistory: list[dict[str, Any]] = Field(default_factory=list)
    currentStreak: int = Field(default=0, ge=0)
    bestStreak: int = Field(default=0, ge=0)
    isActive: bool = Field(default=True)
    createdAt: datetime | str | None = None

    @field_validator("targetDays")
    @classmethod
    def validate_target_days(cls, value: list[int]) -> list[int]:
        valid = sorted({d for d in value if 1 <= d <= 7})
        return valid or [1, 2, 3, 4, 5, 6, 7]


class HabitLogInputDto(BaseModel):
    """Exact Firestore `habit_logs` document contract."""

    model_config = ConfigDict(extra="ignore")

    idLog: str = Field(..., min_length=1)
    idHabit: str = Field(..., min_length=1)
    idUser: str = Field(..., min_length=1)
    targetDate: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    completedAt: datetime | str | None = None
    plannedTime: str = Field(..., pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    delayMinutes: float = Field(default=0.0)


class FeatureVectorDto(BaseModel):
    habitId: str = ""
    missRate7d: float = Field(..., ge=0.0, le=1.0)
    missRate14d: float = Field(..., ge=0.0, le=1.0)
    currentStreak: int = Field(..., ge=0)
    meanDelayMinutes: float
    weekendMissRate: float = Field(..., ge=0.0, le=1.0)
    historyDays: int = Field(default=0, ge=0)

    def to_model_row(self) -> list[float]:
        return [
            self.missRate7d,
            self.missRate14d,
            float(self.currentStreak),
            self.meanDelayMinutes,
            self.weekendMissRate,
        ]


class RecommendationDto(BaseModel):
    """Exact Firestore `recommendations` document contract."""

    idRecommendation: str
    idHabit: str
    idUser: str
    riskScore: float = Field(..., ge=0.0, le=1.0)
    riskLevel: RiskLevel
    mainFactor: MainFactor
    suggestedTime: str = Field(..., pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    suggestedFrequency: int
    explanationText: str
    status: RecommendationStatus = "pending"
    generatedAt: datetime


class AnalyzeRequestDto(BaseModel):
    """Payload sent from Angular MlAnalysisService to POST /api/analyze."""

    idUser: str = Field(..., min_length=1)
    aiConsent: bool = Field(default=True)
    notificationLimit: int = Field(default=3, ge=1, le=20)
    referenceDate: date | None = None
    habits: list[HabitInputDto] = Field(default_factory=list)
    habitLogs: list[HabitLogInputDto] = Field(default_factory=list)


class AnalyzeResponseDto(BaseModel):
    """Response returned by POST /api/analyze."""

    recommendations: list[RecommendationDto]
    coldStartHabitIds: list[str] = Field(default_factory=list)
    inferenceTimeMs: float = Field(..., ge=0.0)
    usedFallbackAdvice: bool = False


class HealthResponseDto(BaseModel):
    """Response returned by GET /health."""

    status: Literal["ok"] = "ok"
    modelLoaded: bool
    geminiConfigured: bool
    modelMetrics: dict[str, Any] = Field(default_factory=dict)
