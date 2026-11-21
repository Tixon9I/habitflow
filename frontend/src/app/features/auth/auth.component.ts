import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, AbstractControl } from '@angular/forms';
import { inject } from '@angular/core';
import { AuthService } from '../../core/services/auth.service';

type AuthMode = 'login' | 'register';

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="auth-wrap">
      <div class="auth-card card">
        <!-- Logo -->
        <div class="auth-logo">
          <span class="logo-mark">HF</span>
          <span class="logo-text">HabitFlow</span>
        </div>

        <h2 class="auth-title">
          {{ mode() === 'register' ? 'Створити акаунт' : 'Увійти' }}
        </h2>

        <!-- Error banner -->
        @if (errorMsg()) {
          <div class="auth-error">{{ errorMsg() }}</div>
        }

        <form [formGroup]="form" (ngSubmit)="submit()">
          <!-- Name (register only) -->
          @if (mode() === 'register') {
            <div class="form-group">
              <label for="displayName">Ім'я</label>
              <input id="displayName" class="form-control"
                     type="text" formControlName="displayName"
                     placeholder="Ваше ім'я" autocomplete="name">
              @if (showErr('displayName')) {
                <span class="error-msg">Введіть ім'я (мін. 2 символи)</span>
              }
            </div>
          }

          <!-- Email -->
          <div class="form-group">
            <label for="email">Email</label>
            <input id="email" class="form-control"
                   type="email" formControlName="email"
                   placeholder="you@example.com" autocomplete="email">
            @if (showErr('email')) {
              <span class="error-msg">Введіть коректний email</span>
            }
          </div>

          <!-- Password -->
          <div class="form-group">
            <label for="password">Пароль</label>
            <input id="password" class="form-control"
                   type="password" formControlName="password"
                   placeholder="Мін. 6 символів" autocomplete="current-password">
            @if (showErr('password')) {
              <span class="error-msg">Мінімум 6 символів</span>
            }
          </div>

          <!-- AI Consent (register only) -->
          @if (mode() === 'register') {
            <div class="form-group consent-group">
              <label class="checkbox-label">
                <input type="checkbox" formControlName="aiConsent">
                <span>Я погоджуюсь на обробку даних ШІ для персональних рекомендацій</span>
              </label>
            </div>
          }

          <button type="submit"
                  class="btn btn--primary btn--lg auth-submit"
                  [disabled]="loading()">
            {{ loading() ? 'Завантаження…' : (mode() === 'register' ? 'Зареєструватись' : 'Увійти') }}
          </button>
        </form>

        <p class="auth-toggle">
          {{ mode() === 'login' ? 'Немає акаунта?' : 'Вже є акаунт?' }}
          <button class="link-btn" type="button" (click)="toggleMode()">
            {{ mode() === 'login' ? 'Зареєструватись' : 'Увійти' }}
          </button>
        </p>
      </div>
    </div>
  `,
  styleUrls: ['./auth.component.scss'],
})
export class AuthComponent {
  private readonly authSvc = inject(AuthService);
  private readonly fb      = inject(FormBuilder);

  readonly mode    = signal<AuthMode>('login');
  readonly loading = signal(false);
  readonly errorMsg = signal('');

  readonly form = this.fb.nonNullable.group({
    displayName: ['', [Validators.minLength(2)]],
    email:       ['', [Validators.required, Validators.email]],
    password:    ['', [Validators.required, Validators.minLength(6)]],
    aiConsent:   [false],
  });

  toggleMode(): void {
    this.mode.update(m => m === 'login' ? 'register' : 'login');
    this.errorMsg.set('');
    this.form.reset();
  }

  showErr(field: string): boolean {
    const ctrl = this.form.get(field) as AbstractControl;
    return ctrl.invalid && (ctrl.dirty || ctrl.touched);
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    this.errorMsg.set('');
    const { email, password, displayName, aiConsent } = this.form.getRawValue();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    try {
      if (this.mode() === 'register') {
        await this.authSvc.register(email, password, displayName, tz);
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
