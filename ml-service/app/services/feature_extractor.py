from __future__ import annotations

from datetime import date, datetime, timedelta

import pandas as pd

from app.schemas.dto import FeatureVectorDto, HabitInputDto, HabitLogInputDto


class FeatureExtractor:
    """Extracts 5 behavioral features over a 30-day rolling window (diagram 3.10)."""

    def __init__(self, window_days: int = 30, cold_start_min_days: int = 14) -> None:
        self.window_days = window_days
        self.cold_start_min_days = cold_start_min_days

    @staticmethod
    def _scheduled_weekdays(habit: HabitInputDto) -> set[int]:
        if habit.frequencyType == "daily":
            return {1, 2, 3, 4, 5, 6, 7}
        return set(habit.targetDays) if habit.targetDays else {1, 2, 3, 4, 5, 6, 7}

    @staticmethod
    def _parse_created_date(created_at: datetime | str | None) -> date | None:
        if created_at is None:
            return None
        if isinstance(created_at, datetime):
            return created_at.date()
        try:
            normalized = created_at.replace("Z", "+00:00")
            return datetime.fromisoformat(normalized).date()
        except ValueError:
            try:
                return date.fromisoformat(created_at[:10])
            except ValueError:
                return None

    def hasSufficientHistory(
        self,
        habit: HabitInputDto,
        logs: list[HabitLogInputDto],
        reference_date: date | None = None,
    ) -> bool:
        """Checks whether a habit has at least 14 days of observation history."""
        ref_date = reference_date or date.today()
        habit_logs = [log for log in logs if log.idHabit == habit.idHabit]

        earliest_date: date | None = self._parse_created_date(habit.createdAt)
        for log in habit_logs:
            log_date = date.fromisoformat(log.targetDate)
            if earliest_date is None or log_date < earliest_date:
                earliest_date = log_date

        if earliest_date is None:
            return False

        observed_days = (ref_date - earliest_date).days + 1
        return observed_days >= self.cold_start_min_days

    @staticmethod
    def _build_logs_dataframe(
        habit_id: str,
        logs: list[HabitLogInputDto],
    ) -> pd.DataFrame:
        rows = [
            {
                "targetDate": date.fromisoformat(log.targetDate),
                "delayMinutes": float(log.delayMinutes),
            }
            for log in logs
            if log.idHabit == habit_id
        ]
        if not rows:
            return pd.DataFrame(columns=["targetDate", "delayMinutes"])

        df = pd.DataFrame(rows)
        df = (
            df.groupby("targetDate", as_index=False)["delayMinutes"]
            .mean()
            .sort_values("targetDate")
            .reset_index(drop=True)
        )
        return df

    def calcMissRate(
        self,
        habit: HabitInputDto,
        logs_df: pd.DataFrame,
        window_days: int,
        reference_date: date,
    ) -> float:
        """Calculates the proportion of missed scheduled days in the given window."""
        scheduled_weekdays = self._scheduled_weekdays(habit)
        start_date = reference_date - timedelta(days=window_days - 1)

        scheduled_dates = {
            start_date + timedelta(days=offset)
            for offset in range(window_days)
            if (start_date + timedelta(days=offset)).isoweekday() in scheduled_weekdays
        }
        if not scheduled_dates:
            return 0.0

        if logs_df.empty:
            return 1.0

        completed_dates = set(
            logs_df.loc[
                (logs_df["targetDate"] >= start_date)
                & (logs_df["targetDate"] <= reference_date),
                "targetDate",
            ].tolist()
        )
        completed_on_schedule = len(scheduled_dates.intersection(completed_dates))
        miss_rate = (len(scheduled_dates) - completed_on_schedule) / len(scheduled_dates)
        return round(max(0.0, min(1.0, miss_rate)), 4)

    def calcMeanDelayMinutes(
        self,
        logs_df: pd.DataFrame,
        reference_date: date,
        window_days: int | None = None,
    ) -> float:
        """Calculates mean check-in delay in minutes over the analysis window."""
        effective_window = window_days or self.window_days
        if logs_df.empty:
            return 0.0

        start_date = reference_date - timedelta(days=effective_window - 1)
        window_df = logs_df.loc[
            (logs_df["targetDate"] >= start_date)
            & (logs_df["targetDate"] <= reference_date)
        ]
        if window_df.empty:
            return 0.0

        mean_delay = float(window_df["delayMinutes"].mean())
        return round(max(0.0, mean_delay), 2)

    def calcWeekendMissRate(
        self,
        habit: HabitInputDto,
        logs_df: pd.DataFrame,
        reference_date: date,
        window_days: int | None = None,
    ) -> float:
        """Calculates the miss rate specifically on Saturday (6) and Sunday (7)."""
        effective_window = window_days or self.window_days
        scheduled_weekdays = self._scheduled_weekdays(habit).intersection({6, 7})
        if not scheduled_weekdays:
            return 0.0

        start_date = reference_date - timedelta(days=effective_window - 1)
        weekend_scheduled = {
            start_date + timedelta(days=offset)
            for offset in range(effective_window)
            if (start_date + timedelta(days=offset)).isoweekday() in scheduled_weekdays
        }
        if not weekend_scheduled:
            return 0.0

        if logs_df.empty:
            return 1.0

        completed_dates = set(
            logs_df.loc[
                (logs_df["targetDate"] >= start_date)
                & (logs_df["targetDate"] <= reference_date),
                "targetDate",
            ].tolist()
        )
        completed_weekend = len(weekend_scheduled.intersection(completed_dates))
        miss_rate = (len(weekend_scheduled) - completed_weekend) / len(weekend_scheduled)
        return round(max(0.0, min(1.0, miss_rate)), 4)

    def _compute_current_streak(
        self,
        habit: HabitInputDto,
        logs_df: pd.DataFrame,
        reference_date: date,
    ) -> int:
        """Computes active streak from logs up to reference_date."""
        if logs_df.empty:
            return 0

        scheduled_weekdays = self._scheduled_weekdays(habit)
        completed_dates = set(logs_df["targetDate"].tolist())

        streak = 0
        cursor = reference_date
        for _ in range(self.window_days):
            if cursor.isoweekday() in scheduled_weekdays:
                if cursor in completed_dates:
                    streak += 1
                else:
                    break
            cursor -= timedelta(days=1)
        return streak

    def extractFeatures(
        self,
        habit: HabitInputDto,
        logs: list[HabitLogInputDto],
        reference_date: date | None = None,
    ) -> FeatureVectorDto:
        """Builds FeatureVectorDto for a single habit over the 30-day window."""
        ref_date = reference_date or date.today()
        logs_df = self._build_logs_dataframe(habit.idHabit, logs)

        miss_rate_7d = self.calcMissRate(habit, logs_df, window_days=7, reference_date=ref_date)
        miss_rate_14d = self.calcMissRate(habit, logs_df, window_days=14, reference_date=ref_date)
        mean_delay = self.calcMeanDelayMinutes(
            logs_df, reference_date=ref_date, window_days=self.window_days
        )
        weekend_miss_rate = self.calcWeekendMissRate(
            habit, logs_df, reference_date=ref_date, window_days=self.window_days
        )
        computed_streak = self._compute_current_streak(habit, logs_df, reference_date=ref_date)

        return FeatureVectorDto(
            missRate7d=miss_rate_7d,
            missRate14d=miss_rate_14d,
            currentStreak=computed_streak,
            meanDelayMinutes=mean_delay,
            weekendMissRate=weekend_miss_rate,
        )
