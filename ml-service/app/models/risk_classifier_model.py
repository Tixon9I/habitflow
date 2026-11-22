from __future__ import annotations

from pathlib import Path
from typing import Any

import joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import f1_score, precision_score
from sklearn.model_selection import train_test_split

from app.config import settings
from app.schemas.dto import FeatureVectorDto, HabitInputDto, MainFactor, RiskLevel


FEATURE_NAMES = [
    "missRate7d",
    "missRate14d",
    "currentStreak",
    "meanDelayMinutes",
    "weekendMissRate",
]


class RiskClassifierModel:
    """RandomForestClassifier wrapper for habit skip-risk prediction (diagram 3.10)."""

    def __init__(self, artifact_path: Path | None = None) -> None:
        self.artifact_path = artifact_path or settings.model_artifact_path
        self.model: RandomForestClassifier | None = None
        self.metrics: dict[str, Any] = {}
        self.loadOrTrainDefaultModel()

    @staticmethod
    def _generate_synthetic_dataset(
        n_samples: int = 2400,
        random_state: int = 42,
    ) -> tuple[np.ndarray, np.ndarray]:
        """Generates calibrated synthetic behavioral dataset aligned with ITMAS-2026 weights."""
        rng = np.random.default_rng(random_state)

        base_miss = rng.beta(1.6, 2.2, size=n_samples)
        miss_rate_14d = np.clip(base_miss + rng.normal(0.0, 0.08, size=n_samples), 0.0, 1.0)
        miss_rate_7d = np.clip(miss_rate_14d + rng.normal(0.0, 0.12, size=n_samples), 0.0, 1.0)

        mean_delay = np.clip(
            rng.gamma(shape=1.8, scale=22.0, size=n_samples) - 5.0,
            -15.0,
            150.0,
        )
        weekend_miss = np.clip(
            miss_rate_14d * 0.65 + rng.beta(1.5, 2.0, size=n_samples) * 0.55,
            0.0,
            1.0,
        )
        current_streak = np.clip(
            np.round((1.0 - miss_rate_7d) * rng.uniform(0.0, 21.0, size=n_samples)),
            0.0,
            30.0,
        )

        regularity_component = 0.60 * miss_rate_7d + 0.40 * miss_rate_14d
        delay_component = np.clip(mean_delay, 0.0, 120.0) / 120.0
        weekend_component = weekend_miss
        streak_component = 1.0 - np.clip(current_streak, 0.0, 21.0) / 21.0

        latent_risk = (
            0.42 * regularity_component
            + 0.31 * delay_component
            + 0.18 * weekend_component
            + 0.09 * streak_component
            + rng.normal(0.0, 0.105, size=n_samples)
        )
        labels = (latent_risk >= 0.44).astype(int)

        features = np.column_stack(
            [
                miss_rate_7d,
                miss_rate_14d,
                current_streak,
                mean_delay,
                weekend_miss,
            ]
        )
        return features, labels

    def loadOrTrainDefaultModel(self) -> RandomForestClassifier:
        """Loads persisted RandomForest model or trains and caches the default model."""
        if self.artifact_path.exists():
            try:
                bundle = joblib.load(self.artifact_path)
                if isinstance(bundle, dict) and "model" in bundle:
                    self.model = bundle["model"]
                    self.metrics = bundle.get("metrics", {})
                    return self.model
            except Exception:
                pass

        X, y = self._generate_synthetic_dataset(n_samples=2400, random_state=42)
        X_train, X_test, y_train, y_test = train_test_split(
            X,
            y,
            test_size=0.2,
            random_state=42,
            stratify=y,
        )

        clf = RandomForestClassifier(
            n_estimators=100,
            max_depth=6,
            random_state=42,
        )
        clf.fit(X_train, y_train)

        y_pred = clf.predict(X_test)
        f1 = round(float(f1_score(y_test, y_pred)), 4)
        precision = round(float(precision_score(y_test, y_pred)), 4)

        importances = clf.feature_importances_
        grouped_weights = {
            "regularity": round(float(importances[0] + importances[1]), 4),
            "meanDelayMinutes": round(float(importances[3]), 4),
            "weekendMissRate": round(float(importances[4]), 4),
            "currentStreak": round(float(importances[2]), 4),
        }

        self.model = clf
        self.metrics = {
            "f1Score": f1,
            "precision": precision,
            "featureImportances": dict(
                zip(FEATURE_NAMES, [round(float(v), 4) for v in importances])
            ),
            "groupedWeights": grouped_weights,
        }

        try:
            self.artifact_path.parent.mkdir(parents=True, exist_ok=True)
            joblib.dump({"model": self.model, "metrics": self.metrics}, self.artifact_path)
        except OSError:
            pass

        return self.model

    def predictRiskScore(self, features: FeatureVectorDto) -> float:
        """Predicts probability of missing the habit (0.0 .. 1.0)."""
        if self.model is None:
            self.loadOrTrainDefaultModel()
        assert self.model is not None

        row = np.array([features.to_model_row()], dtype=float)
        prob = float(self.model.predict_proba(row)[0][1])
        return round(max(0.0, min(1.0, prob)), 4)

    @staticmethod
    def classifyRiskLevel(risk_score: float) -> RiskLevel:
        if risk_score >= 0.65:
            return "high"
        if risk_score >= 0.40:
            return "medium"
        return "low"

    @staticmethod
    def identifyMainFactor(features: FeatureVectorDto) -> MainFactor:
        if features.meanDelayMinutes >= 30.0:
            return "late_checkin"
        if (features.weekendMissRate - features.missRate14d) >= 0.25:
            return "weekend_drop"
        return "low_regularity"

    @staticmethod
    def recommendNewTime(
        reminder_time: str,
        features: FeatureVectorDto,
        main_factor: MainFactor,
    ) -> str:
        hours_str, minutes_str = reminder_time.split(":")
        base_minutes = int(hours_str) * 60 + int(minutes_str)

        shift = 0
        if main_factor == "late_checkin" or features.meanDelayMinutes >= 20.0:
            rounded_delay = int(round(features.meanDelayMinutes / 15.0) * 15)
            shift = max(15, min(180, rounded_delay))
        elif features.meanDelayMinutes <= -20.0:
            rounded_early = int(round(abs(features.meanDelayMinutes) / 15.0) * 15)
            shift = -max(15, min(60, rounded_early))

        adapted_minutes = max(6 * 60, min(23 * 60, base_minutes + shift))
        new_hours, new_mins = divmod(adapted_minutes, 60)
        return f"{new_hours:02d}:{new_mins:02d}"

    @staticmethod
    def recommendNewFrequency(
        habit: HabitInputDto,
        features: FeatureVectorDto,
        main_factor: MainFactor,
    ) -> int:
        if main_factor in ("weekend_drop", "low_regularity"):
            return 5
        return len(habit.targetDays)
