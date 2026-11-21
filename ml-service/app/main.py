from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.controllers.analyze_controller import AnalyzeController


def create_app() -> FastAPI:
    app = FastAPI(
        title="HabitFlow ML Service",
        description="Підсистема ШІ для прогнозування ризику пропуску звичок та адаптації розкладу.",
        version="1.0.0",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    controller = AnalyzeController()
    app.include_router(controller.router)
    return app


app = create_app()
