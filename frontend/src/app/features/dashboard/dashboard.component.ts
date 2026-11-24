import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { of, switchMap } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { HabitService } from '../../core/services/habit.service';
import { MlAnalysisService } from '../../core/services/ml-analysis.service';
import { Habit, HabitLog, Recommendation } from '../../core/models/habit.model';
import { HabitModalComponent } from '../habit-modal/habit-modal.component';

type DayStatus = 'done' | 'missed' | 'neutral';

interface HabitRowVm {
  habit: Habit;
  completedToday: boolean;
  last7Days: DayStatus[];
  riskPercent: number;
  isRisky: boolean;
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
  imports: [CommonModule, RouterModule, HabitModalComponent],
  template: `
    <main class="page">
      <section class="today-header">
        <div class="today-header__left">
          <span class="eyebrow">{{ todayEyebrow }}</span>
          <h1>{{ todayTitle }}</h1>
        </div>

        <div class="today-progress">
          <div class="today-progress__meta">
            <span>
              Виконано <strong>{{ completedCount() }} з {{ totalCount() }}</strong> запланованих на сьогодні
            </span>
            <span class="mono today-progress__pct">{{ completionPercent() }}%</span>
          </div>
          <div class="today-progress__track">
            <div class="today-progress__fill" [style.width.%]="completionPercent()"></div>
          </div>
        </div>
      </section>

      <section class="habits-card">
        <div class="habits-table__head">
          <span>ЗВИЧКА</span>
          <span>ОСТАННІ 7 ДНІВ</span>
          <span>ЧАС · СЕРІЯ</span>
          <span class="col-status">СТАТУС</span>
        </div>

        @if (rows().length === 0) {
          <div class="habits-empty">
            <p>На сьогодні ще немає запланованих звичок.</p>
            <button type="button" class="btn btn--primary btn--sm" (click)="openNewModal()">
              + Додати першу звичку
            </button>
          </div>
        } @else {
          @for (row of rows(); track row.habit.idHabit) {
            <div class="habit-row">
              <div class="habit-row__main">
                <button
                  type="button"
                  class="checkin-box"
                  [class.checkin-box--checked]="row.completedToday"
                  [disabled]="busyHabitId() === row.habit.idHabit"
                  (click)="onToggleCheckIn(row.habit)"
                  [attr.aria-label]="'Відмітити ' + row.habit.title"
                >
                  @if (row.completedToday) {
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  }
                </button>

                <button
                  type="button"
                  class="habit-row__title"
                  (click)="openEditModal(row.habit)"
                >
                  {{ row.habit.title }}
                </button>

                <span class="badge badge--category">{{ row.habit.category }}</span>
              </div>

              <div class="habit-row__dots" aria-label="Останні 7 днів">
                @for (st of row.last7Days; track $index) {
                  <span
                    class="day-dot"
                    [class.day-dot--done]="st === 'done'"
                    [class.day-dot--missed]="st === 'missed'"
                  ></span>
                }
              </div>

              <div class="habit-row__meta">
                <span class="mono habit-row__time">{{ row.habit.reminderTime }}</span>
                <span class="habit-row__sep" aria-hidden="true"></span>
                <span class="habit-row__streak">{{ row.habit.currentStreak }} дн.</span>
              </div>

              <div class="habit-row__status">
                @if (row.isRisky) {
                  <span class="badge badge--risk">Ризик пропуску: {{ row.riskPercent }}%</span>
                } @else {
                  <span class="badge badge--stable">Стабільно ({{ row.riskPercent }}%)</span>
                }
              </div>
            </div>
          }
        }

        @if (riskyCount() > 0) {
          <a class="habits-banner" routerLink="/schedule">
            <span class="habits-banner__icon" aria-hidden="true">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="9"></circle>
                <polyline points="12 7 12 12 15 15"></polyline>
              </svg>
            </span>
            <span class="habits-banner__text">
              Помічено зсув графіка для {{ riskyCount() }} {{ riskyHabitsWord() }}.
              <strong>Переглянути пропозиції корекції часу</strong>
            </span>
            <svg class="habits-banner__arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </a>
        }
      </section>

      <footer class="today-footer">
        <span class="eyebrow">ДАНІ СИНХРОНІЗОВАНО</span>
        <span class="eyebrow">{{ nextReminderLabel() }}</span>
      </footer>
    </main>

    @if (modalOpen()) {
      <app-habit-modal [habit]="editingHabit()" (close)="closeModal()" />
    }
  `,
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent {
  private readonly auth = inject(AuthService);
  private readonly habitService = inject(HabitService);
  private readonly mlService = inject(MlAnalysisService);

  readonly today = new Date();
  readonly todayStr = this.habitService.formatDate(this.today);
  readonly todayIsoWeekday = this.today.getDay() === 0 ? 7 : this.today.getDay();

  readonly todayEyebrow = `${UK_WEEKDAYS[this.today.getDay()].toUpperCase()} · ${String(
    this.today.getDate()
  ).padStart(2, '0')} ${UK_MONTHS_GENITIVE[this.today.getMonth()].toUpperCase()}`;

  readonly todayTitle = `${UK_WEEKDAYS[this.today.getDay()]}, ${this.today.getDate()} ${
    UK_MONTHS_GENITIVE[this.today.getMonth()]
  }`;

  readonly busyHabitId = signal<string | null>(null);
  readonly modalOpen = signal(false);
  readonly editingHabit = signal<Habit | null>(null);

  private readonly user$ = toObservable(this.auth.currentUser);

  readonly habits = toSignal(
    this.user$.pipe(switchMap((u) => (u ? this.habitService.getHabits(u.idUser) : of([])))),
    { initialValue: [] as Habit[] }
  );

  readonly logs = toSignal(
    this.user$.pipe(switchMap((u) => (u ? this.habitService.getLogsByUser(u.idUser) : of([])))),
    { initialValue: [] as HabitLog[] }
  );

  readonly recommendations = toSignal(
    this.user$.pipe(switchMap((u) => (u ? this.mlService.getRecommendations(u.idUser) : of([])))),
    { initialValue: [] as Recommendation[] }
  );

  readonly todayHabits = computed(() =>
    this.habits()
      .filter((h) => h.frequencyType === 'daily' || h.targetDays.includes(this.todayIsoWeekday))
      .sort((a, b) => a.reminderTime.localeCompare(b.reminderTime))
  );

  readonly pendingRecByHabit = computed(() => {
    const map = new Map<string, Recommendation>();
    for (const rec of this.recommendations()) {
      if (rec.status === 'pending' && !map.has(rec.idHabit)) {
        map.set(rec.idHabit, rec);
      }
    }
    return map;
  });

  readonly rows = computed<HabitRowVm[]>(() => {
    const allLogs = this.logs();
    const pendingMap = this.pendingRecByHabit();

    return this.todayHabits().map((habit) => {
      const habitLogs = allLogs.filter((l) => l.idHabit === habit.idHabit);
      const completedDates = new Set(habitLogs.map((l) => l.targetDate));
      const completedToday = completedDates.has(this.todayStr);
      const last7Days = this.buildLast7Days(habit, completedDates);

      const pendingRec = pendingMap.get(habit.idHabit);
      const riskScore = pendingRec
        ? pendingRec.riskScore
        : this.mlService.runLocalFallback(habit, habitLogs).riskScore;
      const riskPercent = Math.round(riskScore * 100);

      return {
        habit,
        completedToday,
        last7Days,
        riskPercent,
        isRisky: Boolean(pendingRec) || riskScore >= 0.4,
      };
    });
  });

  readonly totalCount = computed(() => this.rows().length);
  readonly completedCount = computed(() => this.rows().filter((r) => r.completedToday).length);
  readonly completionPercent = computed(() => {
    const total = this.totalCount();
    return total === 0 ? 0 : Math.round((this.completedCount() / total) * 100);
  });

  readonly riskyCount = computed(() => {
    const pendingCount = this.pendingRecByHabit().size;
    if (pendingCount > 0) return pendingCount;
    return this.rows().filter((r) => r.riskPercent >= 60).length;
  });

  readonly riskyHabitsWord = computed(() => {
    const n = this.riskyCount();
    if (n === 1) return 'звички';
    return 'звичок';
  });

  readonly nextReminderLabel = computed(() => {
    const pending = this.rows()
      .filter((r) => !r.completedToday)
      .map((r) => r.habit.reminderTime)
      .sort();
    if (pending.length === 0) {
      return this.totalCount() > 0 ? 'УСІ ЗВИЧКИ ВИКОНАНО' : 'НЕМАЄ ЗАПЛАНОВАНИХ НАГАДУВАНЬ';
    }
    return `НАСТУПНЕ НАГАДУВАННЯ · ${pending[0]}`;
  });

  async onToggleCheckIn(habit: Habit): Promise<void> {
    this.busyHabitId.set(habit.idHabit);
    try {
      await this.habitService.toggleCheckIn(habit, this.today);
    } finally {
      this.busyHabitId.set(null);
    }
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

  private buildLast7Days(habit: Habit, completedDates: Set<string>): DayStatus[] {
    const result: DayStatus[] = [];
    for (let offset = 6; offset >= 0; offset--) {
      const d = new Date(this.today);
      d.setDate(this.today.getDate() - offset);
      const dateStr = this.habitService.formatDate(d);
      const isoDay = d.getDay() === 0 ? 7 : d.getDay();
      const isScheduled = habit.frequencyType === 'daily' || habit.targetDays.includes(isoDay);

      if (completedDates.has(dateStr)) {
        result.push('done');
      } else if (offset === 0 || !isScheduled) {
        result.push('neutral');
      } else {
        result.push('missed');
      }
    }
    return result;
  }
}
