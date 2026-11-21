import { Component, inject, input, output, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { HabitService } from '../../core/services/habit.service';
import { AuthService } from '../../core/services/auth.service';
import { Habit, FrequencyType } from '../../core/models/habit.model';

@Component({
  selector: 'app-habit-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="modal-overlay" (click)="close.emit()">
      <div class="modal" (click)="$event.stopPropagation()">
        <div class="modal-header">
          <h2>{{ habit() ? 'Редагувати звичку' : 'Нова звичка' }}</h2>
          <button class="btn btn--ghost btn--sm" type="button" (click)="close.emit()">✕</button>
        </div>

        @if (errorMsg()) {
          <div class="error-msg" style="margin-bottom: 1rem;">{{ errorMsg() }}</div>
        }

        <form [formGroup]="form" (ngSubmit)="save()">
          <div class="form-group">
            <label for="title">Назва звички</label>
            <input id="title" class="form-control" type="text" formControlName="title" placeholder="напр. Ранкова руханка" />
          </div>

          <div class="form-group">
            <label for="category">Категорія</label>
            <select id="category" class="form-control" formControlName="category">
              <option value="Здоров'я">Здоров'я</option>
              <option value="Спорт">Спорт</option>
              <option value="Навчання">Навчання</option>
              <option value="Продуктивність">Продуктивність</option>
              <option value="Інше">Інше</option>
            </select>
          </div>

          <div class="form-group">
            <label>Частота виконання</label>
            <div style="display: flex; gap: 1rem; margin-top: 0.25rem;">
              <label style="display: flex; align-items: center; gap: 0.35rem; cursor: pointer; text-transform: none;">
                <input type="radio" value="daily" formControlName="frequencyType" (change)="onFrequencyChange('daily')" />
                Щодня
              </label>
              <label style="display: flex; align-items: center; gap: 0.35rem; cursor: pointer; text-transform: none;">
                <input type="radio" value="custom" formControlName="frequencyType" (change)="onFrequencyChange('custom')" />
                Обрані дні
              </label>
            </div>
          </div>

          @if (form.get('frequencyType')?.value === 'custom') {
            <div class="form-group">
              <label>Дні тижня</label>
              <div style="display: flex; gap: 0.4rem; flex-wrap: wrap; margin-top: 0.3rem;">
                @for (d of weekdays; track d.day) {
                  <button
                    type="button"
                    class="btn btn--sm"
                    [class.btn--primary]="isDaySelected(d.day)"
                    [class.btn--ghost]="!isDaySelected(d.day)"
                    (click)="toggleDay(d.day)"
                  >
                    {{ d.label }}
                  </button>
                }
              </div>
            </div>
          }

          <div class="form-group">
            <label for="reminderTime">Час нагадування (HH:mm)</label>
            <input id="reminderTime" class="form-control" type="time" formControlName="reminderTime" />
          </div>

          <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              @if (habit()) {
                <button type="button" class="btn btn--danger btn--sm" (click)="onDelete()" [disabled]="loading()">
                  Видалити
                </button>
              }
            </div>

            <div style="display: flex; gap: 0.5rem;">
              <button type="button" class="btn btn--ghost btn--sm" (click)="close.emit()">Скасувати</button>
              <button type="submit" class="btn btn--primary btn--sm" [disabled]="loading() || form.invalid">
                {{ loading() ? 'Збереження...' : 'Зберегти' }}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  `,
})
export class HabitModalComponent implements OnInit {
  private readonly habitService = inject(HabitService);
  private readonly authService = inject(AuthService);
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
    category: ["Здоров'я", [Validators.required]],
    frequencyType: ['daily' as FrequencyType, [Validators.required]],
    reminderTime: ['08:00', [Validators.required, Validators.pattern(/^([01]\d|2[0-3]):[0-5]\d$/)]],
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

  onFrequencyChange(type: FrequencyType): void {
    if (type === 'daily') {
      this.selectedDays.set([1, 2, 3, 4, 5, 6, 7]);
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
      this.selectedDays.set([...current, day].sort());
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
        if (existing.reminderTime !== formVal.reminderTime || JSON.stringify(existing.targetDays) !== JSON.stringify(days)) {
          await this.habitService.updateHabitSchedule(existing, formVal.reminderTime, days);
        }
      } else {
        await this.habitService.createHabit({
          idUser: user.idUser,
          title: formVal.title,
          category: formVal.category,
          frequencyType: formVal.frequencyType,
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

  async onDelete(): Promise<void> {
    const existing = this.habit();
    if (!existing) return;

    const confirmed = window.confirm(`Видалити звичку "${existing.title}"?`);
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
