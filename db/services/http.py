# services/http.py
from __future__ import annotations
import os
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# Reasonable defaults: (connect, read)
DEFAULT_TIMEOUT: tuple[float, float] = (2.0, 6.0)

HEADERS = {
    "User-Agent": "HAb_DB/NamesBackfill",
    "Accept": "application/json, text/plain;q=0.9, */*;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
}


def _retry(total: int, backoff: float) -> Retry:
    # Retry on transient network + 429/5xx; GET only
    kwargs = dict(
        total=total,
        connect=total,
        read=total,
        status=total,
        backoff_factor=backoff,
        status_forcelist=(429, 500, 502, 503, 504),
        respect_retry_after_header=True,
        raise_on_status=False,
    )
    try:
        # urllib3 >= 1.26
        return Retry(allowed_methods=frozenset({"GET"}), **kwargs)
    except TypeError:
        # older urllib3
        return Retry(method_whitelist=frozenset({"GET"}), **kwargs)


def make_session(total_retries: int = 2, backoff: float = 0.2) -> requests.Session:
    pool_conns = int(os.getenv("HTTP_POOL_CONNECTIONS", "64"))
    pool_size = int(os.getenv("HTTP_POOL_MAXSIZE", "64"))
    adapter = HTTPAdapter(
        max_retries=_retry(total_retries, backoff),
        pool_connections=pool_conns,
        pool_maxsize=pool_size,
    )
    s = requests.Session()
    s.headers.update(HEADERS)
    s.mount("https://", adapter)
    s.mount("http://", adapter)
    return s


# Global shared session (thread-safe for concurrent GETs)
SESSION = make_session()


def get(
    url: str, *, timeout: tuple[float, float] = DEFAULT_TIMEOUT, **kwargs
) -> requests.Response:
    """Wrapper so callers inherit default session + timeout."""
    return get(url, timeout=timeout, **kwargs)
