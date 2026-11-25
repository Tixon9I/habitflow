import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { Habit, HabitLog } from '../models/habit.model';
import { HabitService } from './habit.service';
import {
  formatIsoDate,
  getHabitCreatedDateStr,
  getZonedDateParts,
  getZonedTodayDate,
} from '../utils/date-time.util';

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
  isLate: boolean;
}

@Injectable({ providedIn: 'root' })
export class StatisticsService {
  private readonly habitService = inject(HabitService);

  getLogsByUser(userId: string, days: number, timeZone?: string): Observable<HabitLog[]> {
    const cutoff = this.getCutoffDateString(days, timeZone);

    return this.habitService.getLogsByUser(userId).pipe(
      map((logs) =>
        logs
          .filter((log) => log.targetDate >= cutoff)
          .sort((a, b) => b.targetDate.localeCompare(a.targetDate))
      )
    );
  }

  calculateCompletionRate(
    habit: Habit,
    logs: HabitLog[],
    days = 30,
    timeZone?: string
  ): number {
    const today = getZonedTodayDate(timeZone);
    const createdDateStr = getHabitCreatedDateStr(habit.createdAt, timeZone);
    const habitDates = new Set(
      logs.filter((l) => l.idHabit === habit.idHabit).map((l) => l.targetDate)
    );

    let scheduled = 0;
    let completed = 0;

    for (let offset = 0; offset < days; offset++) {
      const d = new Date(today);
      d.setDate(today.getDate() - offset);
      const dateStr = this.formatDate(d);
      if (createdDateStr !== null && dateStr < createdDateStr) {
        continue;
      }

      const isoDay = d.getDay() === 0 ? 7 : d.getDay();
      const isScheduled = habit.frequencyType === 'daily' || habit.targetDays.includes(isoDay);
      if (isScheduled) {
        scheduled++;
        if (habitDates.has(dateStr)) {
          completed++;
        }
      }
    }

    return scheduled > 0 ? completed / scheduled : 0;
  }

  countScheduledOccurrences(
    habits: Habit[],
    days: number,
    startOffset = 0,
    timeZone?: string
  ): number {
    if (habits.length === 0) return 0;
    const today = getZonedTodayDate(timeZone);
    const createdByHabit = new Map<string, string | null>(
      habits.map((h) => [h.idHabit, getHabitCreatedDateStr(h.createdAt, timeZone)])
    );

    let total = 0;
    for (let offset = startOffset; offset < startOffset + days; offset++) {
      const d = new Date(today);
      d.setDate(today.getDate() - offset);
      const dateStr = this.formatDate(d);
      const isoDay = d.getDay() === 0 ? 7 : d.getDay();

      for (const h of habits) {
        const createdStr = createdByHabit.get(h.idHabit) ?? null;
        if (createdStr !== null && dateStr < createdStr) {
          continue;
        }
        if (h.frequencyType === 'daily' || h.targetDays.includes(isoDay)) {
          total++;
        }
      }
    }
    return total;
  }

  buildWeeklyChartData(
    logs: HabitLog[],
    habits: Habit[] = [],
    days = 30,
    timeZone?: string
  ): WeeklyChartItem[] {
    const labels = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
    const completedByDay = new Array<number>(7).fill(0);
    const scheduledByDay = new Array<number>(7).fill(0);

    for (const log of logs) {
      const d = this.parseIsoDate(log.targetDate);
      const isoDay = d.getDay() === 0 ? 7 : d.getDay();
      completedByDay[isoDay - 1]++;
    }

    const today = getZonedTodayDate(timeZone);
    const createdByHabit = new Map<string, string | null>(
      habits.map((h) => [h.idHabit, getHabitCreatedDateStr(h.createdAt, timeZone)])
    );

    for (let offset = 0; offset < days; offset++) {
      const d = new Date(today);
      d.setDate(today.getDate() - offset);
      const dateStr = this.formatDate(d);
      const isoDay = d.getDay() === 0 ? 7 : d.getDay();

      if (habits.length > 0) {
        for (const h of habits) {
          const createdStr = createdByHabit.get(h.idHabit) ?? null;
          if (createdStr !== null && dateStr < createdStr) {
            continue;
          }
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

  buildCheckInScatterPoints(logs: HabitLog[], timeZone?: string): CheckInScatterPoint[] {
    const minHour = 6 * 60;
    const maxHour = 23 * 60;
    const span = maxHour - minHour;

    return logs.map((log, index) => {
      const d = this.parseIsoDate(log.targetDate);
      const isoDay = d.getDay() === 0 ? 7 : d.getDay();
      const minutesOfDay = this.extractActualMinutes(log, timeZone);
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
        isLate: Math.max(0, log.delayMinutes) > 30,
      };
    });
  }

  buildDailySparklinePoints(
    logs: HabitLog[],
    habits: Habit[],
    days = 14,
    timeZone?: string
  ): number[] {
    const today = getZonedTodayDate(timeZone);
    const createdByHabit = new Map<string, string | null>(
      habits.map((h) => [h.idHabit, getHabitCreatedDateStr(h.createdAt, timeZone)])
    );
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

      const scheduled = habits.filter((h) => {
        const createdStr = createdByHabit.get(h.idHabit) ?? null;
        if (createdStr !== null && dateStr < createdStr) return false;
        return h.frequencyType === 'daily' || h.targetDays.includes(isoDay);
      }).length;
      const completed = countsByDate.get(dateStr) ?? 0;
      const pct = scheduled > 0 ? Math.min(100, Math.round((completed / scheduled) * 100)) : 0;
      points.push(pct);
    }
    return points;
  }

  extractActualMinutes(log: HabitLog, timeZone?: string): number {
    if (log.completedAt && typeof log.completedAt.toDate === 'function') {
      const zoned = getZonedDateParts(log.completedAt.toDate(), timeZone);
      return zoned.hours * 60 + zoned.minutes;
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

  private getCutoffDateString(days: number, timeZone?: string): string {
    const d = getZonedTodayDate(timeZone);
    d.setDate(d.getDate() - Math.max(0, days - 1));
    return formatIsoDate(d);
  }

  private formatDate(date: Date): string {
    return formatIsoDate(date);
  }

  private parseIsoDate(iso: string): Date {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
}
