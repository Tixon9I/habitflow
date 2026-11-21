from __future__ import annotations

from datetime import date, timedelta

from fastapi.testclient import TestClient

from app.main import create_app

REF_DATE = date(2026, 11, 19)


def test_health_endpoint() -> None:
    client = TestClient(create_app())
    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["modelLoaded"] is True
    assert "f1Score" in body["modelMetrics"]
    assert "precision" in body["modelMetrics"]


def test_analyze_endpoint_contract_and_latency() -> None:
    client = TestClient(create_app())
    created_at = (REF_DATE - timedelta(days=29)).isoformat() + "T08:00:00Z"

    logs = []
    for offset in range(30):
        target = REF_DATE - timedelta(days=offset)
        if offset in (1, 4, 7, 11):
            continue
        logs.append(
            {
                "idLog": f"log_{offset}",
                "idHabit": "habit_read",
                "idUser": "user_42",
                "targetDate": target.isoformat(),
                "completedAt": f"{target.isoformat()}T21:40:00Z",
                "plannedTime": "21:00",
                "delayMinutes": 40,
            }
        )

    payload = {
        "idUser": "user_42",
        "aiConsent": False,
        "notificationLimit": 3,
        "referenceDate": REF_DATE.isoformat(),
        "habits": [
            {
                "idHabit": "habit_read",
                "idUser": "user_42",
                "title": "Читання 20 хв",
                "category": "Навчання",
                "frequencyType": "daily",
                "targetDays": [1, 2, 3, 4, 5, 6, 7],
                "reminderTime": "21:00",
                "scheduleHistory": [],
                "currentStreak": 1,
                "bestStreak": 9,
                "isActive": True,
                "createdAt": created_at,
            }
        ],
        "habitLogs": logs,
    }

    response = client.post("/api/analyze", json=payload)
    assert response.status_code == 200

    body = response.json()
    assert body["coldStartHabitIds"] == []
    assert body["inferenceTimeMs"] <= 500.0
    assert len(body["recommendations"]) == 1

    rec = body["recommendations"][0]
    assert rec["idHabit"] == "habit_read"
    assert rec["idUser"] == "user_42"
    assert 0.0 <= rec["riskScore"] <= 1.0
    assert rec["riskLevel"] in ("low", "medium", "high")
    assert rec["mainFactor"] in ("late_checkin", "weekend_drop", "low_regularity")
    assert rec["status"] == "pending"
    assert len(rec["explanationText"]) > 15


def test_cold_start_habit_is_flagged() -> None:
    client = TestClient(create_app())
    recent_created = (REF_DATE - timedelta(days=4)).isoformat() + "T08:00:00Z"

    payload = {
        "idUser": "user_42",
        "aiConsent": False,
        "referenceDate": REF_DATE.isoformat(),
        "habits": [
            {
                "idHabit": "habit_new",
                "idUser": "user_42",
                "title": "Медитація",
                "category": "Здоров'я",
                "frequencyType": "daily",
                "targetDays": [1, 2, 3, 4, 5, 6, 7],
                "reminderTime": "09:00",
                "scheduleHistory": [],
                "currentStreak": 3,
                "bestStreak": 3,
                "isActive": True,
                "createdAt": recent_created,
            }
        ],
        "habitLogs": [
            {
                "idLog": "log_new_1",
                "idHabit": "habit_new",
                "idUser": "user_42",
                "targetDate": REF_DATE.isoformat(),
                "completedAt": f"{REF_DATE.isoformat()}T09:05:00Z",
                "plannedTime": "09:00",
                "delayMinutes": 5,
            }
        ],
    }

    response = client.post("/api/analyze", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["recommendations"] == []
    assert body["coldStartHabitIds"] == ["habit_new"]
