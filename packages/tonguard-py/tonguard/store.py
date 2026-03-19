"""Pluggable store backends for TonGuard."""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import date, datetime
from typing import Optional


@dataclass
class PendingTx:
    user_id: str
    code: str
    amount: float
    to_address: Optional[str] = None
    comment: Optional[str] = None
    created_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None


class TonGuardStore(ABC):
    """Interface for TonGuard storage backends."""

    @abstractmethod
    def get_pending(self, user_id: str, code: str) -> Optional[PendingTx]:
        ...

    @abstractmethod
    def set_pending(self, user_id: str, code: str, tx: PendingTx) -> None:
        ...

    @abstractmethod
    def delete_pending(self, user_id: str, code: str) -> None:
        ...

    @abstractmethod
    def get_daily_spent(self, user_id: str) -> float:
        ...

    @abstractmethod
    def add_daily_spent(self, user_id: str, amount: float) -> None:
        ...

    @abstractmethod
    def get_last_tx_time(self, user_id: str) -> Optional[float]:
        ...

    @abstractmethod
    def set_last_tx_time(self, user_id: str, time: float) -> None:
        ...

    @abstractmethod
    def get_daily_tx_count(self, user_id: str) -> int:
        ...

    @abstractmethod
    def cleanup(self) -> None:
        ...


class MemoryStore(TonGuardStore):
    """In-memory store (default). Thread-safe for single-process use."""

    def __init__(self):
        self._pending: dict[str, PendingTx] = {}
        self._daily_spent: dict[str, tuple[float, str]] = {}  # user_id -> (amount, date_str)
        self._last_tx: dict[str, float] = {}
        self._daily_count: dict[str, tuple[int, str]] = {}

    def _key(self, user_id: str, code: str) -> str:
        return f"{user_id}::{code}"

    def _today(self) -> str:
        return date.today().isoformat()

    def get_pending(self, user_id: str, code: str) -> Optional[PendingTx]:
        tx = self._pending.get(self._key(user_id, code))
        if tx and tx.expires_at and tx.expires_at < datetime.now():
            del self._pending[self._key(user_id, code)]
            return None
        return tx

    def set_pending(self, user_id: str, code: str, tx: PendingTx) -> None:
        self._pending[self._key(user_id, code)] = tx

    def delete_pending(self, user_id: str, code: str) -> None:
        self._pending.pop(self._key(user_id, code), None)

    def get_daily_spent(self, user_id: str) -> float:
        entry = self._daily_spent.get(user_id)
        if not entry or entry[1] != self._today():
            return 0.0
        return entry[0]

    def add_daily_spent(self, user_id: str, amount: float) -> None:
        current = self.get_daily_spent(user_id)
        self._daily_spent[user_id] = (current + amount, self._today())
        count_entry = self._daily_count.get(user_id)
        count = (count_entry[0] if count_entry and count_entry[1] == self._today() else 0) + 1
        self._daily_count[user_id] = (count, self._today())

    def get_last_tx_time(self, user_id: str) -> Optional[float]:
        return self._last_tx.get(user_id)

    def set_last_tx_time(self, user_id: str, time: float) -> None:
        self._last_tx[user_id] = time

    def get_daily_tx_count(self, user_id: str) -> int:
        entry = self._daily_count.get(user_id)
        if not entry or entry[1] != self._today():
            return 0
        return entry[0]

    def cleanup(self) -> None:
        now = datetime.now()
        expired = [k for k, v in self._pending.items() if v.expires_at and v.expires_at < now]
        for k in expired:
            del self._pending[k]
