"""Developer entrypoint:  python run.py [--tls] [--reset] [--port 8000]

* --reset  recreates the demo database and re-seeds it
* --tls    serves HTTPS with a generated self-signed certificate (TLS in transit)
"""
from __future__ import annotations

import argparse
import ipaddress
import os
import ssl
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.config import DATA_DIR  # noqa: E402

CERT_PATH = DATA_DIR / "dev-cert.pem"
KEY_PATH = DATA_DIR / "dev-key.pem"


def ensure_certificate() -> tuple[str, str]:
    if CERT_PATH.exists() and KEY_PATH.exists():
        return str(CERT_PATH), str(KEY_PATH)

    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "localhost")])
    now = datetime.utcnow()
    certificate = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=365))
        .add_extension(x509.SubjectAlternativeName([
            x509.DNSName("localhost"),
            x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
        ]), critical=False)
        .sign(key, hashes.SHA256())
    )
    KEY_PATH.write_bytes(key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    ))
    CERT_PATH.write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
    return str(CERT_PATH), str(KEY_PATH)


def main() -> None:
    parser = argparse.ArgumentParser(description="AICTE FDR Management Portal (prototype)")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--tls", action="store_true", help="serve HTTPS with a generated certificate")
    parser.add_argument("--reset", action="store_true", help="delete and re-seed the database")
    parser.add_argument("--reload", action="store_true", help="auto-reload on code changes")
    args = parser.parse_args()

    if args.reset:
        for name in ("aicte.db", "aicte.db-wal", "aicte.db-shm"):
            path = DATA_DIR / name
            if path.exists():
                path.unlink()
        print("[run] database reset - it will be re-seeded on startup")

    import uvicorn

    ssl_kwargs = {}
    scheme = "http"
    if args.tls:
        cert, key = ensure_certificate()

        def tls_factory(config, default_factory):
            """Force a TLS 1.3 floor on uvicorn's generated context."""
            context = default_factory()
            context.minimum_version = ssl.TLSVersion.TLSv1_3
            return context

        ssl_kwargs = {"ssl_certfile": cert, "ssl_keyfile": key, "ssl_context_factory": tls_factory}
        scheme = "https"
        print("[run] TLS 1.3 enabled with a generated local certificate")

    print(f"[run] API on {scheme}://{args.host}:{args.port}/api/docs")
    uvicorn.run(
        "app.main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level="info",
        **ssl_kwargs,
    )


if __name__ == "__main__":
    main()
