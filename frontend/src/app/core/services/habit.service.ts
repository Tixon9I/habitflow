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
  writeBatch,
  query,
  where,
  serverTimestamp,
  Timestamp,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { Habit, HabitLog, ScheduleHistoryEntry } from '../models/habit.model';

interface DemoHabitTemplate {
  title: string;
  category: string;
  reminderTime: string;
  currentStreak: number;
  bestStreak: number;
  pattern: 'stable' | 'late_checkin' | 'weekend_drop' | 'moderate';
}

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

  async createHabit(
    habit: Omit<Habit, 'idHabit' | 'createdAt' | 'currentStreak' | 'bestStreak'>
  ): Promise<string> {
    const ref = collection(this.fs, 'habits');
    const initialHistory: ScheduleHistoryEntry = {
      changedAt: Timestamp.now(),
      oldTime: habit.reminderTime,
      oldDays: habit.targetDays,
    };
    const payload = {
      ...habit,
      frequencyType: habit.targetDays.length === 7 ? 'daily' : 'custom',
      currentStreak: 0,
      bestStreak: 0,
      isActive: true,
      scheduleHistory: [initialHistory],
      createdAt: serverTimestamp(),
    };
    const res = await addDoc(ref, payload);
    return res.id;
  }

  async updateHabitDetails(
    habitId: string,
    patch: { title: string; category: string }
  ): Promise<void> {
    const habitRef = doc(this.fs, 'habits', habitId);
    await updateDoc(habitRef, patch);
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
      frequencyType: newDays.length === 7 ? 'daily' : 'custom',
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

  async seedDemoHistory(userId: string): Promise<{ habits: Habit[]; logs: HabitLog[] }> {
    await this.clearUserData(userId);

    const templates: DemoHabitTemplate[] = [
      {
        title: 'Читання фахової літератури',
        category: 'Навчання',
        reminderTime: '20:00',
        currentStreak: 12,
        bestStreak: 16,
        pattern: 'stable',
      },
      {
        title: 'Ранкова пробіжка',
        category: 'Спорт',
        reminderTime: '07:30',
        currentStreak: 4,
        bestStreak: 9,
        pattern: 'late_checkin',
      },
      {
        title: 'Практика англійської',
        category: 'Навчання',
        reminderTime: '19:00',
        currentStreak: 5,
        bestStreak: 10,
        pattern: 'weekend_drop',
      },
      {
        title: 'Алгоритмічні задачі',
        category: 'Навчання',
        reminderTime: '18:30',
        currentStreak: 6,
        bestStreak: 11,
        pattern: 'moderate',
      },
      {
        title: 'Вітаміни',
        category: "Здоров'я",
        reminderTime: '09:00',
        currentStreak: 21,
        bestStreak: 21,
        pattern: 'stable',
      },
    ];

    const batch = writeBatch(this.fs);
    const today = new Date();
    const createdDate = new Date(today);
    createdDate.setDate(today.getDate() - 30);
    const createdTimestamp = Timestamp.fromDate(createdDate);

    const createdHabits: Habit[] = [];
    const createdLogs: HabitLog[] = [];

    for (let hIdx = 0; hIdx < templates.length; hIdx++) {
      const tpl = templates[hIdx];
      const habitRef = doc(collection(this.fs, 'habits'));
      const initialHistory: ScheduleHistoryEntry = {
        changedAt: createdTimestamp,
        oldTime: tpl.reminderTime,
        oldDays: [1, 2, 3, 4, 5, 6, 7],
      };

      const habitDoc: Habit = {
        idHabit: habitRef.id,
        idUser: userId,
        title: tpl.title,
        category: tpl.category,
        frequencyType: 'daily',
        targetDays: [1, 2, 3, 4, 5, 6, 7],
        reminderTime: tpl.reminderTime,
        scheduleHistory: [initialHistory],
        currentStreak: tpl.currentStreak,
        bestStreak: tpl.bestStreak,
        isActive: true,
        createdAt: createdTimestamp,
      };
      createdHabits.push(habitDoc);

      batch.set(habitRef, {
        idUser: habitDoc.idUser,
        title: habitDoc.title,
        category: habitDoc.category,
        frequencyType: habitDoc.frequencyType,
        targetDays: habitDoc.targetDays,
        reminderTime: habitDoc.reminderTime,
        scheduleHistory: habitDoc.scheduleHistory,
        currentStreak: habitDoc.currentStreak,
        bestStreak: habitDoc.bestStreak,
        isActive: habitDoc.isActive,
        createdAt: habitDoc.createdAt,
      });

      const [plannedH, plannedM] = tpl.reminderTime.split(':').map(Number);

      for (let offset = 1; offset <= 30; offset++) {
        const d = new Date(today);
        d.setDate(today.getDate() - offset);
        const isoDay = d.getDay() === 0 ? 7 : d.getDay();
        const isWeekend = isoDay === 6 || isoDay === 7;
        const seed = (hIdx * 31 + offset * 17) % 100;

        if (!this.shouldSeedDay(tpl.pattern, isWeekend, seed, offset)) {
          continue;
        }

        const delayMinutes = this.computeDemoDelay(tpl.pattern, seed);
        const completedDate = new Date(d);
        const totalMins = Math.min(23 * 60 + 45, plannedH * 60 + plannedM + delayMinutes);
        completedDate.setHours(Math.floor(totalMins / 60), totalMins % 60, 0, 0);

        const logRef = doc(collection(this.fs, 'habit_logs'));
        const completedTs = Timestamp.fromDate(completedDate);
        const targetDate = this.formatDate(d);

        createdLogs.push({
          idLog: logRef.id,
          idHabit: habitRef.id,
          idUser: userId,
          targetDate,
          completedAt: completedTs,
          plannedTime: tpl.reminderTime,
          delayMinutes,
        });

        batch.set(logRef, {
          idHabit: habitRef.id,
          idUser: userId,
          targetDate,
          completedAt: completedTs,
          plannedTime: tpl.reminderTime,
          delayMinutes,
        });
      }
    }

    await batch.commit();
    return { habits: createdHabits, logs: createdLogs };
  }

  private async clearUserData(userId: string): Promise<void> {
    const colNames = ['habits', 'habit_logs', 'recommendations'];
    const refs = [];

    for (const colName of colNames) {
      const snap = await getDocs(
        query(collection(this.fs, colName), where('idUser', '==', userId))
      );
      for (const d of snap.docs) {
        refs.push(d.ref);
      }
    }

    const chunkSize = 400;
    for (let i = 0; i < refs.length; i += chunkSize) {
      const batch = writeBatch(this.fs);
      for (const ref of refs.slice(i, i + chunkSize)) {
        batch.delete(ref);
      }
      await batch.commit();
    }
  }

  formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private shouldSeedDay(
    pattern: DemoHabitTemplate['pattern'],
    isWeekend: boolean,
    seed: number,
    offset: number
  ): boolean {
    if (pattern === 'stable') {
      return seed >= 8;
    }
    if (pattern === 'late_checkin') {
      if (offset <= 7) return seed >= 35;
      return seed >= 28;
    }
    if (pattern === 'weekend_drop') {
      if (isWeekend) return seed >= 88;
      return seed >= 12;
    }
    return seed >= 22;
  }

  private computeDemoDelay(pattern: DemoHabitTemplate['pattern'], seed: number): number {
    if (pattern === 'late_checkin') {
      return 60 + (seed % 75);
    }
    if (pattern === 'moderate') {
      return 5 + (seed % 25);
    }
    return seed % 12;
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
