import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { of, switchMap } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { HabitService } from '../../core/services/habit.service';
import { StatisticsService } from '../../core/services/statistics.service';
import { MlAnalysisService } from '../../core/services/ml-analysis.service';
import { Habit, HabitLog, Recommendation, RiskLevel } from '../../core/models/habit.model';

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
  imports: [CommonModule],
  template: `
    <main class="page analysis-page">
      <section class="analysis-header">
        <div class="analysis-header__left">
          <span class="eyebrow">РОЗУМНІ РЕКОМЕНДАЦІЇ</span>
          <h1>Аналіз розкладу</h1>
        </div>

        <div class="analysis-header__right">
          <div class="server-pill">
            <span
              class="server-dot"
              [class.server-dot--online]="health().online"
            ></span>
            @if (health().online) {
              <span>Локальний сервер аналітики: підключено</span>
              <span class="mono server-host">127.0.0.1:8000</span>
            } @else {
              <span>Локальний резервний режим (fallback)</span>
            }
          </div>

          <button
            type="button"
            class="btn btn--secondary"
            (click)="recalculate()"
            [disabled]="analyzing() || habits().length === 0"
          >
            {{ analyzing() ? 'Аналіз...' : 'Перерахувати' }}
          </button>
        </div>
      </section>

      @if (noticeMsg()) {
        <div class="notice-banner">{{ noticeMsg() }}</div>
      }

      <section class="analysis-grid">
        <div class="analysis-main">
          <h3 class="analysis-section-title">Звички, що потребують корекції графіка</h3>

          @if (analyzing()) {
            <div class="card analysis-empty">
              <div class="spinner"></div>
              <p>Аналізуємо історію чекінів та обчислюємо ймовірність пропусків...</p>
            </div>
          } @else if (cards().length === 0) {
            <div class="card analysis-empty">
              <p>
                Наразі немає активних рекомендацій корекції графіка.
                @if (habits().length > 0) {
                  Натисніть «Перерахувати», щоб оновити прогноз для {{ habits().length }} звичок.
                }
              </p>
            </div>
          } @else {
            <div class="rec-list">
              @for (item of cards(); track item.rec.idRecommendation) {
                <article class="rec-card card">
                  <div class="rec-card__head">
                    <div class="rec-card__title-group">
                      <h3>{{ item.habitTitle }}</h3>
                      @if (item.isBasicForecast) {
                        <span class="badge badge--stable">Базовий прогноз</span>
                      }
                    </div>
                    <span class="badge badge--risk mono">
                      Ймовірність пропуску: {{ item.rec.riskScore.toFixed(2) }} ({{ item.riskLabel }})
                    </span>
                  </div>

                  <div class="rec-card__boxes">
                    <div class="info-box">
                      <span class="eyebrow">ПОТОЧНИЙ ПЛАН</span>
                      <div class="info-box__value">{{ item.currentPlanLabel }}</div>
                    </div>

                    @if (item.rec.mainFactor === 'late_checkin') {
                      <div class="info-box">
                        <span class="eyebrow">ФАКТИЧНИЙ МЕДІАННИЙ ЧАС</span>
                        <div class="info-box__value mono">{{ item.medianActualTime }}</div>
                        @if (item.deviationLabel) {
                          <div class="info-box__deviation">{{ item.deviationLabel }}</div>
                        }
                      </div>
                    } @else {
                      <div class="info-box">
                        <span class="eyebrow">РЕКОМЕНДОВАНО</span>
                        <div class="info-box__value">{{ item.recommendedFreqLabel }}</div>
                      </div>
                    }
                  </div>

                  <div class="rec-card__explanation">
                    {{ item.rec.explanationText }}
                  </div>

                  <div class="rec-card__actions">
                    <button
                      type="button"
                      class="btn btn--primary"
                      [disabled]="busyRecId() === item.rec.idRecommendation"
                      (click)="onAccept(item)"
                    >
                      {{ item.primaryButtonLabel }}
                    </button>
                    <button
                      type="button"
                      class="btn btn--secondary"
                      [disabled]="busyRecId() === item.rec.idRecommendation"
                      (click)="onDismiss(item)"
                    >
                      {{ item.secondaryButtonLabel }}
                    </button>
                  </div>
                </article>
              }
            </div>
          }
        </div>

        <aside class="model-card card">
          <h3>Параметри моделі класифікації</h3>

          <div class="model-meta">
            <span class="model-meta__label">Алгоритм</span>
            <div class="model-meta__value">
              <strong>Random Forest</strong>
              <span class="model-meta__muted">(scikit-learn)</span>
            </div>
          </div>

          <div class="model-meta">
            <span class="model-meta__label">Вікно спостереження</span>
            <div class="model-meta__value">
              <strong>30 діб</strong>
            </div>
          </div>

          <div class="model-weights">
            <span class="model-weights__title">Вага ознак у прогнозі</span>

            @for (fw of featureWeights; track fw.label) {
              <div class="weight-row">
                <div class="weight-row__head">
                  <span>{{ fw.label }}</span>
                  <span class="mono">{{ fw.weight.toFixed(2) }}</span>
                </div>
                <div class="weight-row__track">
                  <div class="weight-row__fill" [style.width.%]="fw.widthPercent"></div>
                </div>
              </div>
            }
          </div>

          <div class="model-card__foot mono">
            Останнє навчання моделі · {{ modelDateLabel }}
          </div>
        </aside>
      </section>

      <footer class="analysis-footer">
        <span class="eyebrow">МОДЕЛЬ ОНОВЛЕНО {{ lastUpdatedLabel() }}</span>
        <span class="eyebrow">4 ОЗНАКИ · 30 ДІБ ДАНИХ</span>
      </footer>
    </main>
  `,
  styleUrls: ['./schedule-analysis.component.scss'],
})
export class ScheduleAnalysisComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly habitService = inject(HabitService);
  private readonly statsService = inject(StatisticsService);
  private readonly mlService = inject(MlAnalysisService);

  readonly health = this.mlService.healthStatus;
  readonly analyzing = signal(false);
  readonly busyRecId = signal<string | null>(null);
  readonly noticeMsg = signal('');
  readonly lastUpdatedLabel = signal('ЩОЙНО');
  readonly modelDateLabel = this.formatTodayDotDate();

  readonly featureWeights: FeatureWeightItem[] = [
    { label: 'Середнє запізнення чекіну', weight: 0.42, widthPercent: 42 },
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
      .filter((r) => r.status === 'pending')
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

        return {
          rec,
          habit,
          habitTitle: habit?.title ?? 'Звичка',
          riskLabel: this.mapRiskLabel(rec.riskLevel),
          isBasicForecast: !this.health().online || this.isColdStartHabit(habit),
          currentPlanLabel,
          medianActualTime: medianTime,
          deviationLabel: deviation,
          recommendedFreqLabel: `Пн–Пт (${rec.suggestedFrequency} дн./тиж.)`,
          primaryButtonLabel: isLate
            ? `Змінити час на ${rec.suggestedTime}`
            : 'Перейти на графік Пн–Пт',
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
      const now = new Date();
      this.lastUpdatedLabel.set(
        `О ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
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

    const delays = logs.map((l) => Math.max(0, Math.round(l.delayMinutes))).sort((a, b) => a - b);
    const mid = Math.floor(delays.length / 2);
    const medianDelay =
      delays.length % 2 === 0 ? Math.round((delays[mid - 1] + delays[mid]) / 2) : delays[mid];

    const [ph, pm] = habit.reminderTime.split(':').map(Number);
    const actualMinutes = Math.min(23 * 60 + 59, ph * 60 + pm + medianDelay);
    const medianTime = this.statsService.formatMinutesToTime(actualMinutes);

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

  private formatTodayDotDate(): string {
    const d = new Date();
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}.${month}.${d.getFullYear()}`;
  }
}
