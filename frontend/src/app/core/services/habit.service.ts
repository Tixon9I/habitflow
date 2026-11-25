import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  writeBatch,
  query,
  where,
  serverTimestamp,
  Timestamp,
} from '@angular/fire/firestore';
import { Observable, map, shareReplay } from 'rxjs';
import { Habit, HabitLog, ScheduleHistoryEntry } from '../models/habit.model';
import { formatIsoDate, getZonedDateParts, getZonedTodayDate } from '../utils/date-time.util';
import { buildDemoHabitBundle, prepareDemoLocalState } from '../utils/demo-seed.util';

@Injectable({ providedIn: 'root' })
export class HabitService {
  private readonly fs = inject(Firestore);
  private readonly habitsCache = new Map<string, Observable<Habit[]>>();
  private readonly logsCache = new Map<string, Observable<HabitLog[]>>();

  clearCache(): void {
    this.habitsCache.clear();
    this.logsCache.clear();
  }

  getHabits(userId: string): Observable<Habit[]> {
    return this.getAllHabits(userId).pipe(
      map((list) => list.filter((h) => h.isActive))
    );
  }

  getAllHabits(userId: string): Observable<Habit[]> {
    let stream = this.habitsCache.get(userId);
    if (!stream) {
      const ref = collection(this.fs, 'habits');
      const q = query(ref, where('idUser', '==', userId));
      stream = (collectionData(q, { idField: 'idHabit' }) as Observable<Habit[]>).pipe(
        shareReplay(1)
      );
      this.habitsCache.set(userId, stream);
    }
    return stream;
  }

  getLogsByUser(userId: string): Observable<HabitLog[]> {
    let stream = this.logsCache.get(userId);
    if (!stream) {
      const ref = collection(this.fs, 'habit_logs');
      const q = query(ref, where('idUser', '==', userId));
      stream = (collectionData(q, { idField: 'idLog' }) as Observable<HabitLog[]>).pipe(
        shareReplay(1)
      );
      this.logsCache.set(userId, stream);
    }
    return stream;
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

  async updateHabitSchedule(
    habit: Habit,
    newTime: string,
    newDays: number[],
    clearPendingRecommendations = true
  ): Promise<void> {
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

    if (clearPendingRecommendations) {
      await this.clearPendingRecommendationsForHabit(habit.idUser, habit.idHabit);
    }
  }

  async archiveHabit(habitId: string, userId?: string): Promise<void> {
    const resolvedUserId = userId ?? (await this.resolveHabitOwner(habitId));
    await updateDoc(doc(this.fs, 'habits', habitId), { isActive: false });
    if (resolvedUserId) {
      await this.clearPendingRecommendationsForHabit(resolvedUserId, habitId);
    }
  }

  restoreHabit(habitId: string): Promise<void> {
    return updateDoc(doc(this.fs, 'habits', habitId), { isActive: true });
  }

  async deleteHabit(habitId: string, userId?: string): Promise<void> {
    const resolvedUserId = userId ?? (await this.resolveHabitOwner(habitId));
    const refsToDelete = [doc(this.fs, 'habits', habitId)];

    if (resolvedUserId) {
      for (const colName of ['habit_logs', 'recommendations']) {
        const snap = await getDocs(
          query(collection(this.fs, colName), where('idUser', '==', resolvedUserId))
        );
        for (const d of snap.docs) {
          if (d.data()['idHabit'] === habitId) {
            refsToDelete.push(d.ref);
          }
        }
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

  private async resolveHabitOwner(habitId: string): Promise<string | null> {
    const snap = await getDoc(doc(this.fs, 'habits', habitId));
    if (!snap.exists()) return null;
    const owner = snap.data()['idUser'];
    return typeof owner === 'string' ? owner : null;
  }

  private async clearPendingRecommendationsForHabit(
    userId: string,
    habitId: string
  ): Promise<void> {
    const snap = await getDocs(
      query(collection(this.fs, 'recommendations'), where('idUser', '==', userId))
    );
    const batch = writeBatch(this.fs);
    let hasDeletes = false;

    for (const d of snap.docs) {
      const data = d.data();
      if (data['idHabit'] === habitId && data['status'] === 'pending') {
        batch.delete(d.ref);
        hasDeletes = true;
      }
    }

    if (hasDeletes) {
      await batch.commit();
    }
  }

  async toggleCheckIn(habit: Habit, date: Date, timeZone?: string): Promise<void> {
    const targetDate = this.formatDate(date);
    const todayStr = getZonedDateParts(new Date(), timeZone).dateStr;
    const logsRef = collection(this.fs, 'habit_logs');
    const snap = await getDocs(query(logsRef, where('idUser', '==', habit.idUser)));

    const habitDates = new Set<string>();
    let existingDocRef = null;

    for (const d of snap.docs) {
      const data = d.data();
      if (data['idHabit'] === habit.idHabit) {
        const logDate = String(data['targetDate'] ?? '');
        if (logDate) habitDates.add(logDate);
        if (logDate === targetDate) {
          existingDocRef = d.ref;
        }
      }
    }

    const habitRef = doc(this.fs, 'habits', habit.idHabit);

    if (existingDocRef) {
      await deleteDoc(existingDocRef);
      habitDates.delete(targetDate);
    } else {
      const isToday = targetDate === todayStr;
      let completedAt: Timestamp;
      let delayMinutes: number;

      if (isToday) {
        const now = new Date();
        completedAt = Timestamp.now();
        delayMinutes = this.calculateDelayMinutes(now, habit.reminderTime, timeZone);
      } else {
        const [hours, minutes] = habit.reminderTime.split(':').map(Number);
        const planned = new Date(date);
        planned.setHours(hours, minutes, 0, 0);
        completedAt = Timestamp.fromDate(planned);
        delayMinutes = 0;
      }

      await addDoc(logsRef, {
        idHabit: habit.idHabit,
        idUser: habit.idUser,
        targetDate,
        completedAt,
        plannedTime: habit.reminderTime,
        delayMinutes,
      });
      habitDates.add(targetDate);
    }

    const zonedToday = getZonedTodayDate(timeZone);
    const currentStreak = this.calculateStreak(habit, habitDates, zonedToday);
    const bestStreak = Math.max(habit.bestStreak, currentStreak);
    await updateDoc(habitRef, {
      currentStreak,
      bestStreak,
    });
  }

  calculateStreak(habit: Habit, completedDates: Set<string>, referenceDate: Date): number {
    let streak = 0;
    for (let offset = 0; offset < 365; offset++) {
      const d = new Date(referenceDate);
      d.setDate(referenceDate.getDate() - offset);
      const isoDay = d.getDay() === 0 ? 7 : d.getDay();
      const isScheduled =
        habit.frequencyType === 'daily' || habit.targetDays.includes(isoDay);

      if (!isScheduled) {
        continue;
      }

      const dateStr = this.formatDate(d);
      if (completedDates.has(dateStr)) {
        streak++;
      } else if (offset === 0) {
        continue;
      } else {
        break;
      }
    }
    return streak;
  }

  getLogsByHabit(habitId: string): Observable<HabitLog[]> {
    const ref = collection(this.fs, 'habit_logs');
    const q = query(ref, where('idHabit', '==', habitId));
    return collectionData(q, { idField: 'idLog' }) as Observable<HabitLog[]>;
  }

  async seedDemoHistory(userId: string): Promise<{ habits: Habit[]; logs: HabitLog[] }> {
    await this.clearUserData(userId);
    prepareDemoLocalState(userId);

    const { habits, logs } = buildDemoHabitBundle(
      userId,
      new Date(),
      (kind) => doc(collection(this.fs, kind)).id,
      (h, dates, refDate) => this.calculateStreak(h, dates, refDate)
    );

    const writeOps: Array<{ ref: ReturnType<typeof doc>; data: Record<string, unknown> }> = [];

    for (const habitDoc of habits) {
      writeOps.push({
        ref: doc(this.fs, 'habits', habitDoc.idHabit),
        data: {
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
        },
      });
    }

    for (const logDoc of logs) {
      writeOps.push({
        ref: doc(this.fs, 'habit_logs', logDoc.idLog),
        data: {
          idHabit: logDoc.idHabit,
          idUser: logDoc.idUser,
          targetDate: logDoc.targetDate,
          completedAt: logDoc.completedAt,
          plannedTime: logDoc.plannedTime,
          delayMinutes: logDoc.delayMinutes,
        },
      });
    }

    const chunkSize = 400;
    for (let i = 0; i < writeOps.length; i += chunkSize) {
      const batch = writeBatch(this.fs);
      for (const item of writeOps.slice(i, i + chunkSize)) {
        batch.set(item.ref, item.data);
      }
      await batch.commit();
    }

    return { habits, logs };
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
    return formatIsoDate(date);
  }

  private calculateDelayMinutes(
    actualDate: Date,
    plannedTimeStr: string,
    timeZone?: string
  ): number {
    const [hours, minutes] = plannedTimeStr.split(':').map(Number);
    const zoned = getZonedDateParts(actualDate, timeZone);
    const diffMinutes = zoned.hours * 60 + zoned.minutes - (hours * 60 + minutes);
    return Math.max(0, diffMinutes);
  }
}
