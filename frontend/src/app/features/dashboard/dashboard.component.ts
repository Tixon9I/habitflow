import { ChangeDetectionStrategy, Component, inject, signal, computed } from '@angular/core';
import { RouterModule } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { of, switchMap } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { HabitService } from '../../core/services/habit.service';
import { MlAnalysisService } from '../../core/services/ml-analysis.service';
import { Habit, HabitLog, Recommendation } from '../../core/models/habit.model';
import { HabitModalComponent } from '../habit-modal/habit-modal.component';
import {
  getHabitCreatedDateStr,
  getZonedDateParts,
  resolveTimeZone,
} from '../../core/utils/date-time.util';

type DayStatus = 'done' | 'missed' | 'neutral';
type DashboardFilter = 'today' | 'all' | 'archived';

interface HabitRowVm {
  habit: Habit;
  scheduledToday: boolean;
  completedToday: boolean;
  isOverdue: boolean;
  daysLabel: string;
  streak: number;
  last7Days: DayStatus[];
  riskPercent: number;
  isRisky: boolean;
  isAdapted: boolean;
  isNewHabit: boolean;
}

const UK_WEEKDAYS = [
  'Неділя',
  'Понеділок',
  'Вівторок',
  'Середа',
  'Четвер',
  "П'ятниця",
  'Субота',
];

const UK_SHORT_DAYS: Record<number, string> = {
  1: 'Пн',
  2: 'Вт',
  3: 'Ср',
  4: 'Чт',
  5: 'Пт',
  6: 'Сб',
  7: 'Нд',
};

const UK_MONTHS_GENITIVE = [
  'січня',
  'лютого',
  'березня',
  'квітня',
  'травня',
  'червня',
  'липня',
  'серпня',
  'вересня',
  'жовтня',
  'листопада',
  'грудня',
];

@Component({
  selector: 'app-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterModule, HabitModalComponent],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent {
  private readonly auth = inject(AuthService);
  private readonly habitService = inject(HabitService);
  private readonly mlService = inject(MlAnalysisService);

  readonly userTimeZone = computed(() => resolveTimeZone(this.auth.currentUser()?.timezone));

  readonly todayParts = computed(() => getZonedDateParts(new Date(), this.userTimeZone()));
  readonly todayDate = computed(() => {
    const p = this.todayParts();
    return new Date(p.year, p.month - 1, p.day);
  });
  readonly todayStr = computed(() => this.todayParts().dateStr);
  readonly todayIsoWeekday = computed(() => this.todayParts().isoWeekday);

  readonly yesterdayDate = computed(() => {
    const d = new Date(this.todayDate());
    d.setDate(d.getDate() - 1);
    return d;
  });
  readonly yesterdayStr = computed(() => this.habitService.formatDate(this.yesterdayDate()));
  readonly yesterdayIsoWeekday = computed(() => {
    const day = this.yesterdayDate().getDay();
    return day === 0 ? 7 : day;
  });
  readonly yesterdayLabel = computed(() => {
    const d = this.yesterdayDate();
    return `${String(d.getDate()).padStart(2, '0')} ${UK_MONTHS_GENITIVE[d.getMonth()].toUpperCase()}`;
  });

  readonly todayEyebrow = computed(() => {
    const p = this.todayParts();
    return `${UK_WEEKDAYS[p.weekday].toUpperCase()} · ${String(p.day).padStart(2, '0')} ${UK_MONTHS_GENITIVE[
      p.month - 1
    ].toUpperCase()}`;
  });

  readonly todayTitle = computed(() => {
    const p = this.todayParts();
    return `${UK_WEEKDAYS[p.weekday]}, ${p.day} ${UK_MONTHS_GENITIVE[p.month - 1]}`;
  });

  readonly activeFilter = signal<DashboardFilter>('today');
  readonly busyHabitId = signal<string | null>(null);
  readonly errorMsg = signal('');
  readonly modalOpen = signal(false);
  readonly editingHabit = signal<Habit | null>(null);
  private readonly yesterdayDismissRev = signal(0);

  readonly dismissedYesterdayIds = computed<Set<string>>(() => {
    this.yesterdayDismissRev();
    const uid = this.auth.currentUser()?.idUser;
    const dateKey = this.todayStr();
    if (!uid) return new Set();
    return this.loadDismissedYesterday(uid, dateKey);
  });

  private readonly user$ = toObservable(this.auth.currentUser);

  readonly allHabits = toSignal(
    this.user$.pipe(switchMap((u) => (u ? this.habitService.getAllHabits(u.idUser) : of([])))),
    { initialValue: [] as Habit[] }
  );

  readonly activeHabits = computed(() =>
    this.allHabits()
      .filter((h) => h.isActive)
      .sort((a, b) => a.reminderTime.localeCompare(b.reminderTime))
  );

  readonly archivedHabits = computed(() =>
    this.allHabits()
      .filter((h) => !h.isActive)
      .sort((a, b) => a.title.localeCompare(b.title))
  );

  readonly logs = toSignal(
    this.user$.pipe(switchMap((u) => (u ? this.habitService.getLogsByUser(u.idUser) : of([])))),
    { initialValue: [] as HabitLog[] }
  );

  readonly recommendations = toSignal(
    this.user$.pipe(switchMap((u) => (u ? this.mlService.getRecommendations(u.idUser) : of([])))),
    { initialValue: [] as Recommendation[] }
  );

  readonly pendingRecByHabit = computed(() => {
    const activeIds = new Set(this.activeHabits().map((h) => h.idHabit));
    const map = new Map<string, Recommendation>();
    for (const rec of this.recommendations()) {
      if (rec.status === 'pending' && activeIds.has(rec.idHabit) && !map.has(rec.idHabit)) {
        map.set(rec.idHabit, rec);
      }
    }
    return map;
  });

  readonly adaptedHabitIds = computed(() => {
    const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const set = new Set<string>();
    for (const rec of this.recommendations()) {
      const ts = rec.generatedAt?.toMillis?.() ?? 0;
      if (rec.status === 'accepted' && ts >= sevenDaysAgoMs) {
        set.add(rec.idHabit);
      }
    }
    return set;
  });

  readonly todayRows = computed<HabitRowVm[]>(() => {
    const todayIso = this.todayIsoWeekday();
    return this.activeHabits()
      .filter((h) => h.frequencyType === 'daily' || h.targetDays.includes(todayIso))
      .map((h) => this.buildRowVm(h));
  });

  readonly yesterdayPendingHabits = computed<Habit[]>(() => {
    const dismissed = this.dismissedYesterdayIds();
    const allLogs = this.logs();
    const yIso = this.yesterdayIsoWeekday();
    const yStr = this.yesterdayStr();

    return this.activeHabits().filter((habit) => {
      if (dismissed.has(habit.idHabit)) return false;

      const scheduledYesterday =
        habit.frequencyType === 'daily' || habit.targetDays.includes(yIso);
      if (!scheduledYesterday) return false;

      const createdDateStr = getHabitCreatedDateStr(habit.createdAt, this.userTimeZone());
      if (createdDateStr && createdDateStr > yStr) {
        return false;
      }

      const doneYesterday = allLogs.some(
        (l) => l.idHabit === habit.idHabit && l.targetDate === yStr
      );
      return !doneYesterday;
    });
  });

  readonly displayedRows = computed<HabitRowVm[]>(() => {
    const filter = this.activeFilter();
    if (filter === 'today') return this.todayRows();
    if (filter === 'all') return this.activeHabits().map((h) => this.buildRowVm(h));
    return this.archivedHabits().map((h) => this.buildRowVm(h));
  });

  readonly totalCount = computed(() => this.todayRows().length);
  readonly completedCount = computed(() => this.todayRows().filter((r) => r.completedToday).length);
  readonly completionPercent = computed(() => {
    const total = this.totalCount();
    return total === 0 ? 0 : Math.round((this.completedCount() / total) * 100);
  });

  readonly riskyCount = computed(() => this.pendingRecByHabit().size);

  readonly riskyHabitsWord = computed(() => {
    const n = this.riskyCount();
    if (n === 1) return 'звички';
    return 'звичок';
  });

  readonly nextReminderLabel = computed(() => {
    const nowMin = this.nowMinutes();
    const pending = this.todayRows()
      .filter((r) => !r.completedToday)
      .map((r) => r.habit.reminderTime)
      .sort();

    if (pending.length === 0) {
      return this.totalCount() > 0 ? 'УСІ ЗВИЧКИ ВИКОНАНО' : 'НЕМАЄ ЗАПЛАНОВАНИХ НАГАДУВАНЬ';
    }

    const upcoming = pending.find((t) => this.toMinutes(t) >= nowMin);
    if (upcoming) {
      return `НАСТУПНЕ НАГАДУВАННЯ · ${upcoming}`;
    }
    return `ОЧІКУЮТЬ ВІДМІТКИ · ${pending.length}`;
  });

  async onToggleCheckIn(habit: Habit): Promise<void> {
    this.busyHabitId.set(habit.idHabit);
    this.errorMsg.set('');
    try {
      await this.habitService.toggleCheckIn(habit, this.todayDate(), this.userTimeZone());
    } catch (e: unknown) {
      this.errorMsg.set(e instanceof Error ? e.message : 'Не вдалося оновити відмітку');
    } finally {
      this.busyHabitId.set(null);
    }
  }

  async onRestore(habit: Habit): Promise<void> {
    this.busyHabitId.set(habit.idHabit);
    this.errorMsg.set('');
    try {
      await this.habitService.restoreHabit(habit.idHabit);
    } catch (e: unknown) {
      this.errorMsg.set(e instanceof Error ? e.message : 'Не вдалося відновити звичку');
    } finally {
      this.busyHabitId.set(null);
    }
  }

  async onConfirmYesterday(habit: Habit): Promise<void> {
    this.busyHabitId.set(habit.idHabit);
    this.errorMsg.set('');
    try {
      await this.habitService.toggleCheckIn(habit, this.yesterdayDate(), this.userTimeZone());
    } catch (e: unknown) {
      this.errorMsg.set(e instanceof Error ? e.message : 'Не вдалося зберегти відмітку за вчора');
    } finally {
      this.busyHabitId.set(null);
    }
  }

  onDismissYesterday(habit: Habit): void {
    const uid = this.auth.currentUser()?.idUser;
    if (!uid) return;
    const next = new Set(this.dismissedYesterdayIds());
    next.add(habit.idHabit);
    try {
      localStorage.setItem(this.yesterdayStorageKey(uid, this.todayStr()), JSON.stringify([...next]));
    } catch {}
    this.yesterdayDismissRev.update((v) => v + 1);
  }

  openNewModal(): void {
    this.editingHabit.set(null);
    this.modalOpen.set(true);
  }

  openEditModal(habit: Habit): void {
    this.editingHabit.set(habit);
    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.modalOpen.set(false);
    this.editingHabit.set(null);
  }

  private buildRowVm(habit: Habit): HabitRowVm {
    const habitLogs = this.logs().filter((l) => l.idHabit === habit.idHabit);
    const completedDates = new Set(habitLogs.map((l) => l.targetDate));
    const scheduledToday =
      habit.frequencyType === 'daily' || habit.targetDays.includes(this.todayIsoWeekday());
    const completedToday = completedDates.has(this.todayStr());
    const isOverdue =
      habit.isActive &&
      scheduledToday &&
      !completedToday &&
      this.nowMinutes() > this.toMinutes(habit.reminderTime);

    const createdDateStr = getHabitCreatedDateStr(habit.createdAt, this.userTimeZone());
    const last7Days = this.buildLast7Days(habit, completedDates, createdDateStr);
    const streak = this.habitService.calculateStreak(habit, completedDates, this.todayDate());
    const pendingRec = this.pendingRecByHabit().get(habit.idHabit);
    const isAdapted = !pendingRec && this.adaptedHabitIds().has(habit.idHabit);
    const isNewHabit =
      !pendingRec && !isAdapted && this.isWithinColdStartDays(createdDateStr, 7);
    const riskScore = pendingRec
      ? pendingRec.riskScore
      : isAdapted || isNewHabit
        ? 0
        : this.mlService.runLocalFallback(habit, habitLogs).riskScore;
    const riskPercent = Math.round(riskScore * 100);

    return {
      habit,
      scheduledToday,
      completedToday,
      isOverdue,
      daysLabel: this.formatDaysLabel(habit),
      streak,
      last7Days,
      riskPercent,
      isRisky: Boolean(pendingRec) || (!isAdapted && !isNewHabit && riskScore >= 0.4),
      isAdapted,
      isNewHabit,
    };
  }

  private isWithinColdStartDays(createdDateStr: string | null, minDays: number): boolean {
    if (!createdDateStr) return false;
    const [y, m, d] = createdDateStr.split('-').map(Number);
    const createdLocal = new Date(y, m - 1, d);
    const diffDays =
      Math.floor((this.todayDate().getTime() - createdLocal.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    return diffDays < minDays;
  }

  private formatDaysLabel(habit: Habit): string {
    if (habit.frequencyType === 'daily' || habit.targetDays.length === 7) return 'Пн–Нд';
    const sorted = [...habit.targetDays].sort((a, b) => a - b);
    if (sorted.length === 5 && sorted.join(',') === '1,2,3,4,5') return 'Пн–Пт';
    return sorted.map((d) => UK_SHORT_DAYS[d] ?? String(d)).join(', ');
  }

  private buildLast7Days(
    habit: Habit,
    completedDates: Set<string>,
    createdDateStr: string | null
  ): DayStatus[] {
    const base = this.todayDate();
    const result: DayStatus[] = [];
    for (let offset = 6; offset >= 0; offset--) {
      const d = new Date(base);
      d.setDate(base.getDate() - offset);
      const dateStr = this.habitService.formatDate(d);
      const isoDay = d.getDay() === 0 ? 7 : d.getDay();
      const isScheduled = habit.frequencyType === 'daily' || habit.targetDays.includes(isoDay);
      const beforeCreation = createdDateStr !== null && dateStr < createdDateStr;

      if (completedDates.has(dateStr)) {
        result.push('done');
      } else if (offset === 0 || !isScheduled || beforeCreation) {
        result.push('neutral');
      } else {
        result.push('missed');
      }
    }
    return result;
  }

  private yesterdayStorageKey(uid: string, dateKey: string): string {
    return `hf_yesterday_dismissed_${uid}_${dateKey}`;
  }

  private loadDismissedYesterday(uid: string, dateKey: string): Set<string> {
    try {
      const raw = localStorage.getItem(this.yesterdayStorageKey(uid, dateKey));
      if (!raw) return new Set();
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? new Set(parsed.map(String)) : new Set();
    } catch {
      return new Set();
    }
  }

  private nowMinutes(): number {
    const p = this.todayParts();
    return p.hours * 60 + p.minutes;
  }

  private toMinutes(timeStr: string): number {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
  }
}
