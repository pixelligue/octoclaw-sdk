"""Core TonGuard — gate, confirm, reject transactions."""

import math
import secrets
import string
import time as _time
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Literal, Optional

from .store import MemoryStore, PendingTx, TonGuardStore


@dataclass
class TonGuardConfig:
    daily_limit: float = 10.0
    per_tx_limit: float = 5.0
    auto_confirm_below: float = 0.1
    cooldown_seconds: float = 30.0
    code_expiry_seconds: float = 300.0
    code_length: int = 6
    store: Optional[TonGuardStore] = None


@dataclass
class GateResult:
    status: Literal["approved", "pending", "rejected"]
    amount: float
    code: Optional[str] = None
    expires_at: Optional[datetime] = None
    reason: Optional[str] = None


@dataclass
class ConfirmResult:
    status: Literal["approved", "expired", "invalid"]
    amount: Optional[float] = None
    user_id: Optional[str] = None


@dataclass
class UserStats:
    spent_today: float = 0.0
    remaining_today: float = 0.0
    tx_count_today: int = 0
    last_tx_at: Optional[datetime] = None
    can_transact: bool = True
    cooldown_ends_at: Optional[datetime] = None


# Characters excluding ambiguous ones (0/O/1/I)
_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


class TonGuard:
    """
    Security guard for AI agent TON transactions.

    Usage:
        guard = TonGuard(daily_limit=10, auto_confirm_below=0.1)
        result = guard.gate("user-123", 5.0, "EQxyz...")

        if result.status == "pending":
            # Show code to user
            print(f"Confirm: {result.code}")

        confirm = guard.confirm("user-123", "A7K2X9")
    """

    def __init__(
        self,
        daily_limit: float = 10.0,
        per_tx_limit: float = 5.0,
        auto_confirm_below: float = 0.1,
        cooldown_seconds: float = 30.0,
        code_expiry_seconds: float = 300.0,
        code_length: int = 6,
        store: Optional[TonGuardStore] = None,
    ):
        self.config = TonGuardConfig(
            daily_limit=daily_limit,
            per_tx_limit=per_tx_limit,
            auto_confirm_below=auto_confirm_below,
            cooldown_seconds=cooldown_seconds,
            code_expiry_seconds=code_expiry_seconds,
            code_length=code_length,
            store=store,
        )
        self._store = store or MemoryStore()

    def gate(
        self,
        user_id: str,
        amount: float,
        to_address: Optional[str] = None,
        comment: Optional[str] = None,
    ) -> GateResult:
        """
        Gate a transaction. Returns approved/pending/rejected.

        - approved: auto-confirmed (below threshold)
        - pending: confirmation code generated, show to user
        - rejected: policy violation
        """
        # 1. Per-tx limit
        if amount > self.config.per_tx_limit:
            return GateResult(
                status="rejected",
                amount=amount,
                reason=f"Amount {amount} TON exceeds per-tx limit of {self.config.per_tx_limit} TON",
            )

        # 2. Daily limit
        spent = self._store.get_daily_spent(user_id)
        if spent + amount > self.config.daily_limit:
            return GateResult(
                status="rejected",
                amount=amount,
                reason=f"Daily limit exceeded: {spent} + {amount} > {self.config.daily_limit} TON",
            )

        # 3. Cooldown
        last_tx = self._store.get_last_tx_time(user_id)
        if last_tx is not None:
            elapsed = _time.time() - last_tx
            if elapsed < self.config.cooldown_seconds:
                wait = math.ceil(self.config.cooldown_seconds - elapsed)
                return GateResult(
                    status="rejected",
                    amount=amount,
                    reason=f"Cooldown active: wait {wait}s",
                )

        # 4. Auto-confirm small amounts
        if amount <= self.config.auto_confirm_below:
            self._store.add_daily_spent(user_id, amount)
            self._store.set_last_tx_time(user_id, _time.time())
            return GateResult(status="approved", amount=amount)

        # 5. Generate confirmation code
        code = self._generate_code()
        now = datetime.now()
        expires = now + timedelta(seconds=self.config.code_expiry_seconds)

        self._store.set_pending(
            user_id,
            code,
            PendingTx(
                user_id=user_id,
                code=code,
                amount=amount,
                to_address=to_address,
                comment=comment,
                created_at=now,
                expires_at=expires,
            ),
        )

        return GateResult(status="pending", amount=amount, code=code, expires_at=expires)

    def confirm(self, user_id: str, code: str) -> ConfirmResult:
        """Confirm a pending transaction with the user-provided code."""
        code = code.upper().strip()
        tx = self._store.get_pending(user_id, code)

        if tx is None:
            return ConfirmResult(status="invalid")

        if tx.expires_at and tx.expires_at < datetime.now():
            self._store.delete_pending(user_id, code)
            return ConfirmResult(status="expired")

        self._store.delete_pending(user_id, code)
        self._store.add_daily_spent(user_id, tx.amount)
        self._store.set_last_tx_time(user_id, _time.time())

        return ConfirmResult(status="approved", amount=tx.amount, user_id=user_id)

    def reject(self, user_id: str, code: str) -> bool:
        """Cancel a pending transaction. Returns True if found."""
        code = code.upper().strip()
        tx = self._store.get_pending(user_id, code)
        if tx is None:
            return False
        self._store.delete_pending(user_id, code)
        return True

    def get_stats(self, user_id: str) -> UserStats:
        """Get spending stats for a user."""
        spent = self._store.get_daily_spent(user_id)
        last_tx = self._store.get_last_tx_time(user_id)
        cooldown_ends = (
            datetime.fromtimestamp(last_tx + self.config.cooldown_seconds)
            if last_tx
            else None
        )
        now = _time.time()

        return UserStats(
            spent_today=spent,
            remaining_today=max(0.0, self.config.daily_limit - spent),
            tx_count_today=self._store.get_daily_tx_count(user_id),
            last_tx_at=datetime.fromtimestamp(last_tx) if last_tx else None,
            can_transact=(
                (cooldown_ends is None or cooldown_ends.timestamp() <= now)
                and spent < self.config.daily_limit
            ),
            cooldown_ends_at=(
                cooldown_ends if cooldown_ends and cooldown_ends.timestamp() > now else None
            ),
        )

    def cleanup(self) -> None:
        """Remove expired pending transactions."""
        self._store.cleanup()

    def _generate_code(self) -> str:
        return "".join(
            secrets.choice(_CODE_CHARS) for _ in range(self.config.code_length)
        )
