"""Límite de intentos para login y registro (protección contra fuerza bruta).

Ventana deslizante en memoria: suficiente para un solo proceso de uvicorn
(instalación local / escritorio). Si algún día se ejecutan varios workers o
servidores, este estado debe moverse a la base de datos o a Redis.
"""
from __future__ import annotations

import math
import os
import threading
import time
from collections import deque

from fastapi import HTTPException, Request


def _env_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.getenv(name, default)))
    except ValueError:
        return default


class SlidingWindowLimiter:
    """Cuenta eventos por clave dentro de una ventana de tiempo."""

    # Por encima de este número de claves se borran las que ya vencieron, para
    # que correos/IPs que nunca vuelven no se queden en memoria para siempre.
    MAX_KEYS = 10_000

    def __init__(self, max_events: int, window_seconds: int):
        self.max_events = max_events
        self.window_seconds = window_seconds
        self._events: dict[str, deque[float]] = {}
        self._lock = threading.Lock()
        self._last_sweep = 0.0

    def _prune(self, key: str, now: float) -> deque[float]:
        events = self._events.get(key)
        if events is None:
            return deque()
        while events and events[0] <= now - self.window_seconds:
            events.popleft()
        if not events:
            self._events.pop(key, None)
        return events

    def _sweep(self, now: float) -> None:
        # Como mucho una vez por minuto, para no recorrer el diccionario en cada petición.
        if len(self._events) > self.MAX_KEYS and now - self._last_sweep >= 60:
            self._last_sweep = now
            for key in list(self._events):
                self._prune(key, now)

    def acquire(self, key: str) -> int:
        """Registra un intento si hay cupo y devuelve 0; si no, devuelve los segundos de espera.

        Revisar y registrar ocurre bajo el mismo candado: peticiones simultáneas
        no pueden pasar todas la revisión antes de que se cuente alguna.
        """
        now = time.monotonic()
        with self._lock:
            self._sweep(now)
            events = self._prune(key, now)
            if len(events) >= self.max_events:
                return max(1, math.ceil(events[0] + self.window_seconds - now))
            self._events.setdefault(key, events).append(now)
            return 0

    def release(self, key: str) -> None:
        """Deshace el último intento registrado (p. ej. un login que resultó correcto)."""
        with self._lock:
            events = self._events.get(key)
            if events:
                events.pop()
                if not events:
                    self._events.pop(key, None)

    def reset(self, key: str | None = None) -> None:
        with self._lock:
            if key is None:
                self._events.clear()
            else:
                self._events.pop(key, None)


_WINDOW = _env_int("MANAGER_STOCK_LOGIN_WINDOW_SECONDS", 15 * 60)
# Intentos fallidos por correo (protege una cuenta concreta).
failed_logins_by_email = SlidingWindowLimiter(_env_int("MANAGER_STOCK_LOGIN_MAX_PER_EMAIL", 5), _WINDOW)
# Intentos fallidos por IP (protege contra probar muchas cuentas desde un mismo equipo).
failed_logins_by_ip = SlidingWindowLimiter(_env_int("MANAGER_STOCK_LOGIN_MAX_PER_IP", 20), _WINDOW)
# Registros por IP (evita crear cuentas/negocios en masa).
registrations_by_ip = SlidingWindowLimiter(_env_int("MANAGER_STOCK_REGISTER_MAX_PER_IP", 10), 60 * 60)


def client_ip(request: Request) -> str:
    # No se confía en X-Forwarded-For: la API no está detrás de un proxy y el
    # encabezado lo puede falsificar cualquier cliente.
    return request.client.host if request.client else "unknown"


def too_many_attempts(retry_after: int, message: str) -> HTTPException:
    minutes = max(1, math.ceil(retry_after / 60))
    return HTTPException(
        status_code=429,
        detail=f"{message} Intenta de nuevo en {minutes} minuto{'s' if minutes != 1 else ''}.",
        headers={"Retry-After": str(retry_after)},
    )


def reset_all() -> None:
    """Limpia todos los contadores (útil en pruebas)."""
    for limiter in (failed_logins_by_email, failed_logins_by_ip, registrations_by_ip):
        limiter.reset()
