from __future__ import annotations

import asyncio
import contextlib
from datetime import datetime

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import APP_NAME, CORS_ORIGINS, DATA_DIR, ENV, VERSION
from .database import Base, SessionLocal, engine
from .routers import (
    admin,
    ai,
    auth,
    dashboard,
    documents,
    institutions,
    instruments,
    ledger,
    public,
    reminders,
    reports,
    requests as requests_router,
)

DESCRIPTION = """
Prototype for the AICTE Regulation Bureau hackathon.

* OCR -> BERT extraction pipeline with per-field confidence
* AES-256-GCM field and document encryption
* SHA-256 hash-chained, Ed25519-signed audit ledger
* Role-based access, TOTP MFA for officers, 30-minute idle timeout
"""


def _scheduler_loop(interval_seconds: int = 300):
    async def runner():
        from .services.scheduler import run_cycle

        await asyncio.sleep(8)
        while True:
            try:
                await asyncio.to_thread(_run_cycle_once)
            except Exception:
                pass
            await asyncio.sleep(interval_seconds)

    def _run_cycle_once():
        db = SessionLocal()
        try:
            run_cycle(db)
        finally:
            db.close()

    return runner()


def create_app() -> FastAPI:
    app = FastAPI(
        title=APP_NAME,
        version=VERSION,
        description=DESCRIPTION,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=CORS_ORIGINS,
        allow_origin_regex=r"^https?://((localhost|127\.0\.0\.1)(:[0-9]+)?|.*\.vercel\.app|.*\.railway\.app|.*\.onrender\.com)$",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition", "X-Document-Integrity"],
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(self), geolocation=(), microphone=()"
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self' 'unsafe-inline' data: blob: https:; "
            "img-src 'self' data: blob: https:; "
            "style-src 'self' 'unsafe-inline' https:; "
            "script-src 'self' 'unsafe-inline' https:; "
            "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* https://*.vercel.app https://*.supabase.co wss://*.supabase.co https:; "
            "font-src 'self' data: https:; "
            "frame-ancestors 'none'",
        )
        if request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_request: Request, exc: StarletteHTTPException):
        detail = exc.detail
        if isinstance(detail, dict):
            return JSONResponse(status_code=exc.status_code, content={"error": detail, "detail": detail})
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": f"http_{exc.status_code}", "message": str(detail)}, "detail": detail},
        )

    for module in (
        auth, institutions, instruments, documents, requests_router, reminders,
        dashboard, ledger, reports, public, admin, ai,
    ):
        app.include_router(module.router)

    @app.get("/api/health", tags=["system"])
    def health():
        return {
            "status": "ok",
            "app": APP_NAME,
            "version": VERSION,
            "environment": ENV,
            "time": datetime.utcnow().isoformat() + "Z",
        }

    @app.get("/api/security/headers", tags=["system"])
    def header_policy():
        return {
            "headers": [
                "Content-Security-Policy", "Strict-Transport-Security (HTTPS only)",
                "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy",
                "Permissions-Policy", "Cross-Origin-Opener-Policy",
            ],
            "session": "JWT with 30-minute idle timeout",
            "note": "Documents are served with Cache-Control: no-store and an integrity header.",
        }

    dist = DATA_DIR.parent.parent / "frontend" / "dist"
    if dist.exists():
        app.mount("/", StaticFiles(directory=str(dist), html=True), name="spa")

    return app


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    from .seed import seed_if_empty

    Base.metadata.create_all(bind=engine)
    seed_if_empty()
    task = asyncio.create_task(_scheduler_loop())
    try:
        yield
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


app = create_app()
app.router.lifespan_context = lifespan
