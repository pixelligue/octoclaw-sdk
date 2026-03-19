"""
TonGuard — Security layer & Agent Toolkit for TON.

Usage:
    # Security only:
    from tonguard import TonGuard
    guard = TonGuard(daily_limit=10)

    # Full agent kit (12 tools):
    from tonguard import TonAgentKit
    kit = TonAgentKit(daily_limit=10)
    tools = kit.get_tools()
"""

from .guard import TonGuard, TonGuardConfig, GateResult, ConfirmResult, UserStats, PendingTx
from .store import MemoryStore, TonGuardStore
from .kit import TonAgentKit, AgentTool

__all__ = [
    # Security
    "TonGuard",
    "TonGuardConfig",
    "GateResult",
    "ConfirmResult",
    "UserStats",
    "PendingTx",
    "MemoryStore",
    "TonGuardStore",
    # Agent Kit
    "TonAgentKit",
    "AgentTool",
]

__version__ = "1.0.0"
