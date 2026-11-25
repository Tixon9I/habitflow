from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone

from app.config import settings
from app.models.risk_classifier_model import RiskClassifierModel
from app.schemas.dto import (
    AnalyzeRequestDto,
    AnalyzeResponseDto,
    RecommendationDto,
)
from app.services.ai_explanation_service import AiExplanationService
from app.services.feature_extractor import FeatureExtractor


class HabitRiskPredictorService:
    """Orchestrates feature extraction, ML scoring, and advice generation (diagram 3.10)."""

    def __init__(
        self,
        feature_extractor: FeatureExtractor | None = None,
        risk_model: RiskClassifierModel | None = None,
        explanation_service: AiExplanationService | None = None,
    ) -> None:
        self.feature_extractor = feature_extractor or FeatureExtractor(
            window_days=settings.analysis_window_days,
            cold_start_min_days=settings.cold_start_min_days,
        )
        self.risk_model = risk_model or RiskClassifierModel()
        self.explanation_service = explanation_service or AiExplanationService()

    def evaluateHabits(self, request: AnalyzeRequestDto) -> AnalyzeResponseDto:
        """Evaluates active user habits and returns adaptive schedule recommendations."""
        started_at = time.perf_counter()

        recommendations: list[RecommendationDto] = []
        cold_start_habit_ids: list[str] = []
        used_fallback_any = False

        now_utc = datetime.now(timezone.utc)

        scored_items: list[tuple] = []

        for habit in request.habits:
            if not habit.isActive:
                continue

            if not self.feature_extractor.hasSufficientHistory(
                habit=habit,
                logs=request.habitLogs,
                reference_date=request.referenceDate,
            ):
                cold_start_habit_ids.append(habit.idHabit)
                continue

            habit_logs = [
                log for log in request.habitLogs if log.idHabit == habit.idHabit
            ]
            features = self.feature_extractor.extractFeatures(
                habit=habit,
                logs=habit_logs,
                reference_date=request.referenceDate,
            )
            risk_score = self.risk_model.predictRiskScore(features)
            risk_level = self.risk_model.classifyRiskLevel(risk_score)
            main_factor = self.risk_model.identifyMainFactor(features)
            suggested_time = self.risk_model.recommendNewTime(
                reminder_time=habit.reminderTime,
                features=features,
                main_factor=main_factor,
                logs=habit_logs,
            )
            suggested_frequency = self.risk_model.recommendNewFrequency(
                habit=habit,
                features=features,
                main_factor=main_factor,
            )
            scored_items.append(
                (
                    habit,
                    features,
                    risk_score,
                    risk_level,
                    main_factor,
                    suggested_time,
                    suggested_frequency,
                )
            )

        scored_items.sort(key=lambda item: item[2], reverse=True)
        llm_calls_made = 0

        for (
            habit,
            features,
            risk_score,
            risk_level,
            main_factor,
            suggested_time,
            suggested_frequency,
        ) in scored_items:
            needs_personalized_advice = (
                llm_calls_made < request.notificationLimit
                and (
                    risk_score >= 0.40
                    or suggested_time != habit.reminderTime
                    or features.missRate7d >= 0.25
                )
            )

            if needs_personalized_advice:
                llm_calls_made += 1
                explanation_text, used_fb = self.explanation_service.generateAdviceWithMeta(
                    habit=habit,
                    features=features,
                    risk_score=risk_score,
                    risk_level=risk_level,
                    main_factor=main_factor,
                    suggested_time=suggested_time,
                    suggested_frequency=suggested_frequency,
                    ai_consent=request.aiConsent,
                )
                if used_fb:
                    used_fallback_any = True
            else:
                explanation_text = self.explanation_service.buildTemplateAdvice(
                    habit_title=habit.title,
                    risk_score=risk_score,
                    risk_level=risk_level,
                    main_factor=main_factor,
                    current_time=habit.reminderTime,
                    suggested_time=suggested_time,
                    suggested_frequency=suggested_frequency,
                )
                if not request.aiConsent or not self.explanation_service.is_configured:
                    used_fallback_any = True

            recommendations.append(
                RecommendationDto(
                    idRecommendation=f"rec_{uuid.uuid4().hex[:12]}",
                    idHabit=habit.idHabit,
                    idUser=request.idUser,
                    riskScore=risk_score,
                    riskLevel=risk_level,
                    mainFactor=main_factor,
                    suggestedTime=suggested_time,
                    suggestedFrequency=suggested_frequency,
                    explanationText=explanation_text,
                    status="pending",
                    generatedAt=now_utc,
                )
            )

        elapsed_ms = round((time.perf_counter() - started_at) * 1000.0, 2)

        return AnalyzeResponseDto(
            recommendations=recommendations,
            coldStartHabitIds=cold_start_habit_ids,
            inferenceTimeMs=elapsed_ms,
            usedFallbackAdvice=used_fallback_any,
        )
