from __future__ import annotations

import sys
from pathlib import Path

root_dir = Path(__file__).resolve().parent.parent
backend_dir = root_dir / "backend"
for p in (str(backend_dir), str(root_dir)):
    if p not in sys.path:
        sys.path.insert(0, p)

from app.main import app, ensure_database_initialized  # noqa: E402

# Ensure tables and initial seed data exist on Vercel cold starts without requiring ASGI lifespan
ensure_database_initialized()
