"""Integration point for AI-generated energy optimization suggestions.

**Nothing is implemented here yet, on purpose.** The Energy tab renders an
empty "Energy optimization" area and makes no request while no provider is
configured. To connect an AI service later:

1. Write a provider class with ``suggest(context) -> list[Suggestion]``. Keep
   the API key on the server: read it from an environment variable inside the
   provider (for example ``AIRWIZE_AI_API_KEY``); never send it to the browser
   and never commit it.
2. Register it: ``PROVIDERS["my-ai"] = lambda cfg: MyProvider(...)``.
3. Start Flask with ``AIRWIZE_ENERGY_OPTIMIZER=my-ai``. The page then sees
   ``optimization_enabled: true`` and the Energy tab starts POSTing the
   context below to ``/api/energy/suggestions`` and lists what comes back.

Context the browser sends (built in dashboard/static/js/lib/energy/context.js)::

    {
      "site_type": "solar" | "grid" | "generator" | "battery",
      "mode": "simulation" | "live",
      "scenario": {"id", "label", "description"} | null,   # simulation only
      "clock": "2026-11-23T13:20:00+08:00",                # demo clock or real time
      "readings": {                                         # null = not available
        "charge_pct", "voltage_v", "load_w", "solar_w", "generator_w",
        "drain_pct_per_h", "hours_remaining"
      },
      "outside": {"municipality", "temperature_c", "uv", "plume_index",
                  "level", "source": "scripted" | "live"} | null,
      "forecast": [{"timestamp", "temperature_c", "uv", "plume_index"}],  # next hours
      "explanations": [{"id", "text"}]                      # the estimated causes shown
    }

A provider must not invent readings that are not in the context, and its
suggestions should be shown as suggestions, not as facts.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import asdict, dataclass
from typing import Any, Protocol


@dataclass(frozen=True)
class Suggestion:
    title: str
    body: str


class OptimizationProvider(Protocol):
    def suggest(self, context: Mapping[str, Any]) -> list[Suggestion]: ...


#: Provider name -> factory taking the Flask config. Empty for the MVP.
PROVIDERS: dict[str, Callable[[Mapping[str, Any]], OptimizationProvider]] = {}


def is_enabled(cfg: Mapping[str, Any], providers: Mapping[str, Callable] | None = None) -> bool:
    providers = PROVIDERS if providers is None else providers
    return bool(cfg.get("ENERGY_OPTIMIZER")) and cfg["ENERGY_OPTIMIZER"] in providers


def suggest(cfg: Mapping[str, Any], context: Mapping[str, Any], providers: Mapping[str, Callable] | None = None) -> dict[str, Any]:
    """Ask the configured provider for suggestions. ``status`` is
    ``not_configured``, ``ok`` or ``error``; ``suggestions`` is empty unless ``ok``."""
    providers = PROVIDERS if providers is None else providers
    if not is_enabled(cfg, providers):
        return {"status": "not_configured", "suggestions": [], "message": "No optimization service is connected."}
    try:
        items = providers[cfg["ENERGY_OPTIMIZER"]](cfg).suggest(context)
    except Exception as exc:
        return {"status": "error", "suggestions": [], "message": f"The optimization service failed: {exc}"}
    return {"status": "ok", "suggestions": [asdict(s) for s in items], "message": None}
