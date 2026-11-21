from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError

from app.config import settings
from app.schemas.dto import FeatureVectorDto, HabitInputDto, MainFactor, RiskLevel

try:
    from google import genai
except ImportError:  # pragma: no cover - optional when running offline
    genai = None  # type: ignore[assignment]


class AiExplanationService:
    """Generates short Ukrainian habit advice via Gemini 2.5 Flash with 2s timeout fallback."""

    def __init__(
        self,
        api_key: str | None = None,
        model_name: str | None = None,
        timeout_seconds: float | None = None,
    ) -> None:
        self.api_key = (api_key if api_key is not None else settings.gemini_api_key).strip()
        self.model_name = model_name or settings.gemini_model
        self.timeout_seconds = (
            timeout_seconds if timeout_seconds is not None else settings.gemini_timeout_seconds
        )
        self.last_used_fallback: bool = False
        self._client = (
            genai.Client(api_key=self.api_key)
            if (genai is not None and self.api_key)
            else None
        )

    @property
    def is_configured(self) -> bool:
        return self._client is not None

    def _call_gemini(self, prompt: str) -> str:
        assert self._client is not None
        response = self._client.models.generate_content(
            model=self.model_name,
            contents=prompt,
        )
        text = (getattr(response, "text", None) or "").strip()
        if not text:
            raise ValueError("Empty response from Gemini API")
        return text

    def generateAdviceText(
        self,
        habit: HabitInputDto,
        features: FeatureVectorDto,
        risk_score: float,
        risk_level: RiskLevel,
        main_factor: MainFactor,
        suggested_time: str,
        suggested_frequency: int,
        ai_consent: bool = True,
    ) -> str:
        """Generates personalized Ukrainian explanation via Gemini API with 2s fallback."""
        fallback_text = self.buildTemplateAdvice(
            habit_title=habit.title,
            risk_score=risk_score,
            risk_level=risk_level,
            main_factor=main_factor,
            current_time=habit.reminderTime,
            suggested_time=suggested_time,
            suggested_frequency=suggested_frequency,
        )

        if not ai_consent or self._client is None:
            self.last_used_fallback = True
            return fallback_text

        prompt = (
            "Ти помічник вебзастосунку HabitFlow. Напиши коротку, доброзичливу й практичну "
            "пораду українською мовою (до 2 речень, без списків і без зайвих вступів) для користувача.\n"
            f"Звичка: {habit.title}\n"
            f"Поточний час нагадування: {habit.reminderTime}\n"
            f"Ймовірність пропуску: {round(risk_score * 100)}% ({risk_level})\n"
            f"Головний фактор ризику: {main_factor}\n"
            f"Середня затримка виконання: {round(features.meanDelayMinutes)} хв\n"
            f"Пропуски за 7 днів: {round(features.missRate7d * 100)}%\n"
            f"Пропуски у вихідні: {round(features.weekendMissRate * 100)}%\n"
            f"Рекомендований час: {suggested_time}, рекомендована частота: {suggested_frequency}."
        )

        executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="gemini",
                                      initializer=lambda: threading.current_thread().__setattr__("daemon", True))
        future = executor.submit(self._call_gemini, prompt)
        try:
            advice = future.result(timeout=self.timeout_seconds)
            self.last_used_fallback = False
            return advice
        except (FuturesTimeoutError, Exception):
            future.cancel()
            self.last_used_fallback = True
            return fallback_text
        finally:
            executor.shutdown(wait=False, cancel_futures=True)

    @staticmethod
    def buildTemplateAdvice(
        habit_title: str,
        risk_score: float,
        risk_level: RiskLevel,
        main_factor: MainFactor,
        current_time: str,
        suggested_time: str,
        suggested_frequency: int,
    ) -> str:
        """Deterministic Ukrainian template fallback when Gemini API is disabled or unavailable."""
        risk_pct = round(risk_score * 100)
        freq_label = f"{suggested_frequency} дн./тиж."

        if risk_level == "low":
            return (
                f"Звичка «{habit_title}» виконується стабільно (ризик пропуску {risk_pct}%). "
                f"Зберігайте поточний час нагадування {current_time} та обраний ритм ({freq_label})."
            )

        if main_factor == "late_checkin":
            return (
                f"Для звички «{habit_title}» зафіксовано систематичні запізнення чекінів "
                f"(ризик пропуску {risk_pct}%). Спробуйте перенести нагадування з {current_time} "
                f"на {suggested_time}, щоб воно краще збігалося з реальним графіком."
            )

        if main_factor == "weekend_drop":
            return (
                f"Для звички «{habit_title}» більшість пропусків припадає на суботу та неділю "
                f"(ризик пропуску {risk_pct}%). Рекомендуємо перейти на графік {freq_label} (Пн–Пт) "
                f"або залишити нагадування на {suggested_time} лише в зручні дні."
            )

        return (
            f"За останні 14 днів регулярність звички «{habit_title}» знизилася "
            f"(ризик пропуску {risk_pct}%). Спробуйте полегшити темп до {freq_label} "
            f"із нагадуванням о {suggested_time}, щоб відновити стабільну серію."
        )
