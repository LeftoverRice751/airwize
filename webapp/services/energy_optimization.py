"""Suggestions for the Energy tab's "Energy optimization" area.

Providers are looked up by name from ``AIRWIZE_ENERGY_OPTIMIZER``:

``rules`` (the default)
    The shared Solar outlook advisor (webapp/services/ai_advisor.py), computed
    from the live Go scraper snapshot and the synthetic solar forecast and
    filtered to the ones that apply to the selected site type. With
    ``AIRWIZE_ADVISOR=auto`` this is the smart planner, or the LLM when a key is
    configured; both are grounded in the same evidence.
empty
    The area stays an empty placeholder and the page makes no request.

To connect a different provider:

1. Write a provider class with ``suggest(context) -> list[Suggestion]``. Keep
   any API key on the server: read it from an environment variable inside the
   provider; never send it to the browser and never commit it.
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
    basis: str | None = None  # what the suggestion was derived from, shown under it


class OptimizationProvider(Protocol):
    def suggest(self, context: Mapping[str, Any]) -> list[Suggestion]: ...


class RulesProvider:
    """The shared Outlook advisor, tailored to the Energy tab's site type.

    Uses the *live* air-quality snapshot even in simulation mode (the advisor
    has no notion of a demo scenario), and says so in each suggestion's basis.
    Only energy-related ("solar") actions are offered; the air-quality actions
    stay on the Solar outlook card.
    """

    label = "Rules, not a model"  # shown as the panel's badge

    # Which site types each solar rule applies to, keyed by its evidence.
    CLEAN_PANELS = {"solar"}  # needs panels
    SHIFT_LOADS = {"solar", "battery", "generator"}  # needs storage to pre-charge

    def __init__(self, cfg: Mapping[str, Any]):
        self.cfg = cfg

    def suggest(self, context: Mapping[str, Any]) -> list[Suggestion]:
        from .solar_outlook import build_outlook, fetch_snapshot

        outlook = build_outlook(fetch_snapshot(self.cfg), self.cfg["AIRWIZE_SOLAR_SITE_NAME"], self.cfg)
        site = context.get("site_type")
        where = outlook.get("municipality") or "Laguna"
        basis = f"Advisor, from live air quality in {where} and the Solar outlook forecast"
        self.label = (outlook.get("advisor") or {}).get("label", self.label)
        if context.get("mode") == "simulation":
            basis += " (live conditions, not the demo scenario)"

        out: list[Suggestion] = []
        for rec in outlook["recommendations"]:
            if rec.get("category") != "solar":
                continue
            evidence = rec.get("evidence") or {}
            action = evidence.get("action")
            if action == "clean_panels" and site in self.CLEAN_PANELS:
                out.append(Suggestion("Clean the panels", rec["text"], basis))
            elif action == "schedule_cleaning" and site in self.CLEAN_PANELS:
                out.append(Suggestion("Schedule the next panel clean", rec["text"], basis))
            elif action == "shift_loads" and site in self.SHIFT_LOADS:
                out.append(Suggestion("Pre-charge before the haze window", rec["text"], basis))
            elif "estimated_recovery_kwh_day" in evidence and site in self.CLEAN_PANELS:
                # Backward-compatible path for the rules-only advisor.
                out.append(Suggestion("Clean the panels", rec["text"], basis))
            elif "window_start" in evidence and site in self.SHIFT_LOADS:
                out.append(Suggestion("Pre-charge before the haze window", rec["text"], basis))
        return out


#: Provider name -> factory taking the Flask config.
PROVIDERS: dict[str, Callable[[Mapping[str, Any]], OptimizationProvider]] = {"rules": RulesProvider}


def is_enabled(cfg: Mapping[str, Any], providers: Mapping[str, Callable] | None = None) -> bool:
    providers = PROVIDERS if providers is None else providers
    return bool(cfg.get("ENERGY_OPTIMIZER")) and cfg["ENERGY_OPTIMIZER"] in providers


def suggest(cfg: Mapping[str, Any], context: Mapping[str, Any], providers: Mapping[str, Callable] | None = None) -> dict[str, Any]:
    """Ask the configured provider for suggestions. ``status`` is
    ``not_configured``, ``ok`` or ``error``; ``suggestions`` is empty unless ``ok``.
    ``label`` (when ok) is the provider's ``label`` attribute, shown as the panel badge."""
    providers = PROVIDERS if providers is None else providers
    if not is_enabled(cfg, providers):
        return {"status": "not_configured", "suggestions": [], "message": "No optimization service is connected."}
    try:
        provider = providers[cfg["ENERGY_OPTIMIZER"]](cfg)
        items = provider.suggest(context)
    except Exception as exc:
        return {"status": "error", "suggestions": [], "message": f"Suggestions are unavailable: {exc}"}
    message = None if items else "No suggestions apply to this site right now."
    label = getattr(provider, "label", "Suggestions")
    return {"status": "ok", "label": label, "suggestions": [asdict(s) for s in items], "message": message}
