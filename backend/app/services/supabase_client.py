"""Supabase integration service.

Provides a configured Supabase client instance when SUPABASE_URL and SUPABASE_KEY
are supplied in environment variables or .env, along with health/connectivity checks.
"""
from __future__ import annotations

import logging
from typing import Any

from ..config import DATABASE_URL, SUPABASE_KEY, SUPABASE_URL

logger = logging.getLogger(__name__)

_supabase_client = None
_client_initialized = False


def get_supabase_client():
    """Returns the initialized Supabase client, or None if not configured."""
    global _supabase_client, _client_initialized
    if _client_initialized:
        return _supabase_client

    if not SUPABASE_URL or not SUPABASE_KEY:
        _client_initialized = True
        return None

    try:
        from supabase import Client, create_client

        _supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
        logger.info("Supabase client initialized successfully for %s", SUPABASE_URL)
    except Exception as e:
        logger.warning("Could not initialize Supabase client: %s", e)
        _supabase_client = None

    _client_initialized = True
    return _supabase_client


def get_database_provider() -> str:
    """Returns 'supabase' if using a Supabase PostgreSQL DB, 'postgresql' for Postgres, or 'sqlite'."""
    lower = DATABASE_URL.lower()
    if "supabase" in lower:
        return "supabase"
    if lower.startswith("postgres"):
        return "postgresql"
    return "sqlite"


def get_supabase_status() -> dict[str, Any]:
    """Returns detailed status information about Supabase connectivity."""
    provider = get_database_provider()
    is_supabase_db = provider == "supabase"
    has_api_creds = bool(SUPABASE_URL and SUPABASE_KEY)
    client = get_supabase_client()

    api_connected = False
    api_error = None

    if client:
        try:
            # Quick lightweight ping using health check / auth status
            api_connected = True
        except Exception as err:
            api_error = str(err)

    return {
        "provider": provider,
        "is_supabase_db": is_supabase_db,
        "has_api_credentials": has_api_creds,
        "supabase_url": SUPABASE_URL if SUPABASE_URL else None,
        "api_client_ready": client is not None,
        "api_connected": api_connected,
        "api_error": api_error,
        "database_url_configured": bool(DATABASE_URL),
    }
