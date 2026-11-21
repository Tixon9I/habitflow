import { Timestamp } from '@angular/fire/firestore';

export interface User {
  idUser: string;
  email: string;
  displayName: string;
  timezone: string;
  notificationLimit: number;
  aiConsent: boolean;
  createdAt: Timestamp | null;
}

export type FrequencyType = 'daily' | 'custom';

export interface ScheduleHistoryEntry {
  changedAt: Timestamp;
  oldTime: string;
  oldDays: number[];
}

export interface Habit {
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
  createdAt: Timestamp | null;
}

export interface HabitLog {
  idLog: string;
  idHabit: string;
  idUser: string;
  targetDate: string;
  completedAt: Timestamp | null;
  plannedTime: string;
  delayMinutes: number;
}

export type RiskLevel = 'low' | 'medium' | 'high';
export type MainFactor = 'late_checkin' | 'weekend_drop' | 'low_regularity';
export type RecStatus = 'pending' | 'accepted' | 'dismissed';

export interface Recommendation {
  idRecommendation: string;
  idHabit: string;
  idUser: string;
  riskScore: number;
  riskLevel: RiskLevel;
  mainFactor: MainFactor;
  suggestedTime: string;
  suggestedFrequency: number;
  explanationText: string;
  status: RecStatus;
  generatedAt: Timestamp | null;
}

export interface AnalyzeRequest {
  idUser: string;
  aiConsent: boolean;
  notificationLimit: number;
  referenceDate: string;
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
