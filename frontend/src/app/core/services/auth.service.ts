import { Injectable, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import {
  Auth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile as fbUpdateProfile,
  deleteUser,
  User as FbUser,
} from '@angular/fire/auth';
import {
  Firestore,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from '@angular/fire/firestore';
import { User } from '../models/habit.model';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth     = inject(Auth);
  private readonly fs       = inject(Firestore);
  private readonly router   = inject(Router);

  /** Поточний Firebase Auth user (null = не увійшов) */
  private readonly _fbUser = signal<FbUser | null>(null);
  /** Поточний Firestore профіль (null до завантаження) */
  readonly currentUser = signal<User | null>(null);
  readonly isLoggedIn  = computed(() => this._fbUser() !== null);

  constructor() {
    // Відстежуємо зміни Auth стану
    onAuthStateChanged(this.auth, (fbUser) => {
      this._fbUser.set(fbUser);
      if (!fbUser) {
        this.currentUser.set(null);
      }
    });
  }

  // ── Сценарій 1: Реєстрація ──────────────────────────────────
  /**
   * [Я ПИШУ + ТВІЙ РЕВ'Ю]
   * Сигнатура фіксована — реалізуй згідно ТЗ 1.3 плану.
   */
  register(_email: string, _pass: string, _name: string, _tz: string): Promise<void> {
    throw new Error('Not implemented — Крок 1.3: реалізуй register()');
  }

  // ── Сценарій 2: Вхід ────────────────────────────────────────
  /**
   * [Я ПИШУ + ТВІЙ РЕВ'Ю]
   */
  login(_email: string, _pass: string): Promise<void> {
    throw new Error('Not implemented — Крок 1.3: реалізуй login()');
  }

  // ── Сценарій 2: Вихід ───────────────────────────────────────
  /**
   * [Я ПИШУ + ТВІЙ РЕВ'Ю]
   */
  logout(): Promise<void> {
    throw new Error('Not implemented — Крок 1.3: реалізуй logout()');
  }

  // ── Сценарій 3: Оновлення профілю ───────────────────────────
  /**
   * [Я ПИШУ + ТВІЙ РЕВ'Ю]
   */
  updateProfile(_patch: Partial<User>): Promise<void> {
    throw new Error('Not implemented — Крок 1.3: реалізуй updateProfile()');
  }

  // ── Сценарій 3: Видалення акаунта ───────────────────────────
  /**
   * [Я ПИШУ + ТВІЙ РЕВ'Ю]
   */
  deleteAccount(): Promise<void> {
    throw new Error('Not implemented — Крок 1.3: реалізуй deleteAccount()');
  }

  // ── Допоміжний метод для підписки на завантаження профілю ──
  /**
   * Викликається після login/register — завантажує Firestore документ.
   * Реалізуй у Кроці 1.3.
   */
  protected loadUserProfile(_uid: string): Promise<void> {
    return Promise.resolve();
  }
}
