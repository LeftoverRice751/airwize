"""Grounded AI advisor for the Solar outlook and the Energy tab.

The advisor has two layers:

1. **A deterministic smart planner** turns the live AQI snapshot and the
   24-hour solar forecast into quantified actions: how many kWh haze is costing,
   when to clean, how often to maintain, and when to pre-charge. It also keeps
   the air-quality rules (patrols, straw collection, clean cooking).
2. **An optional LLM** rewrites and prioritises those actions. It never sees a
   blank page: it gets a fixed list of candidate actions with their evidence and
   may only reword/reorder them. If the model is unavailable, invalid, or too
   slow, the planner's output is returned instead.

Configure with ``AIRWIZE_ADVISOR``:

``auto`` (default)
    Use the LLM when ``AIRWIZE_AI_API_KEY`` is set, otherwise the smart planner.
``smart``
    Always use the deterministic planner (no network, no key).
``ai``
    Require the LLM; fall back to the smart planner with a note when it fails.
``rules``
    The previous rules-only behaviour (webapp/services/recommendations.py).

The LLM is OpenAI-chat-completions compatible. Only the server reads the key;
it is never sent to the browser. Suggestions are estimates, not measurements,
and every one keeps the evidence that produced it.
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
import urllib.request
from datetime import timedelta
from statistics import mean
from typing import Any, Mapping

from config import Config

from .recommendations import recommend
from .solar_sim import MANILA, as_datetime, focus_municipality, iso_z, municipality_pm25

ADVISOR_MODES = {"auto", "smart", "ai", "rules"}
MAX_SUGGESTIONS = 3
_CACHE: dict[str, tuple[float, list[dict]]] = {}
_CACHE_LOCK = threading.Lock()


def _setting(cfg: Mapping[str, Any] | None, name: str, default: Any = None) -> Any:
    """Read a Flask config value, falling back to ``Config`` outside a request."""
    if cfg is not None:
        try:
            value = cfg.get(name)
        except AttributeError:
            value = None
        if value is not None:
            return value
    return getattr(Config, name, default)


def _num(value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0.0
    return float(value)


def _resolve_mode(cfg: Mapping[str, Any] | None) -> tuple[str, bool]:
    """Return ``(mode, used_fallback)`` for this request."""
    requested = str(_setting(cfg, "ADVISOR", "auto") or "auto").strip().lower()
    if requested not in ADVISOR_MODES:
        requested = "auto"
    has_key = bool(str(_setting(cfg, "AI_API_KEY", "") or "").strip())
    if requested == "auto":
        return ("ai" if has_key else "smart"), False
    if requested == "ai" and not has_key:
        return "smart", True
    return requested, False


def _focus_municipality(snapshot: dict, city: str | None = None) -> dict | None:
    if city:
        for municipality in snapshot.get("municipalities") or []:
            if isinstance(municipality, dict) and municipality.get("city") == city:
                return municipality
    return focus_municipality(snapshot)


def _haze_subjects(snapshot: dict, high: float, focus_city: str | None = None) -> tuple[str | None, list[str]]:
    focus = _focus_municipality(snapshot, focus_city)
    name = str(focus.get("city")) if focus else None
    elevated = sorted(
        str(m.get("city"))
        for m in snapshot.get("municipalities") or []
        if isinstance(m, dict) and (municipality_pm25(m) or 0) > high
    )
    return name, elevated


def _window_label(start: str, end: str) -> str:
    start_dt, end_dt = as_datetime(start), as_datetime(end)
    if start_dt is None or end_dt is None:
        return "the next low-haze window"
    return f"{start_dt.astimezone(MANILA):%H:%M}–{end_dt.astimezone(MANILA):%H:%M} Manila"


def _best_cleaning_window(daylight: list[dict]) -> tuple[str, str] | None:
    """Three daylight hours with the lowest PM2.5, preferring the early block."""
    usable = [r for r in daylight if r.get("pm25") is not None]
    if not usable:
        return None
    blocks = [usable[i : i + 3] for i in range(max(1, len(usable) - 2))]
    if not blocks:
        blocks = [usable]

    def score(block: list[dict]) -> tuple[float, float]:
        return (mean(_num(r.get("pm25")) for r in block), -mean(_num(r.get("baseline_kw")) for r in block))

    best = min(blocks, key=score)
    early = blocks[0]
    # Cleaning at dawn is operationally easier; accept it when the air is close
    # to the cleanest block (within 25 % of its PM2.5).
    if score(early)[0] <= score(best)[0] * 1.25:
        best = early
    start = str(best[0].get("timestamp"))
    end_dt = as_datetime(best[-1].get("timestamp"))
    end = iso_z(end_dt + timedelta(hours=1)) if end_dt is not None else start
    return start, end


def _low_output_window(forecast: list[dict]) -> tuple[str, str] | None:
    """The three-hour daylight block with the largest haze shortfall."""
    daylight = [r for r in forecast if _num(r.get("baseline_kw")) > 0]
    if not daylight:
        return None
    blocks = [daylight[i : i + 3] for i in range(max(1, len(daylight) - 2))]
    if not blocks:
        blocks = [daylight]
    best = max(blocks, key=lambda block: sum(max(0.0, _num(r.get("baseline_kw")) - _num(r.get("aqi_kw"))) for r in block))
    shortfall = sum(max(0.0, _num(r.get("baseline_kw")) - _num(r.get("aqi_kw"))) for r in best)
    if shortfall <= 0 or min(_num(r.get("delta_pct")) for r in best) >= -5:
        return None
    start = str(best[0].get("timestamp"))
    end_dt = as_datetime(best[-1].get("timestamp"))
    end = iso_z(end_dt + timedelta(hours=1)) if end_dt is not None else start
    return start, end


def _maintenance_cadence(pm25_max: float, high: float, critical: float) -> str:
    if pm25_max > critical:
        return f"Clean every 2–3 days while PM2.5 stays above {critical:g} µg/m³."
    if pm25_max > high:
        return "Clean weekly and after every haze episode."
    return f"Keep the routine monthly clean; bring it forward if PM2.5 passes {high:g} µg/m³."


def _air_action(evidence: dict) -> str:
    if "month" in evidence:
        return "collect_straw"
    if "sdg" in evidence:
        return "clean_cooking"
    if "window" in evidence:
        return "patrol"
    return "air_action"


def _suggestion(category: str, severity: str, text: str, evidence: dict, action: str) -> dict:
    return {"category": category, "severity": severity, "text": text, "evidence": {**evidence, "action": action}}


def _smart_candidates(
    snapshot: dict,
    forecast: list[dict],
    site_name: str,
    cfg: Mapping[str, Any] | None,
    focus_city: str | None = None,
) -> list[dict]:
    high = float(_setting(cfg, "AIRWIZE_PM25_HIGH", 35.0))
    critical = float(_setting(cfg, "AIRWIZE_PM25_CRITICAL", 75.0))
    focus_name, elevated = _haze_subjects(snapshot, high, focus_city)
    subjects = elevated or ([focus_name] if focus_name else [])

    daylight = [r for r in forecast if _num(r.get("baseline_kw")) > 0]
    baseline_kwh = sum(_num(r.get("baseline_kw")) for r in daylight)
    loss_kwh = sum(max(0.0, _num(r.get("baseline_kw")) - _num(r.get("aqi_kw"))) for r in daylight)
    loss_pct = (loss_kwh / baseline_kwh * 100.0) if baseline_kwh > 1e-9 else 0.0
    pm25s = [_num(r.get("pm25")) for r in forecast if r.get("pm25") is not None]
    current_pm25 = municipality_pm25(_focus_municipality(snapshot, focus_city) or {})
    pm25s = ([current_pm25] if current_pm25 is not None else []) + pm25s
    pm25_max = max(pm25s) if pm25s else 0.0
    pm25_now = current_pm25 if current_pm25 is not None else 0.0

    candidates: list[dict] = []
    cleaning_window = _best_cleaning_window(daylight)
    cadence = _maintenance_cadence(pm25_max, high, critical)
    if cleaning_window is not None and (pm25_now > high or loss_kwh >= 0.2):
        start, end = cleaning_window
        window_text = _window_label(start, end)
        evidence = {
            "site": site_name,
            "municipalities": subjects,
            "pm25_max": round(pm25_max, 1),
            "pm25_now": round(pm25_now, 1),
            "pm25_high": high,
            "pm25_critical": critical,
            "estimated_recovery_kwh_day": round(loss_kwh, 2),
            "loss_pct": round(loss_pct, 1),
            "forecast_baseline_kwh": round(baseline_kwh, 2),
            "window_start": start,
            "window_end": end,
            "maintenance": cadence,
        }
        severity = "warn" if pm25_now > high + 15 or loss_pct >= 10 else "info"
        if loss_kwh < 0.5:
            action = "schedule_cleaning"
            text = (
                f"Haze is still present at {pm25_now:.0f} µg/m³, but only about {loss_kwh:.1f} kWh of "
                f"output is left to recover today. Schedule a post-haze rinse and panel inspection; {cadence}"
            )
            severity = "info"
        else:
            action = "clean_panels"
            text = (
                f"Haze is costing about {loss_kwh:.1f} kWh over the next 24 hours "
                f"({loss_pct:.0f}% of the weather-only forecast). Clean and rinse the panels during "
                f"{window_text}; the model estimates most of that output can be recovered. {cadence}"
            )
        candidates.append(_suggestion("solar", severity, text, evidence, action))

    output_window = _low_output_window(forecast)
    if output_window is not None and loss_pct >= 5 and loss_kwh >= 0.5:
        start, end = output_window
        candidates.append(
            _suggestion(
                "solar",
                "info",
                (
                    f"Pre-charge the battery and move non-essential loads out of {_window_label(start, end)}, "
                    f"when the AQI-aware forecast is {loss_pct:.0f}% below weather-only "
                    f"({loss_kwh:.1f} kWh shortfall)."
                ),
                {
                    "site": site_name,
                    "municipalities": subjects,
                    "estimated_recovery_kwh_day": round(loss_kwh, 2),
                    "loss_pct": round(loss_pct, 1),
                    "window_start": start,
                    "window_end": end,
                },
                "shift_loads",
            )
        )

    # Keep the air-quality actions from the rules engine. They are policy
    # actions, not solar-maintenance estimates.
    for rec in recommend(snapshot, forecast):
        if rec.get("category") != "air":
            continue
        evidence = dict(rec.get("evidence") or {})
        evidence["action"] = _air_action(evidence)
        candidates.append({**rec, "evidence": evidence})
    return candidates


def _extract_json(text: str) -> dict | None:
    if not isinstance(text, str):
        return None
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        value = json.loads(text[start : end + 1])
    except ValueError:
        return None
    return value if isinstance(value, dict) else None


def _apply_llm_result(data: dict | None, candidates: list[dict]) -> list[dict] | None:
    if not data:
        return None
    raw = data.get("suggestions")
    if not isinstance(raw, list):
        return None
    by_id = {c["evidence"].get("action"): c for c in candidates if c.get("evidence", {}).get("action")}
    out: list[dict] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        action = str(item.get("id") or item.get("action") or "")
        candidate = by_id.get(action)
        text = item.get("text")
        if candidate is None or action in seen or not isinstance(text, str):
            continue
        text = text.strip()
        if not 10 <= len(text) <= 400:
            continue
        severity = item.get("severity") if item.get("severity") in {"info", "warn"} else candidate["severity"]
        out.append({**candidate, "text": text, "severity": severity})
        seen.add(action)
    return out[:MAX_SUGGESTIONS] if out else None


def _cache_get(cfg: Mapping[str, Any] | None, key: str) -> list[dict] | None:
    now = time.time()
    with _CACHE_LOCK:
        entry = _CACHE.get(key)
        if entry is None:
            return None
        created, value = entry
        if now - created > float(_setting(cfg, "AI_CACHE_SECONDS", 300)):
            _CACHE.pop(key, None)
            return None
        return value


def _cache_put(key: str, value: list[dict]) -> None:
    with _CACHE_LOCK:
        _CACHE[key] = (time.time(), value)
        if len(_CACHE) > 64:
            _CACHE.pop(next(iter(_CACHE)))


def _llm_polish(candidates: list[dict], context: dict, cfg: Mapping[str, Any] | None) -> list[dict] | None:
    key = str(_setting(cfg, "AI_API_KEY", "") or "").strip()
    if not key:
        return None
    base_url = str(_setting(cfg, "AI_BASE_URL", "https://api.openai.com/v1") or "").rstrip("/")
    model = str(_setting(cfg, "AI_MODEL", "gpt-4o-mini") or "gpt-4o-mini")
    cache_key = hashlib.sha256(
        json.dumps({"base": base_url, "model": model, "context": context}, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()
    cached = _cache_get(cfg, cache_key)
    if cached is not None:
        return cached

    prompt = (
        "You are Airwize's solar operations advisor for Laguna, Philippines. "
        "Rewrite and order the candidate actions for an operator. Use ONLY the facts and numbers "
        "in the candidates; do not invent measurements, dates or savings. Keep 1 to 3 actions, "
        "warnings before advice, each at most 35 words. Return JSON only, with this shape: "
        '{"suggestions":[{"id":"candidate id","text":"rewritten text","severity":"warn|info"}]}.'
    )
    payload = {
        "model": model,
        "temperature": 0.2,
        "messages": [
            {"role": "system", "content": prompt},
            {"role": "user", "content": json.dumps(context, sort_keys=True)},
        ],
    }
    request = urllib.request.Request(
        base_url + "/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=float(_setting(cfg, "AI_TIMEOUT", 8.0))) as response:
            body = json.load(response)
        content = body["choices"][0]["message"]["content"]
        polished = _apply_llm_result(_extract_json(content), candidates)
    except (OSError, ValueError, KeyError, IndexError, TypeError):
        polished = None
    if polished:
        _cache_put(cache_key, polished)
    return polished


def advise(
    snapshot: dict,
    forecast: list[dict],
    site_name: str,
    cfg: Mapping[str, Any] | None = None,
    focus_city: str | None = None,
) -> tuple[list[dict], dict]:
    """Return ``(suggestions, advisor_metadata)`` for one outlook."""
    mode, fallback = _resolve_mode(cfg)
    if mode == "rules":
        return recommend(snapshot, forecast), {"mode": "rules", "label": "Rules, not a model", "fallback": False}

    candidates = _smart_candidates(snapshot, forecast, site_name, cfg, focus_city)
    if mode == "ai" and candidates:
        high = float(_setting(cfg, "AIRWIZE_PM25_HIGH", 35.0))
        focus_name, elevated = _haze_subjects(snapshot, high, focus_city)
        context = {
            "site": site_name,
            "municipality": focus_name,
            "municipalities_above_threshold": elevated,
            "pm25_high": high,
            "pm25_critical": float(_setting(cfg, "AIRWIZE_PM25_CRITICAL", 75.0)),
            "forecast": forecast,
            "candidates": candidates,
        }
        polished = _llm_polish(candidates, context, cfg)
        if polished is not None:
            return polished, {
                "mode": "ai",
                "label": "AI advisor",
                "model": str(_setting(cfg, "AI_MODEL", "gpt-4o-mini")),
                "fallback": False,
            }
        fallback = True

    return candidates, {"mode": "smart", "label": "Smart plan", "fallback": fallback}


__all__ = ["advise"]
