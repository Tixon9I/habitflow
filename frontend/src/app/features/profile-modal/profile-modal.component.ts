import { Component, inject, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';
import { getTimeZoneOptions, resolveTimeZone } from '../../core/utils/date-time.util';

@Component({
  selector: 'app-profile-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="modal-overlay" (click)="close.emit()">
      <div class="modal" (click)="$event.stopPropagation()">
        <div class="modal-header">
          <div class="modal-header__titles">
            <span class="eyebrow">ПРОФІЛЬ · НАЛАШТУВАННЯ</span>
            <h2>Налаштування профілю</h2>
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

        @if (confirmDeleteMode()) {
          <div class="delete-confirm-box">
            <div class="delete-confirm-box__title">Видалення облікового запису</div>
            <p class="delete-confirm-box__desc">
              Буде видалено ваш профіль, усі звички, історію відміток та рекомендації. Цю дію неможливо скасувати.
            </p>

            <div class="form-group" style="margin-bottom: 1rem;">
              <label for="deletePassword">Підтвердіть поточний пароль</label>
              <input
                id="deletePassword"
                class="form-control"
                type="password"
                [value]="deletePassword()"
                (input)="deletePassword.set($any($event.target).value)"
                placeholder="Введіть пароль"
                autocomplete="current-password"
              />
            </div>

            <div class="delete-confirm-box__actions">
              <button
                type="button"
                class="btn btn--secondary btn--sm"
                (click)="cancelDeleteMode()"
                [disabled]="loading()"
              >
                Назад
              </button>
              <button
                type="button"
                class="btn btn--danger btn--sm"
                (click)="confirmDeleteAccount()"
                [disabled]="loading() || deletePassword().length < 6"
              >
                {{ loading() ? 'Видалення...' : 'Підтвердити видалення' }}
              </button>
            </div>
          </div>
        } @else {
          <form [formGroup]="form" (ngSubmit)="save()">
            <div class="form-group">
              <label for="profileEmail">Електронна пошта</label>
              <input
                id="profileEmail"
                class="form-control mono"
                type="text"
                [value]="user()?.email ?? ''"
                disabled
              />
            </div>

            <div class="form-group">
              <label for="displayName">Ім'я</label>
              <input
                id="displayName"
                class="form-control"
                type="text"
                formControlName="displayName"
              />
            </div>

            <div class="profile-grid">
              <div class="form-group">
                <label for="timezone">Часовий пояс</label>
                <select id="timezone" class="form-control mono" formControlName="timezone">
                  @for (tz of timezoneOptions; track tz.value) {
                    <option [value]="tz.value">{{ tz.label }}</option>
                  }
                </select>
              </div>

              <div class="form-group">
                <label for="notificationLimit">Ліміт порад / добу</label>
                <input
                  id="notificationLimit"
                  class="form-control mono"
                  type="number"
                  formControlName="notificationLimit"
                  min="1"
                  max="10"
                />
              </div>
            </div>

            <label class="consent-box">
              <input type="checkbox" formControlName="aiConsent" />
              <span class="consent-box__text">
                <strong>Персоналізація ШІ</strong>
                <span>Дозволити формування текстових рекомендацій на основі історії відміток</span>
              </span>
            </label>

            <div class="account-strip">
              <button
                type="button"
                class="btn btn--ghost btn--sm"
                (click)="onLogout()"
                [disabled]="loading()"
              >
                Вийти з акаунта
              </button>
              <button
                type="button"
                class="btn btn--danger-ghost btn--sm"
                (click)="openDeleteMode()"
                [disabled]="loading()"
              >
                Видалити акаунт
              </button>
            </div>

            <hr class="modal-divider" />

            <div class="modal-footer">
              <div class="modal-footer__right">
                <button type="button" class="btn btn--secondary" (click)="close.emit()" [disabled]="loading()">
                  Скасувати
                </button>
                <button
                  type="submit"
                  class="btn btn--primary profile-save-btn"
                  [disabled]="loading() || form.invalid"
                >
                  {{ loading() ? 'Збереження...' : 'Зберегти' }}
                </button>
              </div>
            </div>
          </form>
        }
      </div>
    </div>
  `,
  styles: [`
    .profile-grid {
      display: grid;
      grid-template-columns: 1.4fr 1fr;
      gap: 0.875rem;
    }

    .consent-box {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      padding: 0.875rem 1rem;
      border-radius: var(--radius);
      border: 1px solid var(--border);
      background: var(--surface-subtle);
      cursor: pointer;

      input[type='checkbox'] {
        width: 16px;
        height: 16px;
        margin-top: 2px;
        accent-color: var(--green);
        flex-shrink: 0;
      }

      &__text {
        display: flex;
        flex-direction: column;
        gap: 0.15rem;

        strong {
          font-size: 0.8125rem;
          font-weight: 600;
          color: var(--ink);
        }

        span {
          font-size: 0.75rem;
          color: var(--ink-muted);
          line-height: 1.4;
        }
      }
    }

    .account-strip {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 1rem;
      padding: 0.5rem 0.25rem 0;
    }

    .profile-save-btn {
      min-width: 124px;
    }

    .delete-confirm-box {
      padding: 1.125rem;
      border-radius: var(--radius);
      border: 1px solid var(--red-border);
      background: var(--red-bg);

      &__title {
        font-size: 0.9375rem;
        font-weight: 700;
        color: var(--red);
        margin-bottom: 0.35rem;
      }

      &__desc {
        font-size: 0.8125rem;
        color: var(--ink-secondary);
        line-height: 1.5;
        margin-bottom: 1rem;
      }

      &__actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.625rem;
      }
    }

    @media (max-width: 560px) {
      .profile-grid {
        grid-template-columns: 1fr;
        gap: 0;
      }
    }
  `],
})
export class ProfileModalComponent {
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);

  readonly close = output<void>();
  readonly saved = output<void>();
  readonly user = this.auth.currentUser;
  readonly loading = signal(false);
  readonly errorMsg = signal('');
  readonly confirmDeleteMode = signal(false);
  readonly deletePassword = signal('');

  readonly timezoneOptions = getTimeZoneOptions(this.user()?.timezone);

  readonly form = this.fb.nonNullable.group({
    displayName: [this.user()?.displayName ?? '', [Validators.required, Validators.minLength(2)]],
    timezone: [resolveTimeZone(this.user()?.timezone), [Validators.required]],
    notificationLimit: [
      this.user()?.notificationLimit ?? 3,
      [Validators.required, Validators.min(1), Validators.max(10)],
    ],
    aiConsent: [this.user()?.aiConsent ?? true],
  });

  async save(): Promise<void> {
    if (this.form.invalid) return;
    this.loading.set(true);
    this.errorMsg.set('');

    try {
      await this.auth.updateProfile(this.form.getRawValue());
      this.saved.emit();
      this.close.emit();
    } catch (e: unknown) {
      this.errorMsg.set(e instanceof Error ? e.message : 'Помилка збереження');
    } finally {
      this.loading.set(false);
    }
  }

  async onLogout(): Promise<void> {
    this.loading.set(true);
    try {
      await this.auth.logout();
      this.close.emit();
    } catch (e: unknown) {
      this.errorMsg.set(e instanceof Error ? e.message : 'Помилка виходу');
    } finally {
      this.loading.set(false);
    }
  }

  openDeleteMode(): void {
    this.errorMsg.set('');
    this.deletePassword.set('');
    this.confirmDeleteMode.set(true);
  }

  cancelDeleteMode(): void {
    this.errorMsg.set('');
    this.deletePassword.set('');
    this.confirmDeleteMode.set(false);
  }

  async confirmDeleteAccount(): Promise<void> {
    if (this.deletePassword().length < 6) return;
    this.loading.set(true);
    this.errorMsg.set('');

    try {
      await this.auth.deleteAccount(this.deletePassword());
      this.close.emit();
    } catch (e: unknown) {
      this.errorMsg.set(e instanceof Error ? e.message : 'Помилка видалення акаунта');
    } finally {
      this.loading.set(false);
    }
  }
}
