import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { of, switchMap } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { HabitService } from '../../core/services/habit.service';
import {
  StatisticsService,
  WeeklyChartItem,
  CheckInScatterPoint,
} from '../../core/services/statistics.service';
import { Habit, HabitLog } from '../../core/models/habit.model';

interface LogTableRow {
  idLog: string;
  dateFormatted: string;
  habitTitle: string;
  plannedTime: string;
  actualTime: string;
  delayMinutes: number;
  isLate: boolean;
  isSevereDelay: boolean;
}

@Component({
  selector: 'app-statistics',
  standalone: true,
  imports: [CommonModule],
  template: `
    <main class="page stats-page">
      <section class="kpi-card card">
        <div class="kpi-grid">
          <div class="kpi-item">
            <span class="kpi-item__label">Загальна послідовність</span>
            <div class="kpi-item__value kpi-item__value--lg">{{ overallConsistency() }}%</div>
            <div class="kpi-item__sub">
              <span class="trend-up">↗ {{ consistencyDeltaLabel() }}</span>
              <span>порівняно з минулим місяцем</span>
            </div>
          </div>

          <div class="kpi-item">
            <span class="kpi-item__label">Відміток цього місяця</span>
            <div class="kpi-item__value">{{ totalCheckIns30d() }}</div>
            <div class="kpi-item__sub">із {{ totalScheduled30d() }} запланованих</div>
          </div>

          <div class="kpi-item">
            <span class="kpi-item__label">Найдовша серія</span>
            <div class="kpi-item__value">
              {{ bestStreakInfo().days }}
              <span class="kpi-item__unit">{{ streakWord(bestStreakInfo().days) }}</span>
            </div>
            <div class="kpi-item__sub">{{ bestStreakInfo().habitTitle }}</div>
          </div>

          <div class="kpi-item">
            <span class="kpi-item__label">Активні звички</span>
            <div class="kpi-item__value mono">{{ activeHabitsPadded() }}</div>
            <div class="kpi-item__sub">за поточним графіком</div>
          </div>

          <div class="kpi-spark">
            <svg class="spark-svg" viewBox="0 0 180 54" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#166534" stop-opacity="0.16" />
                  <stop offset="100%" stop-color="#166534" stop-opacity="0.01" />
                </linearGradient>
              </defs>
              <path [attr.d]="sparklineAreaPath()" fill="url(#sparkFill)" />
              <path [attr.d]="sparklineLinePath()" fill="none" stroke="#166534" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <span class="eyebrow">ДИНАМІКА ВИКОНАННЯ</span>
          </div>
        </div>
      </section>

      <section class="charts-grid">
        <article class="chart-card card">
          <div class="chart-card__head">
            <h3>Частота виконання за днями тижня (%)</h3>
            <span class="chart-card__period">Останні 30 днів</span>
          </div>

          <div class="chart-card__stat">
            <span class="chart-card__big">{{ weeklyAverageRate() }}%</span>
            <span class="trend-up">↗ {{ weeklyDeltaLabel() }}</span>
            <span class="chart-card__muted">до попереднього періоду</span>
          </div>

          <div class="bar-chart">
            <div class="bar-chart__yaxis mono">
              <span>100%</span>
              <span>75%</span>
              <span>50%</span>
              <span>25%</span>
              <span>0%</span>
            </div>

            <div class="bar-chart__plot">
              @for (item of weeklyData(); track item.isoDay) {
                <div class="bar-col">
                  <span class="bar-col__pct mono">{{ item.rate }}%</span>
                  <div class="bar-col__track">
                    <div
                      class="bar-col__fill"
                      [class.bar-col__fill--muted]="item.isWeekend || item.rate < 50"
                      [style.height.%]="item.rate"
                    ></div>
                  </div>
                  <span class="bar-col__label">{{ item.day }}</span>
                </div>
              }
            </div>
          </div>

          <div class="chart-card__foot">
            <span class="legend-item">
              <span class="legend-square"></span>
              Виконані відмітки
            </span>
            <span class="chart-card__muted">
              Середнє за тиждень <strong class="mono">{{ weeklyAverageRounded() }}%</strong>
            </span>
          </div>
        </article>

        <article class="chart-card card">
          <div class="chart-card__head">
            <h3>Розподіл фактичного часу чекінів</h3>
            <span class="chart-card__period mono">06:00 – 23:00</span>
          </div>

          <div class="chart-card__stat">
            <span class="chart-card__big mono">{{ meanCheckInTime() }}</span>
            <span class="chart-card__muted">середній час відмітки</span>
            <span class="mono delay-tag">↘ {{ meanDelayMinutes() }} хв</span>
          </div>

          <div class="scatter-chart">
            <div class="scatter-chart__yaxis mono">
              <span>23:00</span>
              <span>18:00</span>
              <span>12:00</span>
              <span>06:00</span>
            </div>

            <div class="scatter-chart__body">
              <svg class="scatter-svg" viewBox="0 0 360 156" preserveAspectRatio="none">
                <rect x="257" y="0" width="103" height="156" fill="#F5F4F0" />
                <line x1="0" y1="39" x2="360" y2="39" stroke="#F0EFEA" stroke-width="1" />
                <line x1="0" y1="78" x2="360" y2="78" stroke="#F0EFEA" stroke-width="1" />
                <line x1="0" y1="117" x2="360" y2="117" stroke="#F0EFEA" stroke-width="1" />
                <line
                  x1="0"
                  [attr.y1]="meanTimeLineY()"
                  x2="360"
                  [attr.y2]="meanTimeLineY()"
                  stroke="#71717A"
                  stroke-width="1"
                  stroke-dasharray="3 3"
                />
                @for (pt of scatterPoints(); track $index) {
                  <circle
                    [attr.cx]="(pt.xPercent / 100) * 360"
                    [attr.cy]="(pt.yPercent / 100) * 144 + 6"
                    r="2.8"
                    fill="#2F7D4E"
                    fill-opacity="0.82"
                  >
                    <title>{{ pt.dateLabel }} · {{ pt.timeLabel }}</title>
                  </circle>
                }
              </svg>

              <div class="scatter-chart__xaxis">
                <span>Пн</span>
                <span>Вт</span>
                <span>Ср</span>
                <span>Чт</span>
                <span>Пт</span>
                <span>Сб</span>
                <span>Нд</span>
              </div>
            </div>
          </div>

          <div class="chart-card__foot">
            <span class="legend-item">
              <span class="legend-dot"></span>
              Фактичний чекін
            </span>
            <span class="legend-item">
              <span class="legend-dash"></span>
              Середній час
            </span>
          </div>
        </article>
      </section>

      <section class="logs-card card">
        <div class="logs-card__head">
          <h3>Журнал останніх відміток</h3>
          <span class="mono logs-card__collection">habit_logs</span>
        </div>

        @if (visibleLogs().length === 0) {
          <div class="logs-empty">
            <p>Ще немає жодної відмітки за останні 30 днів.</p>
          </div>
        } @else {
          <div class="logs-table-wrap">
            <table class="logs-table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Звичка</th>
                  <th>Плановий час</th>
                  <th>Час відмітки</th>
                  <th class="col-right">Затримка (хв)</th>
                </tr>
              </thead>
              <tbody>
                @for (row of visibleLogs(); track row.idLog) {
                  <tr>
                    <td class="mono muted-cell">{{ row.dateFormatted }}</td>
                    <td>
                      <span class="log-habit">
                        <span class="status-dot" [class.status-dot--late]="row.isLate"></span>
                        {{ row.habitTitle }}
                      </span>
                    </td>
                    <td class="mono muted-cell">{{ row.plannedTime }}</td>
                    <td class="mono muted-cell">{{ row.actualTime }}</td>
                    <td class="mono col-right" [class.delay-severe]="row.isSevereDelay">
                      {{ row.delayMinutes }}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          @if (allLogRows().length > 5) {
            <button type="button" class="logs-toggle" (click)="showAllLogs.set(!showAllLogs())">
              {{ showAllLogs() ? 'Згорнути журнал' : 'Переглянути весь журнал' }}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </button>
          }
        }
      </section>

      <footer class="stats-footer">
        <span class="eyebrow">ДАНІ ЗА {{ habits().length }} ЗВИЧКАМИ</span>
        <span class="eyebrow">ОСТАННЯ СИНХРОНІЗАЦІЯ · {{ syncTime }}</span>
      </footer>
    </main>
  `,
  styleUrls: ['./statistics.component.scss'],
})
export class StatisticsComponent {
  private readonly auth = inject(AuthService);
  private readonly habitService = inject(HabitService);
  private readonly statsService = inject(StatisticsService);

  readonly showAllLogs = signal(false);
  readonly syncTime = this.formatCurrentTime();

  private readonly user$ = toObservable(this.auth.currentUser);

  readonly habits = toSignal(
    this.user$.pipe(switchMap((u) => (u ? this.habitService.getHabits(u.idUser) : of([])))),
    { initialValue: [] as Habit[] }
  );

  readonly logs60d = toSignal(
    this.user$.pipe(switchMap((u) => (u ? this.statsService.getLogsByUser(u.idUser, 60) : of([])))),
    { initialValue: [] as HabitLog[] }
  );

  readonly logs30d = computed(() => {
    const cutoff = this.dateDaysAgo(29);
    return this.logs60d().filter((l) => l.targetDate >= cutoff);
  });

  readonly prevLogs30d = computed(() => {
    const cutoff = this.dateDaysAgo(29);
    return this.logs60d().filter((l) => l.targetDate < cutoff);
  });

  readonly totalCheckIns30d = computed(() => this.logs30d().length);

  readonly totalScheduled30d = computed(() => {
    const habits = this.habits();
    if (habits.length === 0) return 0;
    const today = new Date();
    let total = 0;
    for (let offset = 0; offset < 30; offset++) {
      const d = new Date(today);
      d.setDate(today.getDate() - offset);
      const isoDay = d.getDay() === 0 ? 7 : d.getDay();
      for (const h of habits) {
        if (h.frequencyType === 'daily' || h.targetDays.includes(isoDay)) {
          total++;
        }
      }
    }
    return total;
  });

  readonly overallConsistency = computed(() => {
    const habits = this.habits();
    if (habits.length === 0) return 0;
    const logs = this.logs30d();
    const sum = habits.reduce(
      (acc, h) => acc + this.statsService.calculateCompletionRate(h, logs, 30),
      0
    );
    return Math.round((sum / habits.length) * 100);
  });

  readonly consistencyDeltaLabel = computed(() => {
    const scheduled = this.totalScheduled30d();
    if (scheduled === 0) return '0,0%';
    const prevPct = (this.prevLogs30d().length / scheduled) * 100;
    const currPct = (this.logs30d().length / scheduled) * 100;
    const diff = Math.max(0, currPct - prevPct);
    return `${diff.toFixed(1).replace('.', ',')}%`;
  });

  readonly bestStreakInfo = computed(() => {
    const habits = this.habits();
    if (habits.length === 0) {
      return { days: 0, habitTitle: 'Немає активних звичок' };
    }
    const best = habits.reduce((top, curr) => (curr.bestStreak > top.bestStreak ? curr : top));
    return {
      days: best.bestStreak,
      habitTitle: best.title,
    };
  });

  readonly activeHabitsPadded = computed(() => String(this.habits().length).padStart(2, '0'));

  readonly weeklyData = computed<WeeklyChartItem[]>(() =>
    this.statsService.buildWeeklyChartData(this.logs30d(), this.habits(), 30)
  );

  readonly weeklyAverageRate = computed(() => {
    const data = this.weeklyData();
    if (data.length === 0) return '0.0';
    const avg = data.reduce((sum, item) => sum + item.rate, 0) / data.length;
    return avg.toFixed(1);
  });

  readonly weeklyAverageRounded = computed(() => Math.round(Number(this.weeklyAverageRate())));

  readonly weeklyDeltaLabel = computed(() => this.consistencyDeltaLabel());

  readonly scatterPoints = computed<CheckInScatterPoint[]>(() =>
    this.statsService.buildCheckInScatterPoints(this.logs30d())
  );

  readonly meanCheckInMinutes = computed(() => {
    const pts = this.scatterPoints();
    if (pts.length === 0) return 18 * 60;
    const sum = pts.reduce((acc, p) => acc + p.minutesOfDay, 0);
    return Math.round(sum / pts.length);
  });

  readonly meanCheckInTime = computed(() =>
    this.scatterPoints().length === 0
      ? '—'
      : this.statsService.formatMinutesToTime(this.meanCheckInMinutes())
  );

  readonly meanTimeLineY = computed(() => {
    const minHour = 6 * 60;
    const maxHour = 23 * 60;
    const clamped = Math.min(maxHour, Math.max(minHour, this.meanCheckInMinutes()));
    const yPct = 100 - ((clamped - minHour) / (maxHour - minHour)) * 100;
    return (yPct / 100) * 144 + 6;
  });

  readonly meanDelayMinutes = computed(() => {
    const logs = this.logs30d();
    if (logs.length === 0) return 0;
    const sum = logs.reduce((acc, l) => acc + Math.max(0, l.delayMinutes), 0);
    return Math.round(sum / logs.length);
  });

  readonly sparklinePoints = computed(() =>
    this.statsService.buildDailySparklinePoints(this.logs30d(), this.habits(), 14)
  );

  readonly sparklineLinePath = computed(() => {
    const pts = this.sparklinePoints();
    if (pts.length === 0) return 'M 0 46 L 180 46';
    const stepX = 180 / Math.max(1, pts.length - 1);
    return pts
      .map((val, idx) => {
        const x = +(idx * stepX).toFixed(1);
        const y = +(48 - (val / 100) * 40).toFixed(1);
        return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`;
      })
      .join(' ');
  });

  readonly sparklineAreaPath = computed(() => `${this.sparklineLinePath()} L 180 54 L 0 54 Z`);

  readonly allLogRows = computed<LogTableRow[]>(() => {
    const habitMap = new Map(this.habits().map((h) => [h.idHabit, h.title]));
    return this.logs30d()
      .slice(0, 20)
      .map((log) => {
        const delay = Math.max(0, Math.round(log.delayMinutes));
        const actualMin = this.statsService.extractActualMinutes(log);
        const [y, m, d] = log.targetDate.split('-');
        return {
          idLog: log.idLog,
          dateFormatted: `${d}.${m}.${y}`,
          habitTitle: habitMap.get(log.idHabit) ?? 'Архівна звичка',
          plannedTime: log.plannedTime,
          actualTime: this.statsService.formatMinutesToTime(actualMin),
          delayMinutes: delay,
          isLate: delay > 30,
          isSevereDelay: delay >= 60,
        };
      });
  });

  readonly visibleLogs = computed(() =>
    this.showAllLogs() ? this.allLogRows() : this.allLogRows().slice(0, 5)
  );

  streakWord(days: number): string {
    const mod10 = days % 10;
    const mod100 = days % 100;
    if (mod10 === 1 && mod100 !== 11) return 'день';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'дні';
    return 'днів';
  }

  private dateDaysAgo(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - days);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private formatCurrentTime(): string {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }
}
