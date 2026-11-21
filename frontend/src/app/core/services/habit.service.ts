import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  addDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  serverTimestamp,
  Timestamp,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { Habit, HabitLog, ScheduleHistoryEntry } from '../models/habit.model';

@Injectable({ providedIn: 'root' })
export class HabitService {
  private readonly fs = inject(Firestore);

  getHabits(userId: string): Observable<Habit[]> {
    const ref = collection(this.fs, 'habits');
    const q = query(ref, where('idUser', '==', userId), where('isActive', '==', true));
    return collectionData(q, { idField: 'idHabit' }) as Observable<Habit[]>;
  }

  getLogsByUser(userId: string): Observable<HabitLog[]> {
    const ref = collection(this.fs, 'habit_logs');
    const q = query(ref, where('idUser', '==', userId));
    return collectionData(q, { idField: 'idLog' }) as Observable<HabitLog[]>;
  }

  async createHabit(habit: Omit<Habit, 'idHabit' | 'createdAt' | 'currentStreak' | 'bestStreak'>): Promise<string> {
    const ref = collection(this.fs, 'habits');
    const payload = {
      ...habit,
      currentStreak: 0,
      bestStreak: 0,
      isActive: true,
      scheduleHistory: [],
      createdAt: serverTimestamp(),
    };
    const res = await addDoc(ref, payload);
    return res.id;
  }

  async updateHabitSchedule(habit: Habit, newTime: string, newDays: number[]): Promise<void> {
    const habitRef = doc(this.fs, 'habits', habit.idHabit);
    const historyItem: ScheduleHistoryEntry = {
      changedAt: Timestamp.now(),
      oldTime: habit.reminderTime,
      oldDays: habit.targetDays,
    };

    await updateDoc(habitRef, {
      reminderTime: newTime,
      targetDays: newDays,
      scheduleHistory: [...(habit.scheduleHistory ?? []), historyItem],
    });
  }

  archiveHabit(habitId: string): Promise<void> {
    return updateDoc(doc(this.fs, 'habits', habitId), { isActive: false });
  }

  deleteHabit(habitId: string): Promise<void> {
    return deleteDoc(doc(this.fs, 'habits', habitId));
  }

  async toggleCheckIn(habit: Habit, date: Date): Promise<void> {
    const targetDate = this.formatDate(date);
    const logsRef = collection(this.fs, 'habit_logs');
    const q = query(
      logsRef,
      where('idHabit', '==', habit.idHabit),
      where('targetDate', '==', targetDate)
    );
    const snap = await getDocs(q);

    const habitRef = doc(this.fs, 'habits', habit.idHabit);

    if (!snap.empty) {
      const logId = snap.docs[0].id;
      await deleteDoc(doc(this.fs, 'habit_logs', logId));

      const newStreak = Math.max(0, habit.currentStreak - 1);
      await updateDoc(habitRef, { currentStreak: newStreak });
    } else {
      const now = new Date();
      const delayMinutes = this.calculateDelayMinutes(now, habit.reminderTime);

      const logPayload = {
        idHabit: habit.idHabit,
        idUser: habit.idUser,
        targetDate,
        completedAt: Timestamp.now(),
        plannedTime: habit.reminderTime,
        delayMinutes,
      };
      await addDoc(logsRef, logPayload);

      const nextStreak = habit.currentStreak + 1;
      const bestStreak = Math.max(habit.bestStreak, nextStreak);
      await updateDoc(habitRef, {
        currentStreak: nextStreak,
        bestStreak,
      });
    }
  }

  getLogsByHabit(habitId: string): Observable<HabitLog[]> {
    const ref = collection(this.fs, 'habit_logs');
    const q = query(ref, where('idHabit', '==', habitId));
    return collectionData(q, { idField: 'idLog' }) as Observable<HabitLog[]>;
  }

  formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private calculateDelayMinutes(actualDate: Date, plannedTimeStr: string): number {
    const [hours, minutes] = plannedTimeStr.split(':').map(Number);
    const plannedDate = new Date(actualDate);
    plannedDate.setHours(hours, minutes, 0, 0);

    const diffMs = actualDate.getTime() - plannedDate.getTime();
    const diffMinutes = Math.round(diffMs / 60000);
    return Math.max(0, diffMinutes);
  }
}
