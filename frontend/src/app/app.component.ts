import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs/operators';
import { AuthService } from './core/services/auth.service';
import { HabitService } from './core/services/habit.service';
import { MlAnalysisService } from './core/services/ml-analysis.service';
import { ConfirmDialogService } from './core/services/confirm-dialog.service';
import { ThemeService } from './core/services/theme.service';
import { ProfileModalComponent } from './features/profile-modal/profile-modal.component';
import { HabitModalComponent } from './features/habit-modal/habit-modal.component';
import { ConfirmModalComponent } from './shared/confirm-modal/confirm-modal.component';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
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
              class="topnav__theme-btn"
              (click)="themeService.toggle()"
              [title]="themeService.theme() === 'dark' ? 'Світла тема' : 'Темна тема'"
              aria-label="Перемкнути тему"
            >
              @if (themeService.theme() === 'dark') {
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="4"></circle>
                  <path d="M12 2v2"></path>
                  <path d="M12 20v2"></path>
                  <path d="m4.93 4.93 1.41 1.41"></path>
                  <path d="m17.66 17.66 1.41 1.41"></path>
                  <path d="M2 12h2"></path>
                  <path d="M20 12h2"></path>
                  <path d="m6.34 17.66-1.41 1.41"></path>
                  <path d="m19.07 4.93-1.41 1.41"></path>
                </svg>
              } @else {
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path>
                </svg>
              }
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

    @if (toastMessage()) {
      <div class="app-toast" role="status" aria-live="polite">
        {{ toastMessage() }}
      </div>
    }

    <router-outlet />

    @if (showProfileModal()) {
      <app-profile-modal
        (close)="showProfileModal.set(false)"
        (saved)="onProfileSaved()"
      />
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
  readonly themeService = inject(ThemeService);
  private readonly habitService = inject(HabitService);
  private readonly mlService = inject(MlAnalysisService);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly router = inject(Router);

  readonly showNav = signal(true);
  readonly showProfileModal = signal(false);
  readonly showHabitModal = signal(false);
  readonly seeding = signal(false);
  readonly toastMessage = signal('');
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  readonly avatarInitial = computed(() => {
    const name = this.auth.currentUser()?.displayName ?? 'U';
    return name.charAt(0).toUpperCase();
  });

  constructor() {
    effect(() => {
      if (!this.auth.currentUser()) {
        this.habitService.clearCache();
        this.mlService.clearCache();
      }
    });

    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed()
      )
      .subscribe((e) => {
        const activeUrl = e.urlAfterRedirects || e.url;
        this.showNav.set(!activeUrl.startsWith('/auth'));
      });
  }

  onProfileSaved(): void {
    this.showToast('Налаштування профілю успішно збережено.');
  }

  private showToast(message: string): void {
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
    }
    this.toastMessage.set(message);
    this.toastTimer = setTimeout(() => {
      this.toastMessage.set('');
      this.toastTimer = null;
    }, 3200);
  }

  async onSeedDemo(): Promise<void> {
    const user = this.auth.currentUser();
    if (!user || this.seeding()) return;

    const confirmed = await this.confirmDialog.open({
      eyebrow: 'ТЕСТОВІ ДАНІ',
      title: 'Завантажити демонстраційні дані?',
      message: 'Поточні звички буде замінено на 7 різнопланових звичок (стабільна, із запізненнями, спадом у вихідні, зниженням регулярності, вибірковим графіком Пн/Ср/Пт, нова звичка холодного старту та архівна), після чого автоматично запуститься аналіз ризиків.',
      confirmLabel: 'Завантажити',
      cancelLabel: 'Скасувати',
    });
    if (!confirmed) return;

    this.seeding.set(true);
    try {
      const { habits, logs } = await this.habitService.seedDemoHistory(user.idUser);
      await this.mlService.analyzeHabits(habits, logs, user.notificationLimit || 3);
    } finally {
      this.seeding.set(false);
    }
  }
}
