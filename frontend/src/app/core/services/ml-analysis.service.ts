import { Injectable, inject, signal } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  deleteDoc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  Timestamp,
} from '@angular/fire/firestore';
import { Observable, map, shareReplay } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  AnalyzeRequest,
  AnalyzeResponse,
  Habit,
  HabitApiDto,
  HabitLog,
  HabitLogApiDto,
  MainFactor,
  Recommendation,
  RiskLevel,
} from '../models/habit.model';
import { AuthService } from './auth.service';
import { HabitService } from './habit.service';
import { getZonedTodayDate } from '../utils/date-time.util';

export interface MlHealthStatus {
  online: boolean;
  usedFallback: boolean;
  lastInferenceMs: number | null;
}

const RECOMMENDATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ANALYZE_TIMEOUT_MS = 3000;

@Injectable({ providedIn: 'root' })
export class MlAnalysisService {
  private readonly fs = inject(Firestore);
  private readonly auth = inject(AuthService);
  private readonly habitService = inject(HabitService);
  private readonly recsCache = new Map<string, Observable<Recommendation[]>>();

  readonly healthStatus = signal<MlHealthStatus>({
    online: false,
    usedFallback: false,
    lastInferenceMs: null,
  });

  clearCache(): void {
    this.recsCache.clear();
  }

  private isRemoteHostWithLocalBackend(): boolean {
    if (typeof window === 'undefined') return false;
    const host = window.location.hostname;
    const isLocalHost = host === 'localhost' || host === '127.0.0.1';
    const isLocalBackend =
      environment.mlServiceUrl.includes('localhost') ||
      environment.mlServiceUrl.includes('127.0.0.1');
    return !isLocalHost && isLocalBackend;
  }

  async checkHealth(): Promise<boolean> {
    if (this.isRemoteHostWithLocalBackend()) {
      this.healthStatus.update((prev) => ({ ...prev, online: false }));
      return false;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    try {
      const res = await fetch(`${environment.mlServiceUrl}/health`, {
        method: 'GET',
        signal: controller.signal,
      });
      const online = res.ok;
      this.healthStatus.update((prev) => ({ ...prev, online }));
      return online;
    } catch {
      this.healthStatus.update((prev) => ({ ...prev, online: false }));
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  getRecommendations(userId: string): Observable<Recommendation[]> {
    let stream = this.recsCache.get(userId);
    if (!stream) {
      const ref = collection(this.fs, 'recommendations');
      const q = query(ref, where('idUser', '==', userId));
      stream = (collectionData(q, { idField: 'idRecommendation' }) as Observable<Recommendation[]>).pipe(
        map((recs) =>
          recs
            .filter((rec) => rec.status !== 'pending' || this.isRecommendationFresh(rec))
            .sort((a, b) => b.riskScore - a.riskScore)
        ),
        shareReplay(1)
      );
      this.recsCache.set(userId, stream);
    }
    return stream;
  }

  isRecommendationFresh(rec: Recommendation): boolean {
    const ts = rec.generatedAt?.toMillis?.();
    if (typeof ts !== 'number') return true;
    return ts >= Date.now() - RECOMMENDATION_TTL_MS;
  }

  async analyzeHabits(
    habits: Habit[],
    logs: HabitLog[],
    limit = 3
  ): Promise<Recommendation[]> {
    const user = this.auth.currentUser();
    const activeHabits = habits.filter((h) => h.isActive);
    if (!user || activeHabits.length === 0) {
      return [];
    }

    const [pausedHabitIds, adaptedHabitIds] = await Promise.all([
      this.getPausedHabitIds(user.idUser),
      this.getRecentlyAdaptedHabitIds(user.idUser),
    ]);
    const eligibleHabits = activeHabits.filter(
      (h) => !pausedHabitIds.has(h.idHabit) && !adaptedHabitIds.has(h.idHabit)
    );
    if (eligibleHabits.length === 0) {
      await this.persistRecommendations(user.idUser, []);
      return [];
    }

    const todayStr = this.habitService.formatDate(getZonedTodayDate(user.timezone));
    let results: Recommendation[] = [];
    let usedFallback = false;

    const payload: AnalyzeRequest = {
      idUser: user.idUser,
      aiConsent: user.aiConsent,
      notificationLimit: limit,
      referenceDate: todayStr,
      habits: eligibleHabits.map((h) => this.toHabitApiDto(h)),
      habitLogs: logs.map((l) => this.toHabitLogApiDto(l)),
    };

    if (this.isRemoteHostWithLocalBackend()) {
      usedFallback = true;
      this.healthStatus.set({
        online: false,
        usedFallback: true,
        lastInferenceMs: null,
      });
      results = eligibleHabits.map((h) => this.runLocalFallback(h, logs));
    } else {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), ANALYZE_TIMEOUT_MS);
        try {
          const response = await fetch(`${environment.mlServiceUrl}/api/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const data = (await response.json()) as AnalyzeResponse;
          this.healthStatus.set({
            online: true,
            usedFallback: data.usedFallbackAdvice,
            lastInferenceMs: data.inferenceTimeMs,
          });

          const apiRecs = data.recommendations.map((rec) => ({
            ...rec,
            generatedAt: Timestamp.now(),
          }));

          const coldStartSet = new Set(data.coldStartHabitIds);
          const coldStartRecs = eligibleHabits
            .filter((h) => coldStartSet.has(h.idHabit))
            .map((h) => this.runLocalFallback(h, logs));

          results = [...apiRecs, ...coldStartRecs];
        } finally {
          clearTimeout(timer);
        }
      } catch {
        usedFallback = true;
        this.healthStatus.set({
          online: false,
          usedFallback: true,
          lastInferenceMs: null,
        });
        results = eligibleHabits.map((h) => this.runLocalFallback(h, logs));
      }
    }

    const actionable = results
      .filter((r) => r.riskScore >= 0.6)
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, Math.max(1, limit));

    await this.persistRecommendations(user.idUser, actionable);
    if (usedFallback) {
      this.healthStatus.update((prev) => ({ ...prev, usedFallback: true }));
    }

    return actionable;
  }

  runLocalFallback(habit: Habit, logs: HabitLog[]): Recommendation {
    const today = getZonedTodayDate(this.auth.currentUser()?.timezone);
    const cutoffDate = new Date(today);
    cutoffDate.setDate(today.getDate() - 29);
    const cutoff30d = this.habitService.formatDate(cutoffDate);

    const habitLogs = logs.filter(
      (l) => l.idHabit === habit.idHabit && l.targetDate >= cutoff30d
    );
    const completedDates = new Set(habitLogs.map((l) => l.targetDate));

    const missRate7d = this.calcMissRate(habit, completedDates, today, 7);
    const missRate14d = this.calcMissRate(habit, completedDates, today, 14);
    const weekendMissRate = this.calcWeekendMissRate(habit, completedDates, today, 30);

    const delays = habitLogs.map((l) => Math.max(0, l.delayMinutes));
    const meanDelay =
      delays.length > 0 ? delays.reduce((sum, v) => sum + v, 0) / delays.length : 0;
    const medianDelay = this.calcMedian(delays);

    const baseScore =
      0.42 * (Math.min(meanDelay, 90) / 90) +
      0.31 * missRate7d +
      0.18 * weekendMissRate +
      0.09 * (1 - Math.min(habit.currentStreak, 14) / 14);

    let patternScore = 0;
    if (meanDelay >= 30 && medianDelay > 15) {
      patternScore = Math.max(
        patternScore,
        0.44 + 0.3 * (Math.min(meanDelay, 120) / 120) + 0.2 * missRate7d
      );
    }
    if (weekendMissRate - missRate14d >= 0.25 && weekendMissRate >= 0.5) {
      patternScore = Math.max(
        patternScore,
        0.45 + 0.3 * weekendMissRate + 0.15 * missRate14d
      );
    }
    if (missRate7d >= 0.5 && missRate14d >= 0.4) {
      patternScore = Math.max(
        patternScore,
        0.38 + 0.35 * missRate7d + 0.2 * missRate14d
      );
    }

    const riskScore = Number(Math.min(1.0, Math.max(baseScore, patternScore)).toFixed(4));

    const riskLevel = this.classifyRiskLevel(riskScore);
    const mainFactor = this.identifyMainFactor(meanDelay, weekendMissRate, missRate14d);

    const suggestedTime =
      mainFactor === 'late_checkin' && medianDelay > 15
        ? this.shiftTimeByMinutes(habit.reminderTime, 15 * Math.round(medianDelay / 15))
        : habit.reminderTime;

    const currentDaysCount = habit.frequencyType === 'daily' ? 7 : habit.targetDays.length;
    const suggestedFrequency =
      mainFactor === 'weekend_drop' || mainFactor === 'low_regularity'
        ? currentDaysCount > 5
          ? 5
          : Math.max(2, currentDaysCount - 2)
        : currentDaysCount;

    const explanationText = this.buildFallbackExplanation(
      habit,
      riskScore,
      mainFactor,
      suggestedTime,
      suggestedFrequency,
      weekendMissRate
    );

    return {
      idRecommendation: `rec_${habit.idHabit}_${Date.now()}`,
      idHabit: habit.idHabit,
      idUser: habit.idUser,
      riskScore,
      riskLevel,
      mainFactor,
      suggestedTime,
      suggestedFrequency,
      explanationText,
      status: 'pending',
      generatedAt: Timestamp.now(),
    };
  }

  async applyRecommendation(rec: Recommendation, habit?: Habit): Promise<void> {
    await updateDoc(doc(this.fs, 'recommendations', rec.idRecommendation), {
      status: 'accepted',
      generatedAt: Timestamp.now(),
    });

    let targetHabit = habit;
    if (!targetHabit) {
      const snap = await getDoc(doc(this.fs, 'habits', rec.idHabit));
      if (snap.exists()) {
        targetHabit = { ...(snap.data() as Habit), idHabit: snap.id };
      }
    }

    if (targetHabit) {
      const nextTime =
        rec.mainFactor === 'late_checkin' ? rec.suggestedTime : targetHabit.reminderTime;
      const currentDaysCount =
        targetHabit.frequencyType === 'daily' ? 7 : targetHabit.targetDays.length;
      const nextDays =
        rec.mainFactor === 'weekend_drop' || rec.mainFactor === 'low_regularity'
          ? rec.suggestedFrequency <= 3 || currentDaysCount <= 5
            ? [1, 3, 5]
            : [1, 2, 3, 4, 5]
          : targetHabit.targetDays;

      await this.habitService.updateHabitSchedule(targetHabit, nextTime, nextDays, false);
    }
  }

  async dismissRecommendation(recId: string): Promise<boolean> {
    const recRef = doc(this.fs, 'recommendations', recId);
    const snap = await getDoc(recRef);
    await updateDoc(recRef, { status: 'dismissed' });

    if (!snap.exists()) return false;
    const rec = snap.data() as Recommendation;
    const paused = await this.getPausedHabitIds(rec.idUser);
    return paused.has(rec.idHabit);
  }

  private async getRecentlyAdaptedHabitIds(userId: string): Promise<Set<string>> {
    const ref = collection(this.fs, 'recommendations');
    const q = query(ref, where('idUser', '==', userId), where('status', '==', 'accepted'));
    const snap = await getDocs(q);

    const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const adapted = new Set<string>();

    for (const d of snap.docs) {
      const rec = d.data() as Recommendation;
      const ts = rec.generatedAt?.toMillis?.() ?? 0;
      if (ts >= sevenDaysAgoMs) {
        adapted.add(rec.idHabit);
      }
    }
    return adapted;
  }

  private async getPausedHabitIds(userId: string): Promise<Set<string>> {
    const ref = collection(this.fs, 'recommendations');
    const q = query(ref, where('idUser', '==', userId), where('status', '==', 'dismissed'));
    const snap = await getDocs(q);

    const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const countByHabit = new Map<string, number>();

    for (const d of snap.docs) {
      const rec = d.data() as Recommendation;
      const ts = rec.generatedAt?.toMillis?.() ?? 0;
      if (ts >= sevenDaysAgoMs) {
        countByHabit.set(rec.idHabit, (countByHabit.get(rec.idHabit) ?? 0) + 1);
      }
    }

    const paused = new Set<string>();
    for (const [habitId, count] of countByHabit.entries()) {
      if (count >= 2) {
        paused.add(habitId);
      }
    }
    return paused;
  }

  private async persistRecommendations(
    userId: string,
    recommendations: Recommendation[]
  ): Promise<void> {
    const ref = collection(this.fs, 'recommendations');
    const existingPendingSnap = await getDocs(
      query(ref, where('idUser', '==', userId), where('status', '==', 'pending'))
    );

    const newHabitIds = new Set(recommendations.map((r) => r.idHabit));
    const pendingByHabit = new Map<string, string>();

    for (const d of existingPendingSnap.docs) {
      const data = d.data() as Recommendation;
      if (!newHabitIds.has(data.idHabit)) {
        await deleteDoc(d.ref);
      } else {
        pendingByHabit.set(data.idHabit, d.id);
      }
    }

    for (const rec of recommendations) {
      const docId = pendingByHabit.get(rec.idHabit) ?? rec.idRecommendation;
      const payload: Recommendation = {
        ...rec,
        idRecommendation: docId,
        idUser: userId,
        status: 'pending',
        generatedAt: Timestamp.now(),
      };
      await setDoc(doc(this.fs, 'recommendations', docId), payload);
    }
  }

  private classifyRiskLevel(riskScore: number): RiskLevel {
    if (riskScore > 0.65) return 'high';
    if (riskScore >= 0.4) return 'medium';
    return 'low';
  }

  private identifyMainFactor(
    meanDelay: number,
    weekendMissRate: number,
    missRate14d: number
  ): MainFactor {
    if (meanDelay >= 30) return 'late_checkin';
    if (weekendMissRate - missRate14d >= 0.25) return 'weekend_drop';
    return 'low_regularity';
  }

  private calcMissRate(
    habit: Habit,
    completedDates: Set<string>,
    refDate: Date,
    windowDays: number
  ): number {
    let scheduled = 0;
    let completed = 0;

    for (let offset = 0; offset < windowDays; offset++) {
      const d = new Date(refDate);
      d.setDate(refDate.getDate() - offset);
      const isoDay = d.getDay() === 0 ? 7 : d.getDay();
      if (habit.frequencyType === 'daily' || habit.targetDays.includes(isoDay)) {
        scheduled++;
        if (completedDates.has(this.habitService.formatDate(d))) {
          completed++;
        }
      }
    }

    return scheduled > 0 ? (scheduled - completed) / scheduled : 0;
  }

  private calcWeekendMissRate(
    habit: Habit,
    completedDates: Set<string>,
    refDate: Date,
    windowDays: number
  ): number {
    let scheduled = 0;
    let completed = 0;

    for (let offset = 0; offset < windowDays; offset++) {
      const d = new Date(refDate);
      d.setDate(refDate.getDate() - offset);
      const isoDay = d.getDay() === 0 ? 7 : d.getDay();
      if ((isoDay === 6 || isoDay === 7) && (habit.frequencyType === 'daily' || habit.targetDays.includes(isoDay))) {
        scheduled++;
        if (completedDates.has(this.habitService.formatDate(d))) {
          completed++;
        }
      }
    }

    return scheduled > 0 ? (scheduled - completed) / scheduled : 0;
  }

  private calcMedian(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }

  private shiftTimeByMinutes(timeStr: string, deltaMinutes: number): string {
    const [h, m] = timeStr.split(':').map(Number);
    const base = h * 60 + m;
    const clamped = Math.max(6 * 60, Math.min(23 * 60, base + deltaMinutes));
    const newH = Math.floor(clamped / 60);
    const newM = clamped % 60;
    return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
  }

  private buildFallbackExplanation(
    habit: Habit,
    riskScore: number,
    mainFactor: MainFactor,
    suggestedTime: string,
    suggestedFrequency: number,
    weekendMissRate: number
  ): string {
    const riskPct = Math.round(riskScore * 100);
    if (mainFactor === 'late_checkin') {
      return `Для звички «${habit.title}» зафіксовано систематичні запізнення відміток (ризик пропуску ${riskPct}%). Перенесення нагадування з ${habit.reminderTime} на ${suggestedTime} краще відповідатиме фактичному вікну активності.`;
    }
    if (mainFactor === 'weekend_drop') {
      const weekendPct = Math.round(weekendMissRate * 100);
      return `Частка пропусків у суботу та неділю становить ${weekendPct}%, що перериває загальну серію. Рекомендуємо перейти на графік Пн–Пт (${suggestedFrequency} дн./тиж.).`;
    }
    return `За останні 14 днів регулярність звички «${habit.title}» знизилася (ризик пропуску ${riskPct}%). Спробуйте полегшити темп до ${suggestedFrequency} дн./тиж. із нагадуванням о ${suggestedTime}.`;
  }

  private toHabitApiDto(h: Habit): HabitApiDto {
    return {
      idHabit: h.idHabit,
      idUser: h.idUser,
      title: h.title,
      category: h.category,
      frequencyType: h.frequencyType,
      targetDays: h.targetDays,
      reminderTime: h.reminderTime,
      scheduleHistory: h.scheduleHistory ?? [],
      currentStreak: h.currentStreak,
      bestStreak: h.bestStreak,
      isActive: h.isActive,
      createdAt: h.createdAt?.toDate?.()?.toISOString() ?? null,
    };
  }

  private toHabitLogApiDto(l: HabitLog): HabitLogApiDto {
    return {
      idLog: l.idLog,
      idHabit: l.idHabit,
      idUser: l.idUser,
      targetDate: l.targetDate,
      completedAt: l.completedAt?.toDate?.()?.toISOString() ?? null,
      plannedTime: l.plannedTime,
      delayMinutes: Math.max(0, l.delayMinutes),
    };
  }
}
