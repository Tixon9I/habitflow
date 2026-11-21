import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  Timestamp,
} from '@angular/fire/firestore';
import { Observable, of } from 'rxjs';
import { Habit, HabitLog, ScheduleHistoryEntry } from '../models/habit.model';

@Injectable({ providedIn: 'root' })
export class HabitService {
  private readonly fs = inject(Firestore);

  // ── Сценарій 5/6: Читання звичок ────────────────────────────
  getHabits(userId: string): Observable<Habit[]> {
    const ref = collection(this.fs, 'habits');
    const q   = query(ref, where('idUser', '==', userId), where('isActive', '==', true));
    return collectionData(q, { idField: 'idHabit' }) as Observable<Habit[]>;
  }

  // ── Сценарій 4: Створення звички ────────────────────────────
  /**
   * [Я ПИШУ + ТВІЙ РЕВ'Ю] — Крок 2.2
   */
  createHabit(_habit: Omit<Habit, 'idHabit' | 'createdAt' | 'currentStreak' | 'bestStreak'>): Promise<string> {
    throw new Error('Not implemented — Крок 2.2');
  }

  // ── Сценарій 5: Редагування розкладу ────────────────────────
  /**
   * [Я ПИШУ + ТВІЙ РЕВ'Ю] — Крок 2.2
   */
  updateHabitSchedule(_habit: Habit, _newTime: string, _newDays: number[]): Promise<void> {
    throw new Error('Not implemented — Крок 2.2');
  }

  // ── Сценарій 5: Архівація / Видалення ───────────────────────
  archiveHabit(habitId: string): Promise<void> {
    return updateDoc(doc(this.fs, 'habits', habitId), { isActive: false });
  }

  deleteHabit(habitId: string): Promise<void> {
    return deleteDoc(doc(this.fs, 'habits', habitId));
  }

  // ── Сценарій 6: Чекін ────────────────────────────────────────
  /**
   * [Я ПИШУ + ТВІЙ РЕВ'Ю] — Крок 2.3
   */
  toggleCheckIn(_habit: Habit, _date: Date): Promise<void> {
    throw new Error('Not implemented — Крок 2.3');
  }

  // ── Сценарій 6 (допоміжний): логи для статистики ────────────
  getLogsByHabit(habitId: string): Observable<HabitLog[]> {
    const ref = collection(this.fs, 'habit_logs');
    const q   = query(ref, where('idHabit', '==', habitId), orderBy('targetDate', 'desc'));
    return collectionData(q, { idField: 'idLog' }) as Observable<HabitLog[]>;
  }

  // ── Сценарій «Тестові дані» ──────────────────────────────────
  /**
   * [АВТО] — Крок 4.4: генерує 30 днів демо-логів
   * Реалізацію додаємо у Крок 4.4.
   */
  seedDemoHistory(_userId: string): Promise<void> {
    throw new Error('Not implemented — Крок 4.4');
  }
}
