from __future__ import annotations

import time
from http.client import IncompleteRead
from typing import Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def fetch_url_text(url: str, *, timeout: int = 300, retries: int = 6) -> str:
    """Download URL text with retries for flaky Google Sheet exports."""
    last_err: Optional[BaseException] = None
    for attempt in range(1, retries + 1):
        try:
            req = Request(
                url,
                headers={
                    "User-Agent": "edubot-data-labeling/1.0",
                    "Accept": "text/csv,*/*",
                    "Connection": "close",
                },
            )
            with urlopen(req, timeout=timeout) as resp:
                chunks: list[bytes] = []
                while True:
                    chunk = resp.read(1024 * 1024)
                    if not chunk:
                        break
                    chunks.append(chunk)
                return b"".join(chunks).decode("utf-8")
        except IncompleteRead as err:
            # Rarely Google returns a usable partial body; prefer retry, but keep if large.
            partial = getattr(err, "partial", b"") or b""
            if len(partial) > 1_000_000:
                try:
                    return partial.decode("utf-8")
                except UnicodeDecodeError:
                    pass
            last_err = err
        except (HTTPError, URLError, TimeoutError, OSError) as err:
            last_err = err

        wait = min(2**attempt, 20)
        print(f"Sheet fetch attempt {attempt}/{retries} failed ({last_err}); retry in {wait}s")
        if attempt < retries:
            time.sleep(wait)

    raise RuntimeError(f"Failed to fetch sheet after {retries} attempts: {last_err}") from last_err
