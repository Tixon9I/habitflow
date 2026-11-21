import { Component, inject, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-profile-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="modal-overlay" (click)="close.emit()">
      <div class="modal" (click)="$event.stopPropagation()">
        <div class="modal-header">
          <h2>Налаштування профілю</h2>
          <button class="btn btn--ghost btn--sm" type="button" (click)="close.emit()">✕</button>
        </div>

        @if (errorMsg()) {
          <div class="error-msg" style="margin-bottom: 1rem;">{{ errorMsg() }}</div>
        }

        <form [formGroup]="form" (ngSubmit)="save()">
          <div class="form-group">
            <label>Email</label>
            <input class="form-control" type="text" [value]="user()?.email" disabled />
          </div>

          <div class="form-group">
            <label for="displayName">Ім'я</label>
            <input id="displayName" class="form-control" type="text" formControlName="displayName" />
          </div>

          <div class="form-group">
            <label for="timezone">Часовий пояс</label>
            <input id="timezone" class="form-control" type="text" formControlName="timezone" />
          </div>

          <div class="form-group">
            <label for="notificationLimit">Ліміт порад на добу (1-10)</label>
            <input id="notificationLimit" class="form-control" type="number" formControlName="notificationLimit" min="1" max="10" />
          </div>

          <div class="form-group">
            <label class="checkbox-label" style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
              <input type="checkbox" formControlName="aiConsent" />
              <span>Дозвіл на генерацію порад ШІ</span>
            </label>
          </div>

          <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center;">
            <button type="button" class="btn btn--danger btn--sm" (click)="onDeleteAccount()" [disabled]="loading()">
              Видалити акаунт
            </button>
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
export class ProfileModalComponent {
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);

  readonly close = output<void>();
  readonly user = this.auth.currentUser;
  readonly loading = signal(false);
  readonly errorMsg = signal('');

  readonly form = this.fb.nonNullable.group({
    displayName: [this.user()?.displayName ?? '', [Validators.required, Validators.minLength(2)]],
    timezone: [this.user()?.timezone ?? 'UTC', [Validators.required]],
    notificationLimit: [this.user()?.notificationLimit ?? 3, [Validators.required, Validators.min(1), Validators.max(10)]],
    aiConsent: [this.user()?.aiConsent ?? true],
  });

  async save(): Promise<void> {
    if (this.form.invalid) return;
    this.loading.set(true);
    this.errorMsg.set('');

    try {
      await this.auth.updateProfile(this.form.getRawValue());
      this.close.emit();
    } catch (e: unknown) {
      this.errorMsg.set(e instanceof Error ? e.message : 'Помилка збереження');
    } finally {
      this.loading.set(false);
    }
  }

  async onDeleteAccount(): Promise<void> {
    const confirmed = window.confirm(
      'Ви впевнені, що хочете видалити свій акаунт? Цю дію неможливо скасувати.'
    );
    if (!confirmed) return;

    this.loading.set(true);
    this.errorMsg.set('');

    try {
      await this.auth.deleteAccount();
      this.close.emit();
    } catch (e: unknown) {
      this.errorMsg.set(e instanceof Error ? e.message : 'Помилка видалення акаунта');
    } finally {
      this.loading.set(false);
    }
  }
}
