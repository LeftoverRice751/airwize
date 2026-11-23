"""HTTP client for the Go scraper's ``GET /api/readings``.

The Go scraper owns all Plume Labs scraping, parsing and polling. This client
only fetches its latest in-memory snapshot. It uses the standard library so the
web app needs nothing beyond Flask.
"""

import json
import socket
import urllib.error
import urllib.parse
import urllib.request

READINGS_PATH = "/api/readings"
WEBSOCKET_PATH = "/ws/readings"


class ScraperUnavailable(Exception):
    """The scraper could not be reached or gave an unusable answer."""


class ScraperTimeout(ScraperUnavailable):
    """The scraper did not answer within the timeout."""


class ReadingsClient:
    def __init__(self, base_url: str, timeout: float = 5.0):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    @property
    def readings_url(self) -> str:
        return self.base_url + READINGS_PATH

    @property
    def websocket_url(self) -> str:
        """Return the scraper URL in browser WebSocket form."""
        parsed = urllib.parse.urlsplit(self.base_url)
        scheme = "wss" if parsed.scheme == "https" else "ws"
        return urllib.parse.urlunsplit((scheme, parsed.netloc, WEBSOCKET_PATH, "", ""))

    def fetch_readings(self) -> tuple[bytes, str]:
        """Return the snapshot's raw JSON bytes and content type.

        The body is checked to be JSON but passed on unchanged, so the
        browser sees exactly what the Go scraper produced.
        """
        url = self.readings_url
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                body = resp.read()
                content_type = resp.headers.get("Content-Type", "application/json")
        except urllib.error.HTTPError as exc:
            raise ScraperUnavailable(f"The readings service at {url} answered {exc.code}.") from exc
        except (TimeoutError, socket.timeout) as exc:
            raise ScraperTimeout(f"The readings service at {url} did not answer within {self.timeout:g} seconds.") from exc
        except urllib.error.URLError as exc:
            if isinstance(exc.reason, (TimeoutError, socket.timeout)):
                raise ScraperTimeout(f"The readings service at {url} did not answer within {self.timeout:g} seconds.") from exc
            raise ScraperUnavailable(f"The readings service at {url} could not be reached ({exc.reason}).") from exc
        except OSError as exc:  # e.g. connection reset mid-read
            raise ScraperUnavailable(f"The readings service at {url} could not be reached ({exc}).") from exc

        try:
            json.loads(body)
        except ValueError as exc:
            raise ScraperUnavailable(f"The readings service at {url} did not return JSON.") from exc
        return body, content_type
