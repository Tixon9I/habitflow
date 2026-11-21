// ============================================================
// HabitFlow — TypeScript моделі (точна відповідність Firestore)
// Розділ 2 пояснювальної записки: 4 плоскі колекції
// ============================================================

import { Timestamp } from '@angular/fire/firestore';

// ── users ────────────────────────────────────────────────────
export interface User {
  idUser: string;
  email: string;
  displayName: string;
  timezone: string;
  notificationLimit: number;   // default 3
  aiConsent: boolean;
  createdAt: Timestamp | null;
}

// ── habits ───────────────────────────────────────────────────
export type FrequencyType = 'daily' | 'custom';

export interface ScheduleHistoryEntry {
  changedAt: Timestamp;
  oldTime: string;    // 'HH:mm'
  oldDays: number[];  // ISO weekday 1..7
}

export interface Habit {
  idHabit: string;
  idUser: string;
  title: string;
  category: string;
  frequencyType: FrequencyType;
  targetDays: number[];         // ISO weekday 1..7
  reminderTime: string;         // 'HH:mm'
  scheduleHistory: ScheduleHistoryEntry[];
  currentStreak: number;
  bestStreak: number;
  isActive: boolean;
  createdAt: Timestamp | null;
}

// ── habit_logs ───────────────────────────────────────────────
export interface HabitLog {
  idLog: string;
  idHabit: string;
  idUser: string;
  targetDate: string;      // 'YYYY-MM-DD'
  completedAt: Timestamp | null;
  plannedTime: string;     // 'HH:mm'
  delayMinutes: number;    // >= 0 (від'ємні прирівнюються до 0 на бекенді)
}

// ── recommendations ──────────────────────────────────────────
export type RiskLevel     = 'low' | 'medium' | 'high';
export type MainFactor    = 'late_checkin' | 'weekend_drop' | 'low_regularity';
export type RecStatus     = 'pending' | 'accepted' | 'dismissed';

export interface Recommendation {
  idRecommendation: string;
  idHabit: string;
  idUser: string;
  riskScore: number;        // 0..1
  riskLevel: RiskLevel;
  mainFactor: MainFactor;
  suggestedTime: string;    // 'HH:mm'
  suggestedFrequency: number; // int, напр. 5 для Пн–Пт
  explanationText: string;  // українською
  status: RecStatus;
  generatedAt: Timestamp | null;
}

// ── ML API DTO (для запиту до localhost:8000) ─────────────────
export interface AnalyzeRequest {
  idUser: string;
  aiConsent: boolean;
  notificationLimit: number;
  referenceDate: string;     // 'YYYY-MM-DD'
  habits: HabitApiDto[];
  habitLogs: HabitLogApiDto[];
}

export interface HabitApiDto {
  idHabit: string;
  idUser: string;
  title: string;
  category: string;
  frequencyType: FrequencyType;
  targetDays: number[];
  reminderTime: string;
  scheduleHistory: ScheduleHistoryEntry[];
  currentStreak: number;
  bestStreak: number;
  isActive: boolean;
  createdAt: string | null;
}

export interface HabitLogApiDto {
  idLog: string;
  idHabit: string;
  idUser: string;
  targetDate: string;
  completedAt: string | null;
  plannedTime: string;
  delayMinutes: number;
}

export interface AnalyzeResponse {
  recommendations: Recommendation[];
  coldStartHabitIds: string[];
  inferenceTimeMs: number;
  usedFallbackAdvice: boolean;
}
