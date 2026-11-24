import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, AbstractControl } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';

type AuthMode = 'login' | 'register';

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="auth-wrap">
      <div class="auth-card card">
        <div class="auth-brand">
          <span class="logo-mark" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </span>
          <span class="logo-text">HabitFlow</span>
        </div>

        <div class="auth-header">
          <span class="eyebrow">{{ mode() === 'register' ? 'ОБЛІКОВИЙ ЗАПИС · РЕЄСТРАЦІЯ' : 'ОБЛІКОВИЙ ЗАПИС · ВХІД' }}</span>
          <h2 class="auth-title">
            {{ mode() === 'register' ? 'Створити акаунт' : 'Увійти в HabitFlow' }}
          </h2>
        </div>

        <div class="segmented auth-switcher">
          <button
            type="button"
            class="segmented__btn"
            [class.active]="mode() === 'login'"
            (click)="setMode('login')"
          >
            Вхід
          </button>
          <button
            type="button"
            class="segmented__btn"
            [class.active]="mode() === 'register'"
            (click)="setMode('register')"
          >
            Реєстрація
          </button>
        </div>

        @if (errorMsg()) {
          <div class="error-banner">{{ errorMsg() }}</div>
        }

        @if (successMsg()) {
          <div class="success-banner">{{ successMsg() }}</div>
        }

        <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
          @if (mode() === 'register') {
            <div class="form-group">
              <label for="displayName">Ім'я</label>
              <input
                id="displayName"
                class="form-control"
                type="text"
                formControlName="displayName"
                placeholder="Ваше ім'я"
                autocomplete="name"
              />
              @if (showErr('displayName')) {
                <span class="error-msg">Введіть ім'я (мін. 2 символи)</span>
              }
            </div>
          }

          <div class="form-group">
            <label for="email">Електронна пошта</label>
            <input
              id="email"
              class="form-control"
              type="email"
              formControlName="email"
              placeholder="you@example.com"
              autocomplete="email"
            />
            @if (showErr('email')) {
              <span class="error-msg">Введіть коректну електронну пошту</span>
            }
          </div>

          <div class="form-group">
            <div class="password-label-row">
              <label for="password">Пароль</label>
              @if (mode() === 'login') {
                <button
                  type="button"
                  class="forgot-link"
                  [disabled]="loading()"
                  (click)="onForgotPassword()"
                >
                  Забули пароль?
                </button>
              }
            </div>
            <input
              id="password"
              class="form-control"
              type="password"
              formControlName="password"
              [placeholder]="mode() === 'register' ? 'Створіть пароль' : 'Введіть пароль'"
              autocomplete="current-password"
            />
            @if (showErr('password')) {
              <span class="error-msg">
                {{ mode() === 'register' ? 'Пароль має містити щонайменше 6 символів' : 'Введіть пароль' }}
              </span>
            }
          </div>

          @if (mode() === 'register') {
            <div class="form-group">
              <label class="auth-consent">
                <input type="checkbox" formControlName="aiConsent" />
                <span>Погоджуюсь на обробку історії звичок ШІ для персональних рекомендацій розкладу</span>
              </label>
              @if (showErr('aiConsent')) {
                <span class="error-msg">Підтвердіть згоду на обробку даних для створення акаунта</span>
              }
            </div>
          }

          <button
            type="submit"
            class="btn btn--primary btn--lg auth-submit"
            [disabled]="loading()"
          >
            {{ loading() ? 'Завантаження...' : (mode() === 'register' ? 'Створити акаунт' : 'Увійти') }}
          </button>
        </form>
      </div>
    </div>
  `,
  styleUrls: ['./auth.component.scss'],
})
export class AuthComponent {
  private readonly authSvc = inject(AuthService);
  private readonly fb = inject(FormBuilder);

  readonly mode = signal<AuthMode>('login');
  readonly loading = signal(false);
  readonly submitted = signal(false);
  readonly errorMsg = signal('');
  readonly successMsg = signal('');

  readonly form = this.fb.nonNullable.group({
    displayName: [''],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
    aiConsent: [true],
  });

  setMode(target: AuthMode): void {
    if (this.mode() === target) return;
    this.mode.set(target);
    this.submitted.set(false);
    this.errorMsg.set('');
    this.successMsg.set('');

    const nameCtrl = this.form.controls.displayName;
    const passCtrl = this.form.controls.password;
    const consentCtrl = this.form.controls.aiConsent;

    if (target === 'register') {
      nameCtrl.setValidators([Validators.required, Validators.minLength(2)]);
      passCtrl.setValidators([Validators.required, Validators.minLength(6)]);
      consentCtrl.setValidators([Validators.requiredTrue]);
    } else {
      nameCtrl.clearValidators();
      passCtrl.setValidators([Validators.required]);
      consentCtrl.clearValidators();
    }
    nameCtrl.updateValueAndValidity();
    passCtrl.updateValueAndValidity();
    consentCtrl.updateValueAndValidity();

    this.form.reset({ displayName: '', email: '', password: '', aiConsent: true });
  }

  showErr(field: string): boolean {
    if (!this.submitted()) return false;
    const ctrl = this.form.get(field) as AbstractControl;
    return ctrl.invalid;
  }

  async onForgotPassword(): Promise<void> {
    this.errorMsg.set('');
    this.successMsg.set('');
    const email = this.form.controls.email.value.trim();

    if (!email || this.form.controls.email.invalid) {
      this.errorMsg.set('Спочатку введіть вашу електронну пошту в поле вище.');
      return;
    }

    this.loading.set(true);
    try {
      await this.authSvc.resetPassword(email);
      this.successMsg.set(`Інструкцію для скидання пароля надіслано на ${email}.`);
    } catch (err: unknown) {
      this.errorMsg.set(err instanceof Error ? err.message : 'Не вдалося надіслати лист');
    } finally {
      this.loading.set(false);
    }
  }

  async submit(): Promise<void> {
    this.submitted.set(true);
    this.successMsg.set('');
    if (this.form.invalid) {
      return;
    }

    this.loading.set(true);
    this.errorMsg.set('');
    const { email, password, displayName, aiConsent } = this.form.getRawValue();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    try {
      if (this.mode() === 'register') {
        await this.authSvc.register(email, password, displayName, tz, aiConsent);
      } else {
        await this.authSvc.login(email, password);
      }
    } catch (err: unknown) {
      this.errorMsg.set(err instanceof Error ? err.message : 'Невідома помилка');
    } finally {
      this.loading.set(false);
    }
  }
}
