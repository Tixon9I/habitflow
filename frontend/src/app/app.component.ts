import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AuthService } from './core/services/auth.service';
import { ProfileModalComponent } from './features/profile-modal/profile-modal.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterModule, ProfileModalComponent],
  template: `
    @if (showNav()) {
      <nav class="topnav">
        <a class="topnav__logo" routerLink="/">
          <span class="logo-mark">HF</span>
          <span class="logo-text">HabitFlow</span>
        </a>

        <div class="topnav__links">
          <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{exact:true}">Сьогодні</a>
          <a routerLink="/schedule" routerLinkActive="active">Аналіз розкладу</a>
          <a routerLink="/statistics" routerLinkActive="active">Статистика</a>
        </div>

        <div class="topnav__actions">
          <button class="btn btn--ghost btn--sm" (click)="onSeedDemo()" [disabled]="!auth.isLoggedIn()">
            Тестові дані (30 дн.)
          </button>
          <button class="btn btn--primary btn--sm" (click)="onNewHabit()" [disabled]="!auth.isLoggedIn()">
            + Нова звичка
          </button>
          <button class="topnav__avatar" (click)="showProfileModal.set(true)" [disabled]="!auth.isLoggedIn()" title="Профіль">
            {{ avatarInitial() }}
          </button>
        </div>
      </nav>
    }

    <router-outlet />

    @if (showProfileModal()) {
      <app-profile-modal (close)="showProfileModal.set(false)" />
    }
  `,
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly showNav = signal(true);
  readonly showProfileModal = signal(false);

  readonly avatarInitial = () => {
    const name = this.auth.currentUser()?.displayName ?? 'U';
    return name.charAt(0).toUpperCase();
  };

  constructor() {
    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd)
    ).subscribe((e: NavigationEnd) => {
      this.showNav.set(!e.url.startsWith('/auth'));
    });
  }

  onSeedDemo(): void {}

  onNewHabit(): void {}
}
