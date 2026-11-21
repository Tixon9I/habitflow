# HabitFlow

> Вебзастосунок для аналізу та планування звичок із ШІ  
> Курсовий проєкт · Angular 18 + FastAPI + Firebase + Gemini API

## Структура проєкту

```
habitflow/
├── ml-service/          # Python 3.13 · FastAPI · scikit-learn · google-genai
│   ├── app/
│   │   ├── controllers/ # POST /api/analyze · GET /health
│   │   ├── models/      # RandomForestClassifier (n=100, depth=6)
│   │   ├── schemas/     # Pydantic v2 DTO
│   │   └── services/    # FeatureExtractor · HabitRiskPredictorService · AiExplanationService
│   └── tests/           # 8 тестів: 5 MR + 3 API
├── frontend/            # Angular 18 · Standalone · Signals · @angular/fire
│   └── src/app/
│       ├── core/        # models · services · guards
│       └── features/    # auth · dashboard · schedule-analysis · statistics
└── firebase/
    └── firestore.rules  # Правила доступу (власник документа)
```

## Запуск

### ML-сервіс
```bash
cd ml-service
python -m uvicorn app.main:app --reload
# → http://127.0.0.1:8000/health
```

### Angular frontend
```bash
cd frontend
npm install
ng serve
# → http://localhost:4200
```

### Тести ML
```bash
cd ml-service
python -m pytest tests/ -v
# → 8/8 passed
```

## Технічний стек

| Шар | Технологія |
|-----|-----------|
| Frontend | Angular 18 · TypeScript 5.4 · SCSS · Signals |
| Auth & DB | Firebase Authentication · Cloud Firestore |
| ML Backend | FastAPI · scikit-learn RF · Pydantic v2 |
| AI | Google Gemini `gemini-2.5-flash` (timeout 2s + fallback) |
| Тести | pytest · httpx · metamorphic testing (MR1–MR5) |

## 9 функціональних сценаріїв

1. Реєстрація з `aiConsent`  
2. Вхід / вихід (`authGuard`)  
3. Редагування профілю (`timezone`, `notificationLimit`, видалення акаунта)  
4. Створення звички (модалка)  
5. Редагування розкладу / архівація / видалення  
6. Щоденний чекін в 1 клік (розрахунок `delayMinutes`, стріки)  
7. Статистика (%, серії, діаграма, журнал)  
8. Аналіз ризиків (ML + локальний fallback)  
9. Прийняття/відхилення рекомендації (2 відхилення → пауза 7 днів)  
