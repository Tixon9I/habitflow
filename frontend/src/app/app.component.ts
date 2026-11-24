import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AuthService } from './core/services/auth.service';
import { HabitService } from './core/services/habit.service';
import { ConfirmDialogService } from './core/services/confirm-dialog.service';
import { ProfileModalComponent } from './features/profile-modal/profile-modal.component';
import { HabitModalComponent } from './features/habit-modal/habit-modal.component';
import { ConfirmModalComponent } from './shared/confirm-modal/confirm-modal.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ProfileModalComponent,
    HabitModalComponent,
    ConfirmModalComponent,
  ],
  template: `
    @if (showNav()) {
      <header class="topnav">
        <div class="topnav__inner">
          <a class="topnav__logo" routerLink="/">
            <span class="logo-mark" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </span>
            <span class="logo-text">HabitFlow</span>
          </a>

          <nav class="topnav__tabs" aria-label="Основна навігація">
            <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Сьогодні</a>
            <a routerLink="/schedule" routerLinkActive="active">Аналіз розкладу</a>
            <a routerLink="/statistics" routerLinkActive="active">Статистика</a>
          </nav>

          <div class="topnav__actions">
            <button
              type="button"
              class="topnav__demo-btn"
              (click)="onSeedDemo()"
              [disabled]="!auth.isLoggedIn() || seeding()"
            >
              @if (seeding()) {
                Генерація...
              } @else {
                Тестові дані <span class="topnav__demo-muted">(30 дн.)</span>
              }
            </button>

            <button
              type="button"
              class="btn btn--primary topnav__new-btn"
              (click)="showHabitModal.set(true)"
              [disabled]="!auth.isLoggedIn()"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              Нова звичка
            </button>

            <button
              type="button"
              class="topnav__avatar"
              (click)="showProfileModal.set(true)"
              [disabled]="!auth.isLoggedIn()"
              title="Налаштування профілю"
              aria-label="Профіль"
            >
              {{ avatarInitial() }}
            </button>
          </div>
        </div>
      </header>
    }

    <router-outlet />

    @if (showProfileModal()) {
      <app-profile-modal (close)="showProfileModal.set(false)" />
    }

    @if (showHabitModal()) {
      <app-habit-modal (close)="showHabitModal.set(false)" />
    }

    <app-confirm-modal />
  `,
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  readonly auth = inject(AuthService);
  private readonly habitService = inject(HabitService);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly router = inject(Router);

  readonly showNav = signal(true);
  readonly showProfileModal = signal(false);
  readonly showHabitModal = signal(false);
  readonly seeding = signal(false);

  readonly avatarInitial = () => {
    const name = this.auth.currentUser()?.displayName ?? 'U';
    return name.charAt(0).toUpperCase();
  };

  constructor() {
    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe((e: NavigationEnd) => {
        this.showNav.set(!e.url.startsWith('/auth'));
      });
  }

  async onSeedDemo(): Promise<void> {
    const user = this.auth.currentUser();
    if (!user || this.seeding()) return;

    const confirmed = await this.confirmDialog.open({
      eyebrow: 'ТЕСТОВІ ДАНІ',
      title: 'Згенерувати 30-денну історію?',
      message: 'Буде створено 5 звичок та реалістичну історію відміток за останні 30 днів для демонстрації статистики й ML-аналізу.',
      confirmLabel: 'Згенерувати',
      cancelLabel: 'Скасувати',
    });
    if (!confirmed) return;

    this.seeding.set(true);
    try {
      await this.habitService.seedDemoHistory(user.idUser);
    } finally {
      this.seeding.set(false);
    }
  }
}
