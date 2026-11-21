from __future__ import annotations

from fastapi import APIRouter

from app.schemas.dto import (
    AnalyzeRequestDto,
    AnalyzeResponseDto,
    HealthResponseDto,
)
from app.services.habit_risk_predictor_service import HabitRiskPredictorService


class AnalyzeController:
    """REST controller exposing POST /api/analyze and GET /health (diagram 3.10)."""

    def __init__(self, predictor_service: HabitRiskPredictorService | None = None) -> None:
        self.predictor_service = predictor_service or HabitRiskPredictorService()
        self.router = APIRouter()
        self._register_routes()

    def _register_routes(self) -> None:
        self.router.add_api_route(
            "/health",
            self.health,
            methods=["GET"],
            response_model=HealthResponseDto,
            tags=["Health"],
            summary="Перевірка стану ML-сервісу та метрик моделі",
        )
        self.router.add_api_route(
            "/api/analyze",
            self.analyze,
            methods=["POST"],
            response_model=AnalyzeResponseDto,
            tags=["ML Analysis"],
            summary="Прогнозування ризику пропуску звичок та генерація рекомендацій",
        )

    def health(self) -> HealthResponseDto:
        return HealthResponseDto(
            status="ok",
            modelLoaded=self.predictor_service.risk_model.model is not None,
            geminiConfigured=self.predictor_service.explanation_service.is_configured,
            modelMetrics=self.predictor_service.risk_model.metrics,
        )

    def analyze(self, payload: AnalyzeRequestDto) -> AnalyzeResponseDto:
        return self.predictor_service.evaluateHabits(payload)
