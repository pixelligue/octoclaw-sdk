"""LangChain / LangGraph integration for TonGuard."""

from typing import Optional

from .guard import TonGuard


def create_langchain_tools(guard: TonGuard, user_id: str) -> list:
    """
    Create LangChain-compatible tools for TonGuard.

    Usage with LangGraph:
        from tonguard import TonGuard
        from tonguard.langchain import create_langchain_tools
        from langgraph.prebuilt import create_react_agent

        guard = TonGuard(daily_limit=10)
        tools = create_langchain_tools(guard, "user-123")
        agent = create_react_agent(llm, tools)
    """
    try:
        from langchain_core.tools import tool as lc_tool
    except ImportError:
        raise ImportError(
            "langchain-core is required: pip install tonguard[langchain]"
        )

    @lc_tool
    def ton_guard_check(amount: float, to_address: str = "", comment: str = "") -> str:
        """Check if a TON transaction is allowed by TonGuard security policy.
        Call BEFORE sending any TON. Returns approved/pending/rejected."""
        result = guard.gate(user_id, amount, to_address or None, comment or None)
        if result.status == "approved":
            return f"✅ APPROVED: {result.amount} TON auto-confirmed."
        elif result.status == "pending":
            return (
                f"⏳ PENDING: Confirm code \"{result.code}\" to approve {result.amount} TON. "
                f"Expires: {result.expires_at}. Ask the user to confirm."
            )
        else:
            return f"❌ REJECTED: {result.reason}"

    @lc_tool
    def ton_guard_confirm(code: str) -> str:
        """Confirm a pending TON transaction with the user-provided confirmation code."""
        result = guard.confirm(user_id, code)
        if result.status == "approved":
            return f"✅ CONFIRMED: {result.amount} TON approved. Proceed."
        elif result.status == "expired":
            return "⏰ EXPIRED: Code expired. Request a new one."
        else:
            return "❌ INVALID: Code not found or already used."

    @lc_tool
    def ton_guard_stats() -> str:
        """Get current spending stats and daily limits."""
        s = guard.get_stats(user_id)
        return (
            f"📊 Spent today: {s.spent_today} TON | "
            f"Remaining: {s.remaining_today} TON | "
            f"TX count: {s.tx_count_today} | "
            f"Can transact: {'yes' if s.can_transact else 'no'}"
        )

    return [ton_guard_check, ton_guard_confirm, ton_guard_stats]


def create_tools_dict(guard: TonGuard, user_id: str) -> list[dict]:
    """
    Framework-agnostic tool definitions (dict format).
    Works with any agent framework.
    """
    return [
        {
            "name": "ton_guard_check",
            "description": "Check if a TON transaction is allowed. Call BEFORE sending TON.",
            "parameters": {
                "type": "object",
                "properties": {
                    "amount": {"type": "number", "description": "Amount in TON"},
                    "to_address": {"type": "string", "description": "Destination address"},
                    "comment": {"type": "string", "description": "Comment (optional)"},
                },
                "required": ["amount"],
            },
            "execute": lambda args: _gate_wrapper(guard, user_id, args),
        },
        {
            "name": "ton_guard_confirm",
            "description": "Confirm a pending transaction with the confirmation code.",
            "parameters": {
                "type": "object",
                "properties": {
                    "code": {"type": "string", "description": "6-char confirmation code"},
                },
                "required": ["code"],
            },
            "execute": lambda args: _confirm_wrapper(guard, user_id, args),
        },
    ]


def _gate_wrapper(guard: TonGuard, user_id: str, args: dict) -> str:
    result = guard.gate(user_id, args["amount"], args.get("to_address"), args.get("comment"))
    if result.status == "approved":
        return f"✅ APPROVED: {result.amount} TON"
    elif result.status == "pending":
        return f"⏳ PENDING: Code \"{result.code}\", expires {result.expires_at}"
    return f"❌ REJECTED: {result.reason}"


def _confirm_wrapper(guard: TonGuard, user_id: str, args: dict) -> str:
    result = guard.confirm(user_id, args["code"])
    if result.status == "approved":
        return f"✅ CONFIRMED: {result.amount} TON"
    elif result.status == "expired":
        return "⏰ EXPIRED"
    return "❌ INVALID"
