import { TestBed } from '@angular/core/testing';
import { Firestore, Timestamp } from '@angular/fire/firestore';
import { MlAnalysisService } from './ml-analysis.service';
import { AuthService } from './auth.service';
import { HabitService } from './habit.service';
import { Habit, HabitLog, Recommendation } from '../models/habit.model';

describe('MlAnalysisService', () => {
  let service: MlAnalysisService;

  const formatDate = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')}`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        MlAnalysisService,
        { provide: Firestore, useValue: {} },
        { provide: AuthService, useValue: { currentUser: () => null } },
        { provide: HabitService, useValue: { formatDate } },
      ],
    });
    service = TestBed.inject(MlAnalysisService);
  });

  it('should identify late_checkin and shift suggestedTime by 15-min step', () => {
    const habit: Habit = {
      idHabit: 'h_run',
      idUser: 'u1',
      title: 'Ранкова пробіжка',
      category: 'Спорт',
      frequencyType: 'daily',
      targetDays: [1, 2, 3, 4, 5, 6, 7],
      reminderTime: '07:30',
      scheduleHistory: [],
      currentStreak: 1,
      bestStreak: 3,
      isActive: true,
      createdAt: null,
    };

    const today = new Date();
    const logs: HabitLog[] = [];
    for (let offset = 1; offset <= 10; offset++) {
      const d = new Date(today);
      d.setDate(today.getDate() - offset);
      logs.push({
        idLog: `log_${offset}`,
        idHabit: 'h_run',
        idUser: 'u1',
        targetDate: formatDate(d),
        completedAt: null,
        plannedTime: '07:30',
        delayMinutes: 60,
      });
    }

    const rec = service.runLocalFallback(habit, logs);
    expect(rec.mainFactor).toBe('late_checkin');
    expect(rec.suggestedTime).toBe('08:30');
    expect(rec.riskScore).toBeGreaterThan(0.35);
    expect(rec.riskScore).toBeLessThanOrEqual(1.0);
  });

  it('should clamp negative delayMinutes to 0 in fallback calculation', () => {
    const habit: Habit = {
      idHabit: 'h_vit',
      idUser: 'u1',
      title: 'Вітаміни',
      category: "Здоров'я",
      frequencyType: 'daily',
      targetDays: [1, 2, 3, 4, 5, 6, 7],
      reminderTime: '09:00',
      scheduleHistory: [],
      currentStreak: 14,
      bestStreak: 14,
      isActive: true,
      createdAt: null,
    };

    const today = new Date();
    const logs: HabitLog[] = [];
    for (let offset = 0; offset < 30; offset++) {
      const d = new Date(today);
      d.setDate(today.getDate() - offset);
      logs.push({
        idLog: `log_${offset}`,
        idHabit: 'h_vit',
        idUser: 'u1',
        targetDate: formatDate(d),
        completedAt: null,
        plannedTime: '09:00',
        delayMinutes: -15,
      });
    }

    const rec = service.runLocalFallback(habit, logs);
    expect(rec.riskScore).toBe(0);
    expect(rec.riskLevel).toBe('low');
    expect(rec.suggestedTime).toBe('09:00');
  });

  it('should expire pending recommendations older than 7 days TTL', () => {
    const baseRec: Recommendation = {
      idRecommendation: 'rec_1',
      idHabit: 'h_1',
      idUser: 'u1',
      riskScore: 0.75,
      riskLevel: 'high',
      mainFactor: 'late_checkin',
      suggestedTime: '08:30',
      suggestedFrequency: 7,
      explanationText: 'Тестова порада',
      status: 'pending',
      generatedAt: Timestamp.fromMillis(Date.now() - 2 * 24 * 60 * 60 * 1000),
    };

    const expiredRec: Recommendation = {
      ...baseRec,
      idRecommendation: 'rec_old',
      generatedAt: Timestamp.fromMillis(Date.now() - 8 * 24 * 60 * 60 * 1000),
    };

    expect(service.isRecommendationFresh(baseRec)).toBeTrue();
    expect(service.isRecommendationFresh(expiredRec)).toBeFalse();
  });

  it('should generate actionable weekend_drop recommendation (>= 0.60) in local fallback mode', () => {
    const habit: Habit = {
      idHabit: 'h_eng',
      idUser: 'u1',
      title: 'Практика англійської',
      category: 'Навчання',
      frequencyType: 'daily',
      targetDays: [1, 2, 3, 4, 5, 6, 7],
      reminderTime: '19:00',
      scheduleHistory: [],
      currentStreak: 2,
      bestStreak: 5,
      isActive: true,
      createdAt: null,
    };

    const today = new Date();
    const logs: HabitLog[] = [];
    for (let offset = 0; offset < 30; offset++) {
      const d = new Date(today);
      d.setDate(today.getDate() - offset);
      const isoDay = d.getDay() === 0 ? 7 : d.getDay();
      if (isoDay === 6 || isoDay === 7) continue;
      logs.push({
        idLog: `log_eng_${offset}`,
        idHabit: 'h_eng',
        idUser: 'u1',
        targetDate: formatDate(d),
        completedAt: null,
        plannedTime: '19:00',
        delayMinutes: 8,
      });
    }

    const rec = service.runLocalFallback(habit, logs);
    expect(rec.mainFactor).toBe('weekend_drop');
    expect(rec.suggestedFrequency).toBe(5);
    expect(rec.riskScore).toBeGreaterThanOrEqual(0.6);
  });
});
