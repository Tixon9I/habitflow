import { TestBed } from '@angular/core/testing';
import { Timestamp } from '@angular/fire/firestore';
import { of } from 'rxjs';
import { StatisticsService } from './statistics.service';
import { HabitService } from './habit.service';
import { Habit, HabitLog } from '../models/habit.model';

describe('StatisticsService', () => {
  let service: StatisticsService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        StatisticsService,
        { provide: HabitService, useValue: { getLogsByUser: () => of([]) } },
      ],
    });
    service = TestBed.inject(StatisticsService);
  });

  it('should compute completion rate accurately for daily habit', () => {
    const habit: Habit = {
      idHabit: 'h1',
      idUser: 'u1',
      title: 'Читання',
      category: 'Навчання',
      frequencyType: 'daily',
      targetDays: [1, 2, 3, 4, 5, 6, 7],
      reminderTime: '20:00',
      scheduleHistory: [],
      currentStreak: 5,
      bestStreak: 5,
      isActive: true,
      createdAt: null,
    };

    const today = new Date();
    const logs: HabitLog[] = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
        d.getDate()
      ).padStart(2, '0')}`;
      logs.push({
        idLog: `l${i}`,
        idHabit: 'h1',
        idUser: 'u1',
        targetDate: iso,
        completedAt: null,
        plannedTime: '20:00',
        delayMinutes: 10,
      });
    }

    const rate = service.calculateCompletionRate(habit, logs, 10);
    expect(rate).toBeCloseTo(0.5, 2);
  });

  it('should build 7-day weekly chart items', () => {
    const result = service.buildWeeklyChartData([], [], 7);
    expect(result.length).toBe(7);
    expect(result[0].day).toBe('Пн');
    expect(result[6].day).toBe('Нд');
    expect(result[5].isWeekend).toBeTrue();
  });

  it('should not penalize completion rate for days prior to habit createdAt', () => {
    const today = new Date();
    const createdDate = new Date(today);
    createdDate.setDate(today.getDate() - 4);

    const habit: Habit = {
      idHabit: 'h_new',
      idUser: 'u1',
      title: 'Дихальні вправи',
      category: "Здоров'я",
      frequencyType: 'daily',
      targetDays: [1, 2, 3, 4, 5, 6, 7],
      reminderTime: '12:30',
      scheduleHistory: [],
      currentStreak: 4,
      bestStreak: 4,
      isActive: true,
      createdAt: Timestamp.fromDate(createdDate),
    };

    const logs: HabitLog[] = [];
    for (let i = 0; i < 4; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
        d.getDate()
      ).padStart(2, '0')}`;
      logs.push({
        idLog: `ln_${i}`,
        idHabit: 'h_new',
        idUser: 'u1',
        targetDate: iso,
        completedAt: null,
        plannedTime: '12:30',
        delayMinutes: 5,
      });
    }

    const rate = service.calculateCompletionRate(habit, logs, 30);
    expect(rate).toBeCloseTo(0.8, 2);
  });
});
