"""Live energy readings from a solar system's Wi-Fi module.

This module is the only place that talks to an energy device, and it is
entirely separate from the Go air-quality scraper. No specific brand, module,
network protocol or API is assumed: a device is reached through an *adapter*
that implements :class:`EnergyDevice`. **No adapter ships yet**, so live mode
reports ``not_configured`` and the dashboard shows no live energy values.

Adding support for a module
---------------------------
1. Find out how the module exposes data: protocol (HTTP/JSON, Modbus TCP,
   MQTT, a vendor cloud API, ...), address and port, authentication,
   the fields it reports and their units, and how often it can be polled.
2. Write a class with a ``read()`` method that returns an
   :class:`EnergyReading` (leave a field ``None`` when the module does not
   report it; never fill in a guess) and raises :class:`DeviceUnavailable`
   when the module cannot be reached or :class:`DeviceError` when it answers
   with something unusable.
3. Register a factory: ``ADAPTERS["my-module"] = lambda cfg: MyModule(...)``.
4. Start Flask with ``AIRWIZE_ENERGY_ADAPTER=my-module`` and
   ``AIRWIZE_ENERGY_DEVICE_ADDRESS=<address>``.

The browser polls ``GET /api/energy/live`` and renders whatever
:func:`poll_device` returns, so nothing else needs to change.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, Protocol


class DeviceUnavailable(Exception):
    """The module could not be reached (offline, wrong address, timed out)."""


class DeviceError(Exception):
    """The module answered, but not with a usable reading."""


@dataclass(frozen=True)
class EnergyReading:
    """One reading as reported by the device. ``None`` means "not reported"."""

    charge_pct: float | None = None  # stored energy, % of capacity
    voltage_v: float | None = None  # battery voltage, volts
    load_w: float | None = None  # power drawn by appliances, watts
    solar_w: float | None = None  # power from the panels, watts
    generator_w: float | None = None  # power from a generator, watts
    measured_at: datetime | None = None  # when the device took the reading (UTC)

    def to_json(self) -> dict[str, Any]:
        data = asdict(self)
        at = self.measured_at
        data["measured_at"] = at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z") if at else None
        return data


class EnergyDevice(Protocol):
    """What an adapter must provide."""

    #: Human-readable description of the data source, shown in the Energy tab
    #: heading, e.g. "Example inverter Wi-Fi module at 192.168.1.40".
    source: str

    def read(self, timeout: float) -> EnergyReading:
        """Return the current reading, or raise DeviceUnavailable/DeviceError."""
        ...


#: Adapter name -> factory taking the Flask config. Empty until a module's
#: technical details are known; see the module docstring.
ADAPTERS: dict[str, Callable[[Mapping[str, Any]], EnergyDevice]] = {}


def poll_device(cfg: Mapping[str, Any], adapters: Mapping[str, Callable] | None = None) -> dict[str, Any]:
    """Read the configured device once and describe the outcome for the browser.

    Returns ``{"state", "source", "message", "reading"}`` where ``state`` is one of
    ``not_configured``, ``connected``, ``disconnected`` or ``error``. ``reading``
    is only present when connected; it is never filled with substitute values.
    """
    adapters = ADAPTERS if adapters is None else adapters
    name = cfg.get("ENERGY_DEVICE_ADAPTER") or ""
    if not name:
        return _status(
            "not_configured",
            None,
            "No solar Wi-Fi module is set up. Support for a specific module has not been implemented yet.",
        )
    factory = adapters.get(name)
    if factory is None:
        return _status("error", None, f"No adapter named “{name}” is available. Check AIRWIZE_ENERGY_ADAPTER.")

    try:
        device = factory(cfg)
    except Exception as exc:  # a bad address or missing setting in the adapter
        return _status("error", None, f"The “{name}” adapter could not start: {exc}")

    source = getattr(device, "source", name)
    try:
        reading = device.read(timeout=float(cfg.get("ENERGY_DEVICE_TIMEOUT", 3.0)))
    except DeviceUnavailable as exc:
        return _status("disconnected", source, str(exc) or "The solar system's Wi-Fi module did not answer.")
    except DeviceError as exc:
        return _status("error", source, str(exc) or "The solar system's Wi-Fi module sent an unusable reading.")
    if not isinstance(reading, EnergyReading):
        return _status("error", source, "The adapter returned something other than an EnergyReading.")
    return {**_status("connected", source, None), "reading": reading.to_json()}


def _status(state: str, source: str | None, message: str | None) -> dict[str, Any]:
    return {"state": state, "source": source, "message": message, "reading": None}
