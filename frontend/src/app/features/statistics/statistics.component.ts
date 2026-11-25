import { ChangeDetectionStrategy, Component, inject, signal, computed } from '@angular/core';
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
import {
  formatIsoDate,
  getZonedDateParts,
  getZonedTodayDate,
  resolveTimeZone,
} from '../../core/utils/date-time.util';

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
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="page stats-page">
      <div class="stats-toolbar">
        <div class="stats-filter">
          <label for="habitFilter" class="eyebrow">ФІЛЬТР ЗВИЧКИ</label>
          <select
            #habitSelect
            id="habitFilter"
            class="form-control stats-select"
            [value]="selectedHabitId()"
            (change)="onHabitFilterChange(habitSelect.value)"
          >
            <option value="all">Усі звички ({{ habits().length }})</option>
            @for (h of habits(); track h.idHabit) {
              <option [value]="h.idHabit">{{ h.title }}</option>
            }
          </select>
        </div>
      </div>

      <section class="kpi-card card">
        <div class="kpi-grid">
          <div class="kpi-item">
            <span class="kpi-item__label">Загальна послідовність</span>
            <div class="kpi-item__value kpi-item__value--lg">{{ overallConsistency() }}%</div>
            <div class="kpi-item__sub">
              @if (periodComparison().hasPrevious) {
                <span [class.trend-up]="periodComparison().isPositive" [class.trend-down]="!periodComparison().isPositive">
                  {{ periodComparison().arrow }} {{ periodComparison().label }}
                </span>
                <span>до попереднього періоду</span>
              } @else {
                <span>Перший період спостереження</span>
              }
            </div>
          </div>

          <div class="kpi-item">
            <span class="kpi-item__label">Відміток за {{ selectedPeriod() }} дн.</span>
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
                  <stop offset="0%" stop-color="var(--green)" stop-opacity="0.18" />
                  <stop offset="100%" stop-color="var(--green)" stop-opacity="0.01" />
                </linearGradient>
              </defs>
              <path [attr.d]="sparklineAreaPath()" fill="url(#sparkFill)" />
              <path [attr.d]="sparklineLinePath()" fill="none" stroke="var(--green)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <span class="eyebrow">ДИНАМІКА ВИКОНАННЯ</span>
          </div>
        </div>
      </section>

      <section class="charts-grid">
        <article class="chart-card card">
          <div class="chart-card__head">
            <h3>Частота виконання за днями тижня (%)</h3>
            <div class="period-switch" role="group" aria-label="Період статистики">
              @for (p of periods; track p) {
                <button
                  type="button"
                  class="period-switch__btn"
                  [class.active]="selectedPeriod() === p"
                  (click)="selectedPeriod.set(p)"
                >
                  {{ p }} дн.
                </button>
              }
            </div>
          </div>

          <div class="chart-card__stat">
            <span class="chart-card__big">{{ weeklyAverageRate() }}%</span>
            @if (periodComparison().hasPrevious) {
              <span [class.trend-up]="periodComparison().isPositive" [class.trend-down]="!periodComparison().isPositive">
                {{ periodComparison().arrow }} {{ periodComparison().label }}
              </span>
              <span class="chart-card__muted">до попереднього періоду</span>
            } @else {
              <span class="chart-card__muted">середнє за {{ selectedPeriod() }} дн.</span>
            }
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
                <div class="bar-col" [class.bar-col--unscheduled]="item.scheduled === 0">
                  <span class="bar-col__pct mono">
                    {{ item.scheduled === 0 ? '—' : item.rate + '%' }}
                  </span>
                  <div class="bar-col__track">
                    <div
                      class="bar-col__fill"
                      [class.bar-col__fill--unscheduled]="item.scheduled === 0"
                      [class.bar-col__fill--muted]="item.scheduled > 0 && item.rate < 50"
                      [style.height.%]="item.scheduled === 0 ? 12 : item.rate"
                    ></div>
                  </div>
                  <span class="bar-col__label">{{ item.day }}</span>
                </div>
              }
            </div>
          </div>

          <div class="chart-card__foot">
            <div class="legend-group">
              <span class="legend-item">
                <span class="legend-square"></span>
                Виконані відмітки
              </span>
              @if (hasUnscheduledDays()) {
                <span class="legend-item">
                  <span class="legend-square legend-square--unscheduled"></span>
                  Не заплановано
                </span>
              }
            </div>
            <span class="chart-card__muted">
              Середнє за тиждень <strong class="mono">{{ weeklyAverageRounded() }}%</strong>
            </span>
          </div>
        </article>

        <article class="chart-card card">
          <div class="chart-card__head">
            <h3>Розподіл фактичного часу відміток</h3>
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
                @for (band of shadedDayBands(); track band.x) {
                  <rect [attr.x]="band.x" y="0" [attr.width]="band.width" height="156" fill="var(--scatter-band)" />
                }
                <line x1="0" y1="39" x2="360" y2="39" stroke="var(--border-light)" stroke-width="1" />
                <line x1="0" y1="78" x2="360" y2="78" stroke="var(--border-light)" stroke-width="1" />
                <line x1="0" y1="117" x2="360" y2="117" stroke="var(--border-light)" stroke-width="1" />
                <line
                  x1="0"
                  [attr.y1]="meanTimeLineY()"
                  x2="360"
                  [attr.y2]="meanTimeLineY()"
                  stroke="var(--ink-muted)"
                  stroke-width="1"
                  stroke-dasharray="3 3"
                />
                @for (pt of scatterPoints(); track $index) {
                  <circle
                    [attr.cx]="(pt.xPercent / 100) * 360"
                    [attr.cy]="(pt.yPercent / 100) * 144 + 6"
                    r="3.2"
                    [attr.fill]="pt.isLate ? 'var(--late-dot)' : 'var(--green-bar)'"
                    fill-opacity="0.88"
                  >
                    <title>{{ pt.dateLabel }} · {{ pt.timeLabel }}</title>
                  </circle>
                }
              </svg>

              <div class="scatter-chart__xaxis">
                @for (item of weeklyData(); track item.isoDay) {
                  <span [class.xaxis-unscheduled]="item.scheduled === 0">{{ item.day }}</span>
                }
              </div>
            </div>
          </div>

          <div class="chart-card__foot">
            <div class="legend-group">
              <span class="legend-item">
                <span class="legend-dot"></span>
                Вчасно
              </span>
              <span class="legend-item">
                <span class="legend-dot legend-dot--late"></span>
                Із запізненням
              </span>
            </div>
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
        </div>

        @if (visibleLogs().length === 0) {
          <div class="logs-empty">
            <p>Дані для побудови графіків з’являться після перших відміток виконання.</p>
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
        <span class="eyebrow">{{ footerScopeLabel() }}</span>
        <span class="eyebrow">ОСТАННЯ СИНХРОНІЗАЦІЯ · {{ syncTime() }}</span>
      </footer>
    </main>
  `,
  styleUrls: ['./statistics.component.scss'],
})
export class StatisticsComponent {
  private readonly auth = inject(AuthService);
  private readonly habitService = inject(HabitService);
  private readonly statsService = inject(StatisticsService);

  readonly periods: readonly (7 | 14 | 30)[] = [7, 14, 30];
  readonly selectedPeriod = signal<7 | 14 | 30>(30);
  readonly selectedHabitId = signal<string>('all');
  readonly showAllLogs = signal(false);

  readonly userTimeZone = computed(() => resolveTimeZone(this.auth.currentUser()?.timezone));
  readonly syncTime = computed(() => {
    const p = getZonedDateParts(new Date(), this.userTimeZone());
    return `${String(p.hours).padStart(2, '0')}:${String(p.minutes).padStart(2, '0')}`;
  });

  private readonly user$ = toObservable(this.auth.currentUser);

  readonly habits = toSignal(
    this.user$.pipe(switchMap((u) => (u ? this.habitService.getHabits(u.idUser) : of([])))),
    { initialValue: [] as Habit[] }
  );

  readonly filteredHabits = computed(() => {
    const id = this.selectedHabitId();
    const list = this.habits();
    if (id === 'all') return list;
    return list.filter((h) => h.idHabit === id);
  });

  readonly footerScopeLabel = computed(() => {
    const id = this.selectedHabitId();
    if (id === 'all') return `ДАНІ ЗА ${this.habits().length} ЗВИЧКАМИ`;
    const found = this.habits().find((h) => h.idHabit === id);
    return found ? `ЗВИЧКА · ${found.title.toUpperCase()}` : 'ОБРАНА ЗВИЧКА';
  });

  readonly logs60d = toSignal(
    this.user$.pipe(
      switchMap((u) => (u ? this.statsService.getLogsByUser(u.idUser, 65, u.timezone) : of([])))
    ),
    { initialValue: [] as HabitLog[] }
  );

  readonly scopedLogs60d = computed(() => {
    const id = this.selectedHabitId();
    const all = this.logs60d();
    if (id !== 'all') {
      return all.filter((l) => l.idHabit === id);
    }
    const activeIds = new Set(this.habits().map((h) => h.idHabit));
    return all.filter((l) => activeIds.has(l.idHabit));
  });

  readonly logs30d = computed(() => {
    const days = this.selectedPeriod();
    const tz = this.userTimeZone();
    const cutoff = this.dateDaysAgo(days - 1, tz);
    const todayIso = this.dateDaysAgo(0, tz);
    return this.scopedLogs60d().filter((l) => l.targetDate >= cutoff && l.targetDate <= todayIso);
  });

  readonly prevLogs30d = computed(() => {
    const days = this.selectedPeriod();
    const tz = this.userTimeZone();
    const cutoffCurr = this.dateDaysAgo(days - 1, tz);
    const cutoffPrev = this.dateDaysAgo(days * 2 - 1, tz);
    return this.scopedLogs60d().filter(
      (l) => l.targetDate >= cutoffPrev && l.targetDate < cutoffCurr
    );
  });

  readonly totalCheckIns30d = computed(() => this.logs30d().length);

  readonly totalScheduled30d = computed(() =>
    this.statsService.countScheduledOccurrences(
      this.filteredHabits(),
      this.selectedPeriod(),
      0,
      this.userTimeZone()
    )
  );

  readonly prevScheduled30d = computed(() =>
    this.statsService.countScheduledOccurrences(
      this.filteredHabits(),
      this.selectedPeriod(),
      this.selectedPeriod(),
      this.userTimeZone()
    )
  );

  readonly overallConsistency = computed(() => {
    const scheduled = this.totalScheduled30d();
    if (scheduled === 0) return 0;
    return Math.min(100, Math.round((this.totalCheckIns30d() / scheduled) * 100));
  });

  readonly periodComparison = computed(() => {
    const currScheduled = this.totalScheduled30d();
    const prevScheduled = this.prevScheduled30d();
    const prevLogs = this.prevLogs30d();
    if (currScheduled === 0 || prevScheduled === 0 || prevLogs.length === 0) {
      return { hasPrevious: false, isPositive: true, arrow: '↗', label: '0,0%' };
    }
    const prevPct = Math.min(100, (prevLogs.length / prevScheduled) * 100);
    const currPct = Math.min(100, (this.logs30d().length / currScheduled) * 100);
    const diff = currPct - prevPct;
    return {
      hasPrevious: true,
      isPositive: diff >= 0,
      arrow: diff >= 0 ? '↗' : '↘',
      label: `${Math.abs(diff).toFixed(1).replace('.', ',')}%`,
    };
  });

  readonly bestStreakInfo = computed(() => {
    const habits = this.filteredHabits();
    if (habits.length === 0) {
      return { days: 0, habitTitle: 'Немає активних звичок' };
    }
    const best = habits.reduce((top, curr) => (curr.bestStreak > top.bestStreak ? curr : top));
    return {
      days: best.bestStreak,
      habitTitle: best.title,
    };
  });

  readonly activeHabitsPadded = computed(() => String(this.filteredHabits().length).padStart(2, '0'));

  readonly weeklyData = computed<WeeklyChartItem[]>(() =>
    this.statsService.buildWeeklyChartData(
      this.logs30d(),
      this.filteredHabits(),
      this.selectedPeriod(),
      this.userTimeZone()
    )
  );

  readonly hasUnscheduledDays = computed(() =>
    this.weeklyData().some((item) => item.scheduled === 0)
  );

  readonly shadedDayBands = computed(() => {
    const colWidth = 360 / 7;
    return this.weeklyData()
      .filter((item) => item.scheduled === 0)
      .map((item) => ({ x: (item.isoDay - 1) * colWidth, width: colWidth }));
  });

  readonly weeklyAverageRate = computed(() => {
    const scheduledDays = this.weeklyData().filter((item) => item.scheduled > 0);
    if (scheduledDays.length === 0) return '0.0';
    const avg = scheduledDays.reduce((sum, item) => sum + item.rate, 0) / scheduledDays.length;
    return avg.toFixed(1);
  });

  readonly weeklyAverageRounded = computed(() => Math.round(Number(this.weeklyAverageRate())));

  readonly scatterPoints = computed<CheckInScatterPoint[]>(() =>
    this.statsService.buildCheckInScatterPoints(this.logs30d(), this.userTimeZone())
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
    this.statsService.buildDailySparklinePoints(
      this.logs30d(),
      this.filteredHabits(),
      this.selectedPeriod(),
      this.userTimeZone()
    )
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
    const tz = this.userTimeZone();
    return this.logs30d().map((log) => {
      const delay = Math.max(0, Math.round(log.delayMinutes));
      const actualMin = this.statsService.extractActualMinutes(log, tz);
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

  onHabitFilterChange(habitId: string): void {
    this.selectedHabitId.set(habitId);
    this.showAllLogs.set(false);
  }

  streakWord(days: number): string {
    const mod10 = days % 10;
    const mod100 = days % 100;
    if (mod10 === 1 && mod100 !== 11) return 'день';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'дні';
    return 'днів';
  }

  private dateDaysAgo(days: number, timeZone?: string): string {
    const d = getZonedTodayDate(timeZone);
    d.setDate(d.getDate() - days);
    return formatIsoDate(d);
  }
}
