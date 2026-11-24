import { Injectable, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import {
  Auth,
  EmailAuthProvider,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  reauthenticateWithCredential,
  signOut,
  onAuthStateChanged,
  deleteUser,
  User as FbUser,
} from '@angular/fire/auth';
import {
  Firestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
  query,
  where,
  serverTimestamp,
} from '@angular/fire/firestore';
import { User } from '../models/habit.model';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth = inject(Auth);
  private readonly fs = inject(Firestore);
  private readonly router = inject(Router);

  private readonly _fbUser = signal<FbUser | null>(null);
  readonly currentUser = signal<User | null>(null);
  readonly isLoggedIn = computed(() => this._fbUser() !== null);

  constructor() {
    onAuthStateChanged(this.auth, async (fbUser) => {
      this._fbUser.set(fbUser);
      if (fbUser) {
        await this.loadUserProfile(fbUser.uid);
      } else {
        this.currentUser.set(null);
      }
    });
  }

  async register(
    email: string,
    pass: string,
    name: string,
    tz: string,
    aiConsent = true
  ): Promise<void> {
    try {
      const cred = await createUserWithEmailAndPassword(this.auth, email, pass);
      const uid = cred.user.uid;
      const timezone = tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

      const userProfile: User = {
        idUser: uid,
        email,
        displayName: name.trim(),
        timezone,
        notificationLimit: 3,
        aiConsent,
        createdAt: null,
      };

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

  async login(email: string, pass: string): Promise<void> {
    try {
      const cred = await signInWithEmailAndPassword(this.auth, email, pass);
      await this.loadUserProfile(cred.user.uid);
      await this.router.navigate(['/']);
    } catch (err: unknown) {
      throw new Error(this.mapFirebaseError(err));
    }
  }

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

  async updateProfile(patch: Partial<User>): Promise<void> {
    const user = this.currentUser();
    if (!user) throw new Error('Користувач не авторизований');

    try {
      const userRef = doc(this.fs, 'users', user.idUser);
      await updateDoc(userRef, patch);
      this.currentUser.update((prev) => (prev ? { ...prev, ...patch } : null));
    } catch (err: unknown) {
      throw new Error(this.mapFirebaseError(err));
    }
  }

  async deleteAccount(password?: string): Promise<void> {
    const user = this.currentUser();
    const fbUser = this._fbUser();
    if (!user || !fbUser) throw new Error('Користувач не авторизований');

    try {
      if (password && fbUser.email) {
        const credential = EmailAuthProvider.credential(fbUser.email, password);
        await reauthenticateWithCredential(fbUser, credential);
      }

      await this.deleteUserCollections(user.idUser);
      await deleteUser(fbUser);
      this.currentUser.set(null);
      this._fbUser.set(null);
      await this.router.navigate(['/auth']);
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      if (raw.includes('requires-recent-login')) {
        await this.logout();
        throw new Error('Для видалення акаунта увійдіть повторно та повторіть спробу.');
      }
      throw new Error(this.mapFirebaseError(err));
    }
  }

  private async deleteUserCollections(uid: string): Promise<void> {
    const collectionNames = ['habits', 'habit_logs', 'recommendations'];
    const refsToDelete = [doc(this.fs, 'users', uid)];

    for (const colName of collectionNames) {
      const snap = await getDocs(
        query(collection(this.fs, colName), where('idUser', '==', uid))
      );
      for (const d of snap.docs) {
        refsToDelete.push(d.ref);
      }
    }

    const chunkSize = 400;
    for (let i = 0; i < refsToDelete.length; i += chunkSize) {
      const batch = writeBatch(this.fs);
      for (const ref of refsToDelete.slice(i, i + chunkSize)) {
        batch.delete(ref);
      }
      await batch.commit();
    }
  }

  private async loadUserProfile(uid: string): Promise<void> {
    try {
      const snap = await getDoc(doc(this.fs, 'users', uid));
      if (snap.exists()) {
        this.currentUser.set(snap.data() as User);
      }
    } catch (e) {
      console.error(e);
    }
  }

  private mapFirebaseError(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('email-already-in-use')) {
      return 'Користувач із такою електронною поштою вже зареєстрований.';
    }
    if (message.includes('wrong-password') || message.includes('invalid-credential')) {
      return 'Невірна електронна пошта або пароль.';
    }
    if (message.includes('user-not-found')) {
      return 'Користувача з такою поштою не знайдено.';
    }
    if (message.includes('weak-password')) {
      return 'Пароль має містити щонайменше 6 символів.';
    }
    if (message.includes('requires-recent-login')) {
      return 'Ця дія вимагає повторного входу в акаунт перед виконанням.';
    }
    return 'Помилка автентифікації. Спробуйте пізніше.';
  }
}
