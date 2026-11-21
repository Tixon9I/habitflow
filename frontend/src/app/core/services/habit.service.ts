import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { Habit, HabitLog } from '../models/habit.model';

@Injectable({ providedIn: 'root' })
export class HabitService {
  private readonly fs = inject(Firestore);

  getHabits(userId: string): Observable<Habit[]> {
    const ref = collection(this.fs, 'habits');
    const q = query(ref, where('idUser', '==', userId), where('isActive', '==', true));
    return collectionData(q, { idField: 'idHabit' }) as Observable<Habit[]>;
  }

  createHabit(_habit: Omit<Habit, 'idHabit' | 'createdAt' | 'currentStreak' | 'bestStreak'>): Promise<string> {
    throw new Error('Not implemented');
  }

  updateHabitSchedule(_habit: Habit, _newTime: string, _newDays: number[]): Promise<void> {
    throw new Error('Not implemented');
  }

  archiveHabit(habitId: string): Promise<void> {
    return updateDoc(doc(this.fs, 'habits', habitId), { isActive: false });
  }

  deleteHabit(habitId: string): Promise<void> {
    return deleteDoc(doc(this.fs, 'habits', habitId));
  }

  toggleCheckIn(_habit: Habit, _date: Date): Promise<void> {
    throw new Error('Not implemented');
  }

  getLogsByHabit(habitId: string): Observable<HabitLog[]> {
    const ref = collection(this.fs, 'habit_logs');
    const q = query(ref, where('idHabit', '==', habitId), orderBy('targetDate', 'desc'));
    return collectionData(q, { idField: 'idLog' }) as Observable<HabitLog[]>;
  }

  seedDemoHistory(_userId: string): Promise<void> {
    throw new Error('Not implemented');
  }
}
