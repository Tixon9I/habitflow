import { Component, inject, input, output, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { HabitService } from '../../core/services/habit.service';
import { AuthService } from '../../core/services/auth.service';
import { ConfirmDialogService } from '../../core/services/confirm-dialog.service';
import { Habit, FrequencyType } from '../../core/models/habit.model';

@Component({
  selector: 'app-habit-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="modal-overlay" (click)="close.emit()">
      <div class="modal" (click)="$event.stopPropagation()">
        <div class="modal-header">
          <div class="modal-header__titles">
            <span class="eyebrow">ЗВИЧКА · НАЛАШТУВАННЯ</span>
            <h2>{{ habit() ? 'Налаштування звички' : 'Нова звичка' }}</h2>
          </div>
          <button
            class="icon-close-btn"
            type="button"
            (click)="close.emit()"
            aria-label="Закрити"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        @if (errorMsg()) {
          <div class="error-banner">{{ errorMsg() }}</div>
        }

        <form [formGroup]="form" (ngSubmit)="save()">
          <div class="form-group">
            <label for="title">Назва</label>
            <input
              id="title"
              class="form-control"
              type="text"
              formControlName="title"
              placeholder="Читання фахової літератури"
            />
          </div>

          <div class="form-group">
            <label for="category">Категорія</label>
            <select id="category" class="form-control" formControlName="category">
              <option value="Навчання">Навчання</option>
              <option value="Здоров'я">Здоров'я</option>
              <option value="Спорт">Спорт</option>
              <option value="Продуктивність">Продуктивність</option>
              <option value="Інше">Інше</option>
            </select>
          </div>

          <div class="form-group">
            <label>Періодичність</label>
            <div class="segmented">
              <button
                type="button"
                class="segmented__btn"
                [class.active]="form.get('frequencyType')?.value === 'daily'"
                (click)="setFrequency('daily')"
              >
                Щодня
              </button>
              <button
                type="button"
                class="segmented__btn"
                [class.active]="form.get('frequencyType')?.value === 'custom'"
                (click)="setFrequency('custom')"
              >
                Вибрані дні
              </button>
            </div>
          </div>

          @if (form.get('frequencyType')?.value === 'custom') {
            <div class="days-row">
              @for (d of weekdays; track d.day) {
                <button
                  type="button"
                  class="day-chip"
                  [class.day-chip--active]="isDaySelected(d.day)"
                  (click)="toggleDay(d.day)"
                >
                  {{ d.label }}
                </button>
              }
            </div>
          }

          <div class="form-group">
            <label for="reminderTime">Час нагадування</label>
            <input
              id="reminderTime"
              class="form-control mono"
              type="time"
              formControlName="reminderTime"
            />
          </div>

          @if (habit()) {
            <div class="habit-actions-strip">
              <button
                type="button"
                class="btn btn--ghost btn--sm"
                (click)="onArchive()"
                [disabled]="loading()"
              >
                Архівувати звичку
              </button>
              <button
                type="button"
                class="btn btn--danger-ghost btn--sm"
                (click)="onDelete()"
                [disabled]="loading()"
              >
                Видалити звичку
              </button>
            </div>
          }

          <hr class="modal-divider" />

          <div class="modal-footer">
            <div class="modal-footer__right">
              <button type="button" class="btn btn--secondary" (click)="close.emit()" [disabled]="loading()">
                Скасувати
              </button>
              <button
                type="submit"
                class="btn btn--primary habit-save-btn"
                [disabled]="loading() || form.invalid"
              >
                {{ loading() ? 'Збереження...' : 'Зберегти' }}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  `,
  styles: [`
    .days-row {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 0.5rem;
      margin-bottom: 1.25rem;
    }

    .day-chip {
      height: 44px;
      border-radius: 9px;
      border: 1px solid var(--border);
      background: var(--surface-subtle);
      color: var(--ink-muted);
      font-family: var(--font-sans);
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;

      &:hover:not(.day-chip--active) {
        border-color: #D4D4D0;
        color: var(--ink);
      }

      &--active {
        background: var(--ink);
        border-color: var(--ink);
        color: #FFFFFF;
        font-weight: 600;
      }
    }

    .habit-actions-strip {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 0.5rem;
    }

    .habit-save-btn {
      min-width: 124px;
    }
  `],
})
export class HabitModalComponent implements OnInit {
  private readonly habitService = inject(HabitService);
  private readonly authService = inject(AuthService);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly fb = inject(FormBuilder);

  readonly habit = input<Habit | null>(null);
  readonly close = output<void>();

  readonly loading = signal(false);
  readonly errorMsg = signal('');
  readonly selectedDays = signal<number[]>([1, 2, 3, 4, 5, 6, 7]);

  readonly weekdays = [
    { day: 1, label: 'Пн' },
    { day: 2, label: 'Вт' },
    { day: 3, label: 'Ср' },
    { day: 4, label: 'Чт' },
    { day: 5, label: 'Пт' },
    { day: 6, label: 'Сб' },
    { day: 7, label: 'Нд' },
  ];

  readonly form = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.minLength(2)]],
    category: ['Навчання', [Validators.required]],
    frequencyType: ['daily' as FrequencyType, [Validators.required]],
    reminderTime: ['20:00', [Validators.required, Validators.pattern(/^([01]\d|2[0-3]):[0-5]\d$/)]],
  });

  ngOnInit(): void {
    const current = this.habit();
    if (current) {
      this.form.patchValue({
        title: current.title,
        category: current.category,
        frequencyType: current.frequencyType,
        reminderTime: current.reminderTime,
      });
      this.selectedDays.set(current.targetDays ?? [1, 2, 3, 4, 5, 6, 7]);
    }
  }

  setFrequency(type: FrequencyType): void {
    this.form.controls.frequencyType.setValue(type);
    if (type === 'daily') {
      this.selectedDays.set([1, 2, 3, 4, 5, 6, 7]);
    } else if (this.selectedDays().length === 7) {
      this.selectedDays.set([1, 2, 3, 4, 5]);
    }
  }

  isDaySelected(day: number): boolean {
    return this.selectedDays().includes(day);
  }

  toggleDay(day: number): void {
    const current = this.selectedDays();
    if (current.includes(day)) {
      if (current.length > 1) {
        this.selectedDays.set(current.filter((d) => d !== day));
      }
    } else {
      this.selectedDays.set([...current, day].sort((a, b) => a - b));
    }
  }

  async save(): Promise<void> {
    if (this.form.invalid) return;
    const user = this.authService.currentUser();
    if (!user) return;

    this.loading.set(true);
    this.errorMsg.set('');

    const formVal = this.form.getRawValue();
    const days = formVal.frequencyType === 'daily' ? [1, 2, 3, 4, 5, 6, 7] : this.selectedDays();

    try {
      const existing = this.habit();
      if (existing) {
        const nextTitle = formVal.title.trim();
        if (existing.title !== nextTitle || existing.category !== formVal.category) {
          await this.habitService.updateHabitDetails(existing.idHabit, {
            title: nextTitle,
            category: formVal.category,
          });
        }

        const scheduleChanged =
          existing.reminderTime !== formVal.reminderTime ||
          existing.frequencyType !== (days.length === 7 ? 'daily' : 'custom') ||
          JSON.stringify([...existing.targetDays].sort((a, b) => a - b)) !==
            JSON.stringify([...days].sort((a, b) => a - b));

        if (scheduleChanged) {
          await this.habitService.updateHabitSchedule(existing, formVal.reminderTime, days);
        }
      } else {
        await this.habitService.createHabit({
          idUser: user.idUser,
          title: formVal.title.trim(),
          category: formVal.category,
          frequencyType: days.length === 7 ? 'daily' : 'custom',
          targetDays: days,
          reminderTime: formVal.reminderTime,
          scheduleHistory: [],
          isActive: true,
        });
      }
      this.close.emit();
    } catch (e: unknown) {
      this.errorMsg.set(e instanceof Error ? e.message : 'Помилка збереження');
    } finally {
      this.loading.set(false);
    }
  }

  async onArchive(): Promise<void> {
    const existing = this.habit();
    if (!existing) return;

    this.loading.set(true);
    try {
      await this.habitService.archiveHabit(existing.idHabit);
      this.close.emit();
    } catch (e: unknown) {
      this.errorMsg.set(e instanceof Error ? e.message : 'Помилка архівації');
    } finally {
      this.loading.set(false);
    }
  }

  async onDelete(): Promise<void> {
    const existing = this.habit();
    if (!existing) return;

    const confirmed = await this.confirmDialog.open({
      eyebrow: 'ЗВИЧКА · ВИДАЛЕННЯ',
      title: 'Видалити звичку?',
      message: `Звичку «${existing.title}» буде видалено назавжди. Цю дію неможливо скасувати.`,
      confirmLabel: 'Видалити',
      cancelLabel: 'Скасувати',
      danger: true,
    });
    if (!confirmed) return;

    this.loading.set(true);
    try {
      await this.habitService.deleteHabit(existing.idHabit);
      this.close.emit();
    } catch (e: unknown) {
      this.errorMsg.set(e instanceof Error ? e.message : 'Помилка видалення');
    } finally {
      this.loading.set(false);
    }
  }
}
