import { ChangeDetectionStrategy, Component, OnInit, inject, signal, computed } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { of, switchMap } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { HabitService } from '../../core/services/habit.service';
import { StatisticsService } from '../../core/services/statistics.service';
import { MlAnalysisService } from '../../core/services/ml-analysis.service';
import { Habit, HabitLog, Recommendation, RiskLevel } from '../../core/models/habit.model';
import { getZonedDateParts, resolveTimeZone } from '../../core/utils/date-time.util';

interface RecommendationCardVm {
  rec: Recommendation;
  habit: Habit | null;
  habitTitle: string;
  riskLabel: string;
  isBasicForecast: boolean;
  currentPlanLabel: string;
  medianActualTime: string;
  deviationLabel: string;
  recommendedFreqLabel: string;
  primaryButtonLabel: string;
  secondaryButtonLabel: string;
}

interface FeatureWeightItem {
  label: string;
  weight: number;
  widthPercent: number;
}

@Component({
  selector: 'app-schedule-analysis',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './schedule-analysis.component.html',
  styleUrls: ['./schedule-analysis.component.scss'],
})
export class ScheduleAnalysisComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly habitService = inject(HabitService);
  private readonly statsService = inject(StatisticsService);
  private readonly mlService = inject(MlAnalysisService);

  readonly userTimeZone = computed(() => resolveTimeZone(this.auth.currentUser()?.timezone));
  readonly health = this.mlService.healthStatus;
  readonly analyzing = signal(false);
  readonly busyRecId = signal<string | null>(null);
  readonly noticeMsg = signal('');
  readonly lastUpdatedLabel = signal('ЩОЙНО');
  readonly modelDateLabel = computed(() => {
    const p = getZonedDateParts(new Date(), this.userTimeZone());
    return `${String(p.day).padStart(2, '0')}.${String(p.month).padStart(2, '0')}.${p.year}`;
  });

  readonly featureWeights: FeatureWeightItem[] = [
    { label: 'Середнє запізнення відмітки', weight: 0.42, widthPercent: 42 },
    { label: 'Частка пропусків за 7 днів', weight: 0.31, widthPercent: 31 },
    { label: 'День тижня / вихідний', weight: 0.18, widthPercent: 18 },
    { label: 'Поточна серія', weight: 0.09, widthPercent: 9 },
  ];

  private readonly user$ = toObservable(this.auth.currentUser);

  readonly habits = toSignal(
    this.user$.pipe(switchMap((u) => (u ? this.habitService.getHabits(u.idUser) : of([])))),
    { initialValue: [] as Habit[] }
  );

  readonly logs30d = toSignal(
    this.user$.pipe(switchMap((u) => (u ? this.statsService.getLogsByUser(u.idUser, 30) : of([])))),
    { initialValue: [] as HabitLog[] }
  );

  readonly recommendations = toSignal(
    this.user$.pipe(switchMap((u) => (u ? this.mlService.getRecommendations(u.idUser) : of([])))),
    { initialValue: [] as Recommendation[] }
  );

  readonly cards = computed<RecommendationCardVm[]>(() => {
    const habitMap = new Map(this.habits().map((h) => [h.idHabit, h]));
    const logs = this.logs30d();

    return this.recommendations()
      .filter((r) => r.status === 'pending' && habitMap.has(r.idHabit))
      .map((rec) => {
        const habit = habitMap.get(rec.idHabit) ?? null;
        const habitLogs = logs.filter((l) => l.idHabit === rec.idHabit);
        const { medianTime, deviation } = this.computeMedianStats(habit, habitLogs, rec);

        const isLate = rec.mainFactor === 'late_checkin';
        const currentPlanLabel = habit
          ? isLate
            ? `${this.formatFrequencyShort(habit)} о ${habit.reminderTime}`
            : this.formatDaysRange(habit)
          : '—';

        const isThreeDayPlan = rec.suggestedFrequency <= 3;
        const recommendedDaysTitle = isThreeDayPlan ? 'Пн, Ср, Пт' : 'Пн–Пт';

        return {
          rec,
          habit,
          habitTitle: habit?.title ?? 'Звичка',
          riskLabel: this.mapRiskLabel(rec.riskLevel),
          isBasicForecast: !this.health().online || this.isColdStartHabit(habit),
          currentPlanLabel,
          medianActualTime: medianTime,
          deviationLabel: deviation,
          recommendedFreqLabel: `${recommendedDaysTitle} (${rec.suggestedFrequency} дн./тиж.)`,
          primaryButtonLabel: isLate
            ? `Змінити час на ${rec.suggestedTime}`
            : `Перейти на графік ${recommendedDaysTitle}`,
          secondaryButtonLabel: isLate && habit ? `Залишити ${habit.reminderTime}` : 'Відхилити',
        };
      });
  });

  ngOnInit(): void {
    void this.mlService.checkHealth();
  }

  async recalculate(): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) return;

    this.analyzing.set(true);
    this.noticeMsg.set('');

    try {
      const limit = user.notificationLimit || 3;
      const generated = await this.mlService.analyzeHabits(this.habits(), this.logs30d(), limit);
      const p = getZonedDateParts(new Date(), this.userTimeZone());
      this.lastUpdatedLabel.set(
        `О ${String(p.hours).padStart(2, '0')}:${String(p.minutes).padStart(2, '0')}`
      );
      if (generated.length === 0) {
        this.noticeMsg.set('Усі активні звички виконуються стабільно — корекція графіка не потрібна.');
      }
    } finally {
      this.analyzing.set(false);
    }
  }

  async onAccept(item: RecommendationCardVm): Promise<void> {
    this.busyRecId.set(item.rec.idRecommendation);
    this.noticeMsg.set('');
    try {
      await this.mlService.applyRecommendation(item.rec, item.habit ?? undefined);
      this.noticeMsg.set(`Розклад звички «${item.habitTitle}» успішно оновлено.`);
    } finally {
      this.busyRecId.set(null);
    }
  }

  async onDismiss(item: RecommendationCardVm): Promise<void> {
    this.busyRecId.set(item.rec.idRecommendation);
    this.noticeMsg.set('');
    try {
      const isPaused = await this.mlService.dismissRecommendation(item.rec.idRecommendation);
      if (isPaused) {
        this.noticeMsg.set(
          `Для звички «${item.habitTitle}» рекомендації призупинено на 7 днів після 2 відхилень.`
        );
      }
    } finally {
      this.busyRecId.set(null);
    }
  }

  private mapRiskLabel(level: RiskLevel): string {
    if (level === 'high') return 'Висока';
    if (level === 'medium') return 'Середня';
    return 'Низька';
  }

  private formatFrequencyShort(habit: Habit): string {
    if (habit.frequencyType === 'daily' || habit.targetDays.length === 7) return 'Щодня';
    return `${habit.targetDays.length} дн./тиж.`;
  }

  private formatDaysRange(habit: Habit): string {
    if (habit.frequencyType === 'daily' || habit.targetDays.length === 7) {
      return 'Пн–Нд (7 дн./тиж.)';
    }
    return `${habit.targetDays.length} дн./тиж.`;
  }

  private computeMedianStats(
    habit: Habit | null,
    logs: HabitLog[],
    rec: Recommendation
  ): { medianTime: string; deviation: string } {
    if (!habit || logs.length === 0) {
      return { medianTime: rec.suggestedTime, deviation: '' };
    }

    const tz = this.userTimeZone();
    const actualMinutesList = logs
      .map((l) => this.statsService.extractActualMinutes(l, tz))
      .sort((a, b) => a - b);
    const midActual = Math.floor(actualMinutesList.length / 2);
    const medianActualMinutes =
      actualMinutesList.length % 2 === 0
        ? Math.round((actualMinutesList[midActual - 1] + actualMinutesList[midActual]) / 2)
        : actualMinutesList[midActual];

    const delays = logs.map((l) => Math.max(0, Math.round(l.delayMinutes))).sort((a, b) => a - b);
    const midDelay = Math.floor(delays.length / 2);
    const medianDelay =
      delays.length % 2 === 0 ? Math.round((delays[midDelay - 1] + delays[midDelay]) / 2) : delays[midDelay];

    const medianTime = this.statsService.formatMinutesToTime(medianActualMinutes);

    if (medianDelay <= 0) {
      return { medianTime, deviation: '' };
    }

    const hours = Math.floor(medianDelay / 60);
    const mins = medianDelay % 60;
    const deviation =
      hours > 0
        ? `відхилення +${hours} год ${mins} хв`
        : `відхилення +${mins} хв`;

    return { medianTime, deviation };
  }

  private isColdStartHabit(habit: Habit | null): boolean {
    if (!habit?.createdAt || typeof habit.createdAt.toDate !== 'function') return true;
    const createdMs = habit.createdAt.toDate().getTime();
    const days = (Date.now() - createdMs) / (1000 * 60 * 60 * 24);
    return days < 14;
  }
}
