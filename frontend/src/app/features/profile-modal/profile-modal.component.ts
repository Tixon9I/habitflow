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

        <form [formGroup]="form" (ngSubmit)="save()">
          <div class="form-group">
            <label for="profileEmail">Email</label>
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
              <input
                id="timezone"
                class="form-control mono"
                type="text"
                formControlName="timezone"
              />
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
              <span>Дозволити формування текстових рекомендацій на основі історії чекінів</span>
            </span>
          </label>

          <hr class="modal-divider" />

          <div class="modal-footer">
            <div class="profile-actions-left">
              <button
                type="button"
                class="btn btn--ghost btn--sm"
                (click)="onLogout()"
                [disabled]="loading()"
              >
                Вийти
              </button>
              <button
                type="button"
                class="btn btn--danger-ghost btn--sm"
                (click)="onDeleteAccount()"
                [disabled]="loading()"
              >
                Видалити акаунт
              </button>
            </div>

            <div class="modal-footer__right">
              <button type="button" class="btn btn--secondary" (click)="close.emit()">
                Скасувати
              </button>
              <button
                type="submit"
                class="btn btn--primary"
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

    .profile-actions-left {
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }

    @media (max-width: 560px) {
      .profile-grid {
        grid-template-columns: 1fr;
        gap: 0;
      }

      .modal-footer {
        flex-direction: column-reverse;
        align-items: stretch;
      }

      .profile-actions-left,
      .modal-footer__right {
        justify-content: flex-end;
      }
    }
  `],
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
