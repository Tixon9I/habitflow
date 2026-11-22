import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  query,
  where,
} from '@angular/fire/firestore';
import { Observable, map } from 'rxjs';
import { Habit, HabitLog } from '../models/habit.model';

export interface WeeklyChartItem {
  isoDay: number;
  day: string;
  count: number;
  scheduled: number;
  rate: number;
  isWeekend: boolean;
}

export interface CheckInScatterPoint {
  xPercent: number;
  yPercent: number;
  minutesOfDay: number;
  timeLabel: string;
  dateLabel: string;
}

@Injectable({ providedIn: 'root' })
export class StatisticsService {
  private readonly fs = inject(Firestore);

  getLogsByUser(userId: string, days: number): Observable<HabitLog[]> {
    const ref = collection(this.fs, 'habit_logs');
    const q = query(ref, where('idUser', '==', userId));
    const cutoff = this.getCutoffDateString(days);

    return (collectionData(q, { idField: 'idLog' }) as Observable<HabitLog[]>).pipe(
      map((logs) =>
        logs
          .filter((log) => log.targetDate >= cutoff)
          .sort((a, b) => b.targetDate.localeCompare(a.targetDate))
      )
    );
  }

  calculateCompletionRate(habit: Habit, logs: HabitLog[], days = 30): number {
    const today = new Date();
    const habitDates = new Set(
      logs.filter((l) => l.idHabit === habit.idHabit).map((l) => l.targetDate)
    );

    let scheduled = 0;
    let completed = 0;

    for (let offset = 0; offset < days; offset++) {
      const d = new Date(today);
      d.setDate(today.getDate() - offset);
      const isoDay = d.getDay() === 0 ? 7 : d.getDay();
      const isScheduled = habit.frequencyType === 'daily' || habit.targetDays.includes(isoDay);
      if (isScheduled) {
        scheduled++;
        if (habitDates.has(this.formatDate(d))) {
          completed++;
        }
      }
    }

    return scheduled > 0 ? completed / scheduled : 0;
  }

  buildWeeklyChartData(logs: HabitLog[], habits: Habit[] = [], days = 30): WeeklyChartItem[] {
    const labels = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
    const completedByDay = new Array<number>(7).fill(0);
    const scheduledByDay = new Array<number>(7).fill(0);

    for (const log of logs) {
      const d = this.parseIsoDate(log.targetDate);
      const isoDay = d.getDay() === 0 ? 7 : d.getDay();
      completedByDay[isoDay - 1]++;
    }

    const today = new Date();
    for (let offset = 0; offset < days; offset++) {
      const d = new Date(today);
      d.setDate(today.getDate() - offset);
      const isoDay = d.getDay() === 0 ? 7 : d.getDay();

      if (habits.length > 0) {
        for (const h of habits) {
          if (h.frequencyType === 'daily' || h.targetDays.includes(isoDay)) {
            scheduledByDay[isoDay - 1]++;
          }
        }
      } else {
        scheduledByDay[isoDay - 1]++;
      }
    }

    return labels.map((day, idx) => {
      const count = completedByDay[idx];
      const scheduled = scheduledByDay[idx];
      const rate =
        scheduled > 0 ? Math.min(100, Math.round((count / scheduled) * 100)) : 0;
      return {
        isoDay: idx + 1,
        day,
        count,
        scheduled,
        rate,
        isWeekend: idx >= 5,
      };
    });
  }

  buildCheckInScatterPoints(logs: HabitLog[]): CheckInScatterPoint[] {
    const minHour = 6 * 60;
    const maxHour = 23 * 60;
    const span = maxHour - minHour;

    return logs.map((log, index) => {
      const d = this.parseIsoDate(log.targetDate);
      const isoDay = d.getDay() === 0 ? 7 : d.getDay();
      const minutesOfDay = this.extractActualMinutes(log);
      const clamped = Math.min(maxHour, Math.max(minHour, minutesOfDay));

      const jitter = (((index * 37) % 11) - 5) * 0.9;
      const baseColX = ((isoDay - 0.5) / 7) * 100;
      const xPercent = Math.min(97, Math.max(3, baseColX + jitter));
      const yPercent = 100 - ((clamped - minHour) / span) * 100;

      return {
        xPercent,
        yPercent,
        minutesOfDay,
        timeLabel: this.formatMinutesToTime(minutesOfDay),
        dateLabel: log.targetDate,
      };
    });
  }

  buildDailySparklinePoints(logs: HabitLog[], habits: Habit[], days = 14): number[] {
    const today = new Date();
    const countsByDate = new Map<string, number>();

    for (const log of logs) {
      countsByDate.set(log.targetDate, (countsByDate.get(log.targetDate) ?? 0) + 1);
    }

    const points: number[] = [];
    for (let offset = days - 1; offset >= 0; offset--) {
      const d = new Date(today);
      d.setDate(today.getDate() - offset);
      const isoDay = d.getDay() === 0 ? 7 : d.getDay();
      const dateStr = this.formatDate(d);

      const scheduled = habits.filter(
        (h) => h.frequencyType === 'daily' || h.targetDays.includes(isoDay)
      ).length;
      const completed = countsByDate.get(dateStr) ?? 0;
      const pct = scheduled > 0 ? Math.min(100, Math.round((completed / scheduled) * 100)) : 0;
      points.push(pct);
    }
    return points;
  }

  extractActualMinutes(log: HabitLog): number {
    if (log.completedAt && typeof log.completedAt.toDate === 'function') {
      const dt = log.completedAt.toDate();
      return dt.getHours() * 60 + dt.getMinutes();
    }
    const [h, m] = log.plannedTime.split(':').map(Number);
    const total = h * 60 + m + Math.max(0, Math.round(log.delayMinutes));
    return Math.min(23 * 60 + 59, total);
  }

  formatMinutesToTime(totalMinutes: number): string {
    const normalized = Math.max(0, Math.min(23 * 60 + 59, Math.round(totalMinutes)));
    const h = Math.floor(normalized / 60);
    const m = normalized % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  private getCutoffDateString(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - Math.max(0, days - 1));
    return this.formatDate(d);
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private parseIsoDate(iso: string): Date {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
}
