from __future__ import annotations

import random
import time
from datetime import date, timedelta

import pytest

from app.models.risk_classifier_model import RiskClassifierModel
from app.schemas.dto import AnalyzeRequestDto, HabitInputDto, HabitLogInputDto
from app.services.ai_explanation_service import AiExplanationService
from app.services.feature_extractor import FeatureExtractor
from app.services.habit_risk_predictor_service import HabitRiskPredictorService

REF_DATE = date(2026, 11, 19)


def _make_habit(
    habit_id: str = "habit_01",
    title: str = "Ранкова зарядка",
    reminder_time: str = "07:30",
    frequency_type: str = "daily",
    target_days: list[int] | None = None,
) -> HabitInputDto:
    created_at = (REF_DATE - timedelta(days=29)).isoformat() + "T07:00:00Z"
    return HabitInputDto(
        idHabit=habit_id,
        idUser="user_01",
        title=title,
        category="Здоров'я",
        frequencyType=frequency_type,  # type: ignore[arg-type]
        targetDays=target_days or [1, 2, 3, 4, 5, 6, 7],
        reminderTime=reminder_time,
        scheduleHistory=[],
        currentStreak=10,
        bestStreak=14,
        isActive=True,
        createdAt=created_at,
    )


def _make_logs(
    habit_id: str = "habit_01",
    days_back: int = 30,
    skip_dates: set[date] | None = None,
    delay_minutes: float = 5.0,
    planned_time: str = "07:30",
) -> list[HabitLogInputDto]:
    skip = skip_dates or set()
    logs: list[HabitLogInputDto] = []
    for offset in range(days_back):
        target = REF_DATE - timedelta(days=offset)
        if target in skip:
            continue
        logs.append(
            HabitLogInputDto(
                idLog=f"log_{habit_id}_{target.isoformat()}",
                idHabit=habit_id,
                idUser="user_01",
                targetDate=target.isoformat(),
                completedAt=f"{target.isoformat()}T{planned_time}:00Z",
                plannedTime=planned_time,
                delayMinutes=delay_minutes,
            )
        )
    return logs


@pytest.fixture(scope="module")
def predictor() -> HabitRiskPredictorService:
    extractor = FeatureExtractor(window_days=30, cold_start_min_days=14)
    model = RiskClassifierModel()
    explanation = AiExplanationService(api_key="", timeout_seconds=2.0)
    return HabitRiskPredictorService(
        feature_extractor=extractor,
        risk_model=model,
        explanation_service=explanation,
    )


def test_mr1_2_miss_rate_monotonicity(predictor: HabitRiskPredictorService) -> None:
    """MR1.2: Збільшення кількості пропусків за останні 14 днів не має зменшувати riskScore."""
    habit = _make_habit()
    source_logs = _make_logs(delay_minutes=5.0)

    # Drop 6 recent days inside the last 14 days
    dropped_dates = {REF_DATE - timedelta(days=d) for d in (0, 1, 3, 5, 8, 10)}
    followup_logs = _make_logs(skip_dates=dropped_dates, delay_minutes=5.0)

    source_res = predictor.evaluateHabits(
        AnalyzeRequestDto(
            idUser="user_01",
            aiConsent=False,
            referenceDate=REF_DATE,
            habits=[habit],
            habitLogs=source_logs,
        )
    )
    followup_res = predictor.evaluateHabits(
        AnalyzeRequestDto(
            idUser="user_01",
            aiConsent=False,
            referenceDate=REF_DATE,
            habits=[habit],
            habitLogs=followup_logs,
        )
    )

    source_rec = source_res.recommendations[0]
    followup_rec = followup_res.recommendations[0]

    assert followup_rec.riskScore >= source_rec.riskScore
    assert followup_rec.riskScore > source_rec.riskScore


def test_mr2_1_checkin_delay_monotonicity(predictor: HabitRiskPredictorService) -> None:
    """MR2.1: Систематичне збільшення delayMinutes підвищує ризик і зміщує suggestedTime."""
    habit = _make_habit(reminder_time="08:00")
    source_logs = _make_logs(delay_minutes=0.0, planned_time="08:00")
    followup_logs = _make_logs(delay_minutes=75.0, planned_time="08:00")

    source_res = predictor.evaluateHabits(
        AnalyzeRequestDto(
            idUser="user_01",
            aiConsent=False,
            referenceDate=REF_DATE,
            habits=[habit],
            habitLogs=source_logs,
        )
    )
    followup_res = predictor.evaluateHabits(
        AnalyzeRequestDto(
            idUser="user_01",
            aiConsent=False,
            referenceDate=REF_DATE,
            habits=[habit],
            habitLogs=followup_logs,
        )
    )

    source_rec = source_res.recommendations[0]
    followup_rec = followup_res.recommendations[0]

    assert followup_rec.riskScore >= source_rec.riskScore
    assert followup_rec.mainFactor == "late_checkin"
    assert followup_rec.suggestedTime > habit.reminderTime


def test_mr3_2_weekend_drop_sensitivity(predictor: HabitRiskPredictorService) -> None:
    """MR3.2: Пропуски у суботу та неділю підвищують ризик та активують фактор weekend_drop."""
    habit = _make_habit()
    source_logs = _make_logs(delay_minutes=5.0)

    # Remove all Saturday (6) and Sunday (7) check-ins in the 30-day window
    weekend_dates = {
        REF_DATE - timedelta(days=d)
        for d in range(30)
        if (REF_DATE - timedelta(days=d)).isoweekday() in (6, 7)
    }
    followup_logs = _make_logs(skip_dates=weekend_dates, delay_minutes=5.0)

    source_res = predictor.evaluateHabits(
        AnalyzeRequestDto(
            idUser="user_01",
            aiConsent=False,
            referenceDate=REF_DATE,
            habits=[habit],
            habitLogs=source_logs,
        )
    )
    followup_res = predictor.evaluateHabits(
        AnalyzeRequestDto(
            idUser="user_01",
            aiConsent=False,
            referenceDate=REF_DATE,
            habits=[habit],
            habitLogs=followup_logs,
        )
    )

    source_rec = source_res.recommendations[0]
    followup_rec = followup_res.recommendations[0]

    assert followup_rec.riskScore >= source_rec.riskScore
    assert followup_rec.mainFactor == "weekend_drop"
    assert followup_rec.suggestedFrequency == 5  # Spec 4.3: weekend_drop -> 5 days/week (int)


def test_mr4_2_log_permutation_invariance(predictor: HabitRiskPredictorService) -> None:
    """MR4.2: Перестановка порядку записів habit_logs не впливає на ознаки та прогноз."""
    habit = _make_habit()
    skip_dates = {REF_DATE - timedelta(days=d) for d in (2, 6, 11, 18)}
    source_logs = _make_logs(skip_dates=skip_dates, delay_minutes=32.0)

    shuffled_logs = list(source_logs)
    rng = random.Random(42)
    rng.shuffle(shuffled_logs)

    source_features = predictor.feature_extractor.extractFeatures(
        habit=habit, logs=source_logs, reference_date=REF_DATE
    )
    shuffled_features = predictor.feature_extractor.extractFeatures(
        habit=habit, logs=shuffled_logs, reference_date=REF_DATE
    )
    assert source_features == shuffled_features

    source_res = predictor.evaluateHabits(
        AnalyzeRequestDto(
            idUser="user_01",
            aiConsent=False,
            referenceDate=REF_DATE,
            habits=[habit],
            habitLogs=source_logs,
        )
    )
    shuffled_res = predictor.evaluateHabits(
        AnalyzeRequestDto(
            idUser="user_01",
            aiConsent=False,
            referenceDate=REF_DATE,
            habits=[habit],
            habitLogs=shuffled_logs,
        )
    )

    s_rec = source_res.recommendations[0]
    p_rec = shuffled_res.recommendations[0]
    assert s_rec.riskScore == p_rec.riskScore
    assert s_rec.riskLevel == p_rec.riskLevel
    assert s_rec.mainFactor == p_rec.mainFactor
    assert s_rec.suggestedTime == p_rec.suggestedTime
    assert s_rec.suggestedFrequency == p_rec.suggestedFrequency


def test_mr5_2_llm_failure_and_timeout_fallback(
    predictor: HabitRiskPredictorService,
) -> None:
    """MR5.2: Збій або перевищення таймауту Gemini API не змінює ML-прогноз і активує шаблонний fallback."""
    habit = _make_habit()
    skip_dates = {REF_DATE - timedelta(days=d) for d in (1, 4, 9)}
    logs = _make_logs(skip_dates=skip_dates, delay_minutes=45.0)

    baseline_res = predictor.evaluateHabits(
        AnalyzeRequestDto(
            idUser="user_01",
            aiConsent=False,
            referenceDate=REF_DATE,
            habits=[habit],
            habitLogs=logs,
        )
    )

    # Simulate slow Gemini API exceeding timeout (0.2s timeout vs 0.6s sleep)
    slow_ai = AiExplanationService(api_key="", timeout_seconds=0.2)
    slow_ai._client = object()  # type: ignore[assignment]

    def _slow_call(_prompt: str) -> str:
        time.sleep(0.6)
        return "Too late"

    slow_ai._call_gemini = _slow_call  # type: ignore[method-assign]

    timeout_predictor = HabitRiskPredictorService(
        feature_extractor=predictor.feature_extractor,
        risk_model=predictor.risk_model,
        explanation_service=slow_ai,
    )

    started = time.perf_counter()
    timeout_res = timeout_predictor.evaluateHabits(
        AnalyzeRequestDto(
            idUser="user_01",
            aiConsent=True,
            referenceDate=REF_DATE,
            habits=[habit],
            habitLogs=logs,
        )
    )
    elapsed = time.perf_counter() - started

    base_rec = baseline_res.recommendations[0]
    fb_rec = timeout_res.recommendations[0]

    assert timeout_res.usedFallbackAdvice is True
    assert elapsed < 0.5
    assert fb_rec.riskScore == base_rec.riskScore
    assert fb_rec.riskLevel == base_rec.riskLevel
    assert fb_rec.mainFactor == base_rec.mainFactor
    assert fb_rec.suggestedTime == base_rec.suggestedTime
    assert len(fb_rec.explanationText) > 20
