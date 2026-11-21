import { Injectable, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import {
  Auth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  deleteUser,
  User as FbUser,
} from '@angular/fire/auth';
import {
  Firestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
} from '@angular/fire/firestore';
import { User } from '../models/habit.model';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth = inject(Auth);
  private readonly fs = inject(Firestore);
  private readonly router = inject(Router);

  /** Поточний Firebase Auth акаунт */
  private readonly _fbUser = signal<FbUser | null>(null);

  /** Поточний профіль користувача з Firestore */
  readonly currentUser = signal<User | null>(null);

  /** Обчислюваний прапорець авторизації (аналог get-властивості) */
  readonly isLoggedIn = computed(() => this._fbUser() !== null);

  constructor() {
    // Слухаємо зміну сесії (аналог Event/Subscription при зміні авторизації)
    onAuthStateChanged(this.auth, async (fbUser) => {
      this._fbUser.set(fbUser);
      if (fbUser) {
        await this.loadUserProfile(fbUser.uid);
      } else {
        this.currentUser.set(null);
      }
    });
  }

  /**
   * Сценарій 1: Реєстрація нового користувача
   */
  async register(email: string, pass: string, name: string, tz: string): Promise<void> {
    try {
      const cred = await createUserWithEmailAndPassword(this.auth, email, pass);
      const uid = cred.user.uid;
      const timezone = tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

      const userProfile: User = {
        idUser: uid,
        email,
        displayName: name,
        timezone,
        notificationLimit: 3,
        aiConsent: true,
        createdAt: null, // на сервері буде Timestamp, для локального стейту підійде null
      };

      // Зберігаємо профіль у колекцію users з ID = UID
      await setDoc(doc(this.fs, 'users', uid), {
        ...userProfile,
        createdAt: serverTimestamp(),
      });

      this.currentUser.set(userProfile);
      await this.router.navigate(['/']);
    } catch (err: unknown) {
      throw new Error(this.mapFirebaseError(err));
    }
  }

  /**
   * Сценарій 2: Вхід
   */
  async login(email: string, pass: string): Promise<void> {
    try {
      const cred = await signInWithEmailAndPassword(this.auth, email, pass);
      await this.loadUserProfile(cred.user.uid);
      await this.router.navigate(['/']);
    } catch (err: unknown) {
      throw new Error(this.mapFirebaseError(err));
    }
  }

  /**
   * Сценарій 2: Вихід
   */
  async logout(): Promise<void> {
    try {
      await signOut(this.auth);
      this.currentUser.set(null);
      this._fbUser.set(null);
      await this.router.navigate(['/auth']);
    } catch (err: unknown) {
      throw new Error(this.mapFirebaseError(err));
    }
  }

  /**
   * Сценарій 3: Оновлення налаштувань профілю
   */
  async updateProfile(patch: Partial<User>): Promise<void> {
    const user = this.currentUser();
    if (!user) throw new Error('Користувач не авторизований');

    try {
      const userRef = doc(this.fs, 'users', user.idUser);
      await updateDoc(userRef, patch);

      // Оновлюємо значення сигналу
      this.currentUser.update((prev) => (prev ? { ...prev, ...patch } : null));
    } catch (err: unknown) {
      throw new Error(this.mapFirebaseError(err));
    }
  }

  /**
   * Сценарій 3: Видалення акаунта
   */
  async deleteAccount(): Promise<void> {
    const user = this.currentUser();
    const fbUser = this._fbUser();
    if (!user || !fbUser) throw new Error('Користувач не авторизований');

    try {
      // 1. Видаляємо документ у Firestore
      await deleteDoc(doc(this.fs, 'users', user.idUser));

      // 2. Видаляємо акаунт із Firebase Auth
      await deleteUser(fbUser);

      this.currentUser.set(null);
      this._fbUser.set(null);
      await this.router.navigate(['/auth']);
    } catch (err: unknown) {
      throw new Error(this.mapFirebaseError(err));
    }
  }

  /**
   * Завантаження документа користувача з Firestore
   */
  private async loadUserProfile(uid: string): Promise<void> {
    try {
      const snap = await getDoc(doc(this.fs, 'users', uid));
      if (snap.exists()) {
        this.currentUser.set(snap.data() as User);
      }
    } catch (e) {
      console.error('Помилка завантаження профілю:', e);
    }
  }

  /**
   * Мапінг кодів помилок Firebase Auth на зрозумілі повідомлення
   */
  private mapFirebaseError(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('email-already-in-use')) {
      return 'Цей email вже використовується іншим акаунтом.';
    }
    if (message.includes('wrong-password') || message.includes('invalid-credential')) {
      return 'Невірний логін або пароль.';
    }
    if (message.includes('user-not-found')) {
      return 'Користувача з такою поштою не знайдено.';
    }
    if (message.includes('weak-password')) {
      return 'Пароль занадто слабкий (мінімум 6 символів).';
    }
    if (message.includes('requires-recent-login')) {
      return 'Ця дія вимагає повторного входу в акаунт перед виконанням.';
    }
    return 'Помилка автентифікації. Спробуйте пізніше.';
  }
}
