import { Timestamp } from '@angular/fire/firestore';
import { Habit, HabitLog, ScheduleHistoryEntry } from '../models/habit.model';
import { formatIsoDate } from './date-time.util';

export interface DemoHabitTemplate {
  title: string;
  category: string;
  frequencyType: 'daily' | 'custom';
  targetDays: number[];
  reminderTime: string;
  historyDays: number;
  isActive: boolean;
  priorTime?: string;
  pattern:
    | 'anchor'
    | 'late_checkin'
    | 'weekend_drop'
    | 'low_regularity'
    | 'custom_improving'
    | 'cold_start'
    | 'archived';
}

export const DEMO_HABIT_TEMPLATES: readonly DemoHabitTemplate[] = [
  {
    title: 'Вітаміни та вода',
    category: "Здоров'я",
    frequencyType: 'daily',
    targetDays: [1, 2, 3, 4, 5, 6, 7],
    reminderTime: '08:30',
    historyDays: 45,
    isActive: true,
    pattern: 'anchor',
  },
  {
    title: 'Ранкова пробіжка',
    category: 'Спорт',
    frequencyType: 'daily',
    targetDays: [1, 2, 3, 4, 5, 6, 7],
    reminderTime: '07:00',
    priorTime: '06:30',
    historyDays: 45,
    isActive: true,
    pattern: 'late_checkin',
  },
  {
    title: 'Практика англійської',
    category: 'Навчання',
    frequencyType: 'daily',
    targetDays: [1, 2, 3, 4, 5, 6, 7],
    reminderTime: '19:00',
    historyDays: 45,
    isActive: true,
    pattern: 'weekend_drop',
  },
  {
    title: 'Читання фахової літератури',
    category: 'Саморозвиток',
    frequencyType: 'daily',
    targetDays: [1, 2, 3, 4, 5, 6, 7],
    reminderTime: '21:30',
    historyDays: 42,
    isActive: true,
    pattern: 'low_regularity',
  },
  {
    title: 'Алгоритмічні задачі',
    category: 'Робота',
    frequencyType: 'custom',
    targetDays: [1, 3, 5],
    reminderTime: '16:00',
    historyDays: 45,
    isActive: true,
    pattern: 'custom_improving',
  },
  {
    title: 'Дихальні вправи',
    category: "Здоров'я",
    frequencyType: 'daily',
    targetDays: [1, 2, 3, 4, 5, 6, 7],
    reminderTime: '12:30',
    historyDays: 5,
    isActive: true,
    pattern: 'cold_start',
  },
  {
    title: 'Вечірня розтяжка',
    category: 'Спорт',
    frequencyType: 'custom',
    targetDays: [2, 4, 6],
    reminderTime: '20:30',
    historyDays: 40,
    isActive: false,
    pattern: 'archived',
  },
];

export function prepareDemoLocalState(userId: string): void {
  try {
    const customKey = `hf_custom_categories_${userId}`;
    const existingRaw = localStorage.getItem(customKey);
    const parsed = existingRaw ? JSON.parse(existingRaw) : [];
    const categories = Array.isArray(parsed) ? parsed.map(String) : [];
    if (!categories.includes('Саморозвиток')) {
      categories.push('Саморозвиток');
      localStorage.setItem(customKey, JSON.stringify(categories));
    }

    const prefix = `hf_yesterday_dismissed_${userId}_`;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        localStorage.removeItem(key);
      }
    }
  } catch {}
}

export function buildDemoHabitBundle(
  userId: string,
  today: Date,
  nextId: (kind: 'habits' | 'habit_logs') => string,
  calculateStreakFn: (habit: Habit, completedDates: Set<string>, refDate: Date) => number
): { habits: Habit[]; logs: HabitLog[] } {
  const createdHabits: Habit[] = [];
  const createdLogs: HabitLog[] = [];

  for (let hIdx = 0; hIdx < DEMO_HABIT_TEMPLATES.length; hIdx++) {
    const tpl = DEMO_HABIT_TEMPLATES[hIdx];
    const habitId = nextId('habits');
    const createdDate = new Date(today);
    createdDate.setDate(today.getDate() - tpl.historyDays);
    const createdTimestamp = Timestamp.fromDate(createdDate);

    const scheduleHistory: ScheduleHistoryEntry[] = [
      {
        changedAt: createdTimestamp,
        oldTime: tpl.priorTime ?? tpl.reminderTime,
        oldDays: tpl.targetDays,
      },
    ];
    if (tpl.priorTime) {
      const shiftedDate = new Date(today);
      shiftedDate.setDate(today.getDate() - 25);
      scheduleHistory.push({
        changedAt: Timestamp.fromDate(shiftedDate),
        oldTime: tpl.reminderTime,
        oldDays: tpl.targetDays,
      });
    }

    const [plannedH, plannedM] = tpl.reminderTime.split(':').map(Number);
    const completedDates = new Set<string>();

    for (let offset = 0; offset <= tpl.historyDays; offset++) {
      const d = new Date(today);
      d.setDate(today.getDate() - offset);
      const isoDay = d.getDay() === 0 ? 7 : d.getDay();
      const isScheduled = tpl.frequencyType === 'daily' || tpl.targetDays.includes(isoDay);
      if (!isScheduled) {
        continue;
      }

      const isWeekend = isoDay === 6 || isoDay === 7;
      const seed = (hIdx * 37 + offset * 23 + isoDay * 11) % 100;

      if (!shouldSeedDay(tpl.pattern, isWeekend, isoDay, seed, offset)) {
        continue;
      }

      const delayMinutes = computeDemoDelay(tpl.pattern, seed, offset);
      const completedDate = new Date(d);
      const totalMins = Math.min(23 * 60 + 50, plannedH * 60 + plannedM + delayMinutes);
      completedDate.setHours(Math.floor(totalMins / 60), totalMins % 60, 0, 0);

      const logId = nextId('habit_logs');
      const completedTs = Timestamp.fromDate(completedDate);
      const targetDate = formatIsoDate(d);
      completedDates.add(targetDate);

      createdLogs.push({
        idLog: logId,
        idHabit: habitId,
        idUser: userId,
        targetDate,
        completedAt: completedTs,
        plannedTime: tpl.reminderTime,
        delayMinutes,
      });
    }

    const tempHabit: Habit = {
      idHabit: habitId,
      idUser: userId,
      title: tpl.title,
      category: tpl.category,
      frequencyType: tpl.frequencyType,
      targetDays: tpl.targetDays,
      reminderTime: tpl.reminderTime,
      scheduleHistory,
      currentStreak: 0,
      bestStreak: 0,
      isActive: tpl.isActive,
      createdAt: createdTimestamp,
    };

    const currentStreak = calculateStreakFn(tempHabit, completedDates, today);
    const bestStreak = Math.max(
      currentStreak,
      calculateBestStreak(tempHabit, completedDates, today, tpl.historyDays)
    );

    createdHabits.push({
      ...tempHabit,
      currentStreak,
      bestStreak,
    });
  }

  return { habits: createdHabits, logs: createdLogs };
}

function calculateBestStreak(
  habit: Habit,
  completedDates: Set<string>,
  referenceDate: Date,
  windowDays: number
): number {
  let best = 0;
  let current = 0;
  for (let offset = windowDays; offset >= 1; offset--) {
    const d = new Date(referenceDate);
    d.setDate(referenceDate.getDate() - offset);
    const isoDay = d.getDay() === 0 ? 7 : d.getDay();
    const isScheduled = habit.frequencyType === 'daily' || habit.targetDays.includes(isoDay);
    if (!isScheduled) continue;

    if (completedDates.has(formatIsoDate(d))) {
      current++;
      if (current > best) best = current;
    } else {
      current = 0;
    }
  }
  return best;
}

function shouldSeedDay(
  pattern: DemoHabitTemplate['pattern'],
  isWeekend: boolean,
  isoDay: number,
  seed: number,
  offset: number
): boolean {
  if (pattern === 'anchor') {
    if (offset <= 16) return true;
    return seed >= 8;
  }
  if (pattern === 'late_checkin') {
    if (
      offset === 0 ||
      offset === 1 ||
      offset === 3 ||
      offset === 5 ||
      offset === 6 ||
      offset === 9 ||
      offset === 12
    ) {
      return false;
    }
    if (offset <= 14) return seed >= 30;
    return seed >= 18;
  }
  if (pattern === 'weekend_drop') {
    if (offset === 0 || isWeekend) return false;
    if (offset <= 6 && (isoDay === 2 || isoDay === 4)) return false;
    if (offset > 14) return seed >= 10;
    return true;
  }
  if (pattern === 'low_regularity') {
    if (
      offset === 0 ||
      offset === 1 ||
      offset === 2 ||
      offset === 4 ||
      offset === 5 ||
      offset === 6 ||
      offset === 8 ||
      offset === 11 ||
      offset === 13
    ) {
      return false;
    }
    if (isWeekend && offset <= 14) return isoDay === 6;
    if (offset <= 14) return true;
    return seed >= 14;
  }
  if (pattern === 'custom_improving') {
    if (offset === 0) return false;
    if (offset <= 18) return true;
    return seed >= 44;
  }
  if (pattern === 'cold_start') {
    return offset !== 2;
  }
  return offset > 7 && seed >= 35;
}

function computeDemoDelay(
  pattern: DemoHabitTemplate['pattern'],
  seed: number,
  offset: number
): number {
  if (pattern === 'late_checkin') {
    return 78 + ((seed + offset * 7) % 34);
  }
  if (pattern === 'weekend_drop') {
    return 22 + (seed % 7);
  }
  if (pattern === 'low_regularity') {
    return 21 + (seed % 8);
  }
  if (pattern === 'custom_improving') {
    return 8 + ((seed * 3) % 28);
  }
  if (pattern === 'anchor') {
    return 2 + (seed % 7);
  }
  if (pattern === 'cold_start') {
    return 4 + (seed % 9);
  }
  return 10 + (seed % 20);
}
