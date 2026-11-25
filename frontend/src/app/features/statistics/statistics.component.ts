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
  templateUrl: './statistics.component.html',
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
