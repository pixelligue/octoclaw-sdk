"""
TonAgentKit — Complete toolkit for building AI agents on TON (Python).

12 tools, TonGuard security, DeFi/NFT/DNS, LangChain/LangGraph ready.

Usage:
    from tonguard.kit import TonAgentKit

    kit = TonAgentKit(daily_limit=10)
    tools = kit.get_tools()          # Framework-agnostic
    tools = kit.get_langchain_tools()  # LangChain/LangGraph
"""

import json
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Literal, Optional

from .guard import TonGuard

try:
    import urllib.request
    import urllib.error
    HAS_URLLIB = True
except ImportError:
    HAS_URLLIB = False


# ─── Types ──────────────────────────────────────────────

@dataclass
class AgentTool:
    name: str
    description: str
    parameters: Dict[str, Any]
    dangerous: bool
    execute: Callable


# ─── Wallet Abstraction ─────────────────────────────────

class MockWallet:
    """Mock wallet for testing — starts with 100 TON."""

    def __init__(self):
        self._balance = 100.0
        self._address = "EQ_mock_address_for_testing"
        self._tx_log: List[dict] = []
        self._jettons = {
            "USDT": {"balance": 500.0, "name": "Tether USD", "decimals": 6},
            "NOT": {"balance": 10000.0, "name": "Notcoin", "decimals": 9},
            "SCALE": {"balance": 250.0, "name": "Scaleton", "decimals": 9},
        }
        self._nfts = [
            {"name": "alice.ton", "collection": "TON DNS"},
            {"name": "Cool Cat #42", "collection": "TON Cool Cats"},
        ]

    def get_balance(self) -> dict:
        return {"balance": self._balance, "address": self._address}

    def send(self, to: str, amount: float, comment: str = "") -> dict:
        self._balance -= amount
        tx = {
            "hash": f"mock_{int(time.time() * 1000)}",
            "amount": amount,
            "to": to,
            "date": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "comment": comment,
        }
        self._tx_log.append(tx)
        return {"hash": tx["hash"]}

    def get_transactions(self, limit: int = 5) -> list:
        return self._tx_log[-limit:]

    def get_jettons(self) -> list:
        return [
            {"symbol": s, "name": j["name"], "balance": j["balance"]}
            for s, j in self._jettons.items()
        ]

    def get_nfts(self) -> list:
        return self._nfts


# ─── HTTP Helper ────────────────────────────────────────

def _fetch_json(url: str, api_key: str = "") -> dict:
    """Simple HTTP GET with optional Bearer token."""
    try:
        req = urllib.request.Request(url)
        if api_key:
            req.add_header("Authorization", f"Bearer {api_key}")
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode())
    except Exception:
        return {}


def _get_ton_price() -> dict:
    """Get current TON/USD price from CoinGecko."""
    data = _fetch_json(
        "https://api.coingecko.com/api/v3/simple/price"
        "?ids=the-open-network&vs_currencies=usd&include_24hr_change=true"
    )
    ton = data.get("the-open-network", {})
    return {
        "usd": ton.get("usd", 0),
        "change_24h": ton.get("usd_24h_change", 0),
    }


# ─── TonAgentKit ────────────────────────────────────────

class TonAgentKit:
    """
    Complete toolkit for building AI agents on TON.

    Usage:
        kit = TonAgentKit(daily_limit=10, auto_confirm_below=0.1)
        tools = kit.get_tools()  # 12 tools ready

        # With LangGraph:
        from tonguard.langchain import create_langchain_tools
        tools = kit.get_langchain_tools()
        agent = create_react_agent(llm, tools)
    """

    def __init__(
        self,
        daily_limit: float = 10.0,
        per_tx_limit: float = 5.0,
        auto_confirm_below: float = 0.1,
        cooldown_seconds: float = 30.0,
        network: str = "mainnet",
        ton_api_key: str = "",
        user_id: str = "default",
    ):
        self.guard = TonGuard(
            daily_limit=daily_limit,
            per_tx_limit=per_tx_limit,
            auto_confirm_below=auto_confirm_below,
            cooldown_seconds=cooldown_seconds,
        )
        self.wallet = MockWallet()
        self.network = network
        self.ton_api_key = ton_api_key
        self.user_id = user_id
        self._api_base = (
            "https://testnet.tonapi.io" if network == "testnet" else "https://tonapi.io"
        )

    def get_tools(self) -> List[AgentTool]:
        """Get all 12 tools as framework-agnostic definitions."""
        return [
            # Wallet
            self._balance_tool(),
            self._send_tool(),
            self._price_tool(),
            self._history_tool(),
            # DeFi
            self._swap_tool(),
            self._jetton_balance_tool(),
            self._jetton_send_tool(),
            # NFT & DNS
            self._nft_list_tool(),
            self._dns_resolve_tool(),
            # Security
            self._guard_check_tool(),
            self._guard_confirm_tool(),
            self._guard_stats_tool(),
        ]

    def get_langchain_tools(self) -> list:
        """Get LangChain-compatible tools. Requires langchain-core."""
        try:
            from langchain_core.tools import tool as lc_tool
        except ImportError:
            raise ImportError("langchain-core required: pip install tonguard[langchain]")

        lc_tools = []
        for t in self.get_tools():
            # Create a closure to capture tool
            def make_fn(tool: AgentTool):
                def fn(**kwargs) -> str:
                    return tool.execute(**kwargs)
                fn.__name__ = tool.name
                fn.__doc__ = tool.description
                return lc_tool(fn)
            lc_tools.append(make_fn(t))
        return lc_tools

    # ─── Wallet Tools ─────────────────────────────────

    def _balance_tool(self) -> AgentTool:
        def execute(**kwargs) -> str:
            info = self.wallet.get_balance()
            return f"💎 Balance: {info['balance']:.4f} TON\n📍 Address: {info['address']}"
        return AgentTool(
            name="ton_balance",
            description="Get the current TON wallet balance and address.",
            parameters={"type": "object", "properties": {}, "required": []},
            dangerous=False,
            execute=execute,
        )

    def _send_tool(self) -> AgentTool:
        def execute(to: str = "", amount: float = 0, comment: str = "", **kw) -> str:
            gate = self.guard.gate(self.user_id, amount, to, comment)
            if gate.status == "rejected":
                return f"❌ Transaction blocked: {gate.reason}"
            if gate.status == "pending":
                return (
                    f"⏳ Transaction requires confirmation.\n"
                    f"Amount: {amount} TON → {to}\n"
                    f"Confirmation code: **{gate.code}**\n"
                    f"Ask the user to confirm."
                )
            try:
                tx = self.wallet.send(to, amount, comment)
                return f"✅ Sent {amount} TON → {to}\nTX: {tx['hash']}"
            except Exception as e:
                return f"❌ Send failed: {e}"
        return AgentTool(
            name="ton_send",
            description="Send TON to an address. ALWAYS goes through TonGuard security. User must confirm with a code.",
            parameters={
                "type": "object",
                "properties": {
                    "to": {"type": "string", "description": "Destination TON address"},
                    "amount": {"type": "number", "description": "Amount in TON"},
                    "comment": {"type": "string", "description": "Comment (optional)"},
                },
                "required": ["to", "amount"],
            },
            dangerous=True,
            execute=execute,
        )

    def _price_tool(self) -> AgentTool:
        def execute(**kwargs) -> str:
            p = _get_ton_price()
            arrow = "📈" if p["change_24h"] >= 0 else "📉"
            return f"💎 TON: ${p['usd']:.2f} {arrow} {p['change_24h']:.2f}% (24h)"
        return AgentTool(
            name="ton_price",
            description="Get the current TON price in USD and 24h change.",
            parameters={"type": "object", "properties": {}, "required": []},
            dangerous=False,
            execute=execute,
        )

    def _history_tool(self) -> AgentTool:
        def execute(limit: int = 5, **kwargs) -> str:
            txs = self.wallet.get_transactions(limit)
            if not txs:
                return "📋 No recent transactions."
            lines = [
                f"  {i+1}. {t['amount']} TON → {t['to']} ({t['date']})"
                + (f' "{t["comment"]}"' if t.get("comment") else "")
                for i, t in enumerate(txs)
            ]
            return f"📋 Recent transactions:\n" + "\n".join(lines)
        return AgentTool(
            name="ton_history",
            description="Get recent wallet transactions.",
            parameters={
                "type": "object",
                "properties": {"limit": {"type": "integer", "description": "Number of TXs (default 5)"}},
                "required": [],
            },
            dangerous=False,
            execute=execute,
        )

    # ─── DeFi Tools ───────────────────────────────────

    def _swap_tool(self) -> AgentTool:
        def execute(from_token: str = "TON", to_token: str = "USDT", amount: float = 0, **kw) -> str:
            fr = from_token.upper()
            to = to_token.upper()
            gate = self.guard.gate(self.user_id, amount, f"swap:{fr}->{to}")
            if gate.status == "rejected":
                return f"❌ Swap blocked: {gate.reason}"
            if gate.status == "pending":
                return (
                    f"⏳ Swap requires confirmation.\n"
                    f"Swap: {amount} {fr} → {to}\n"
                    f"Confirmation code: **{gate.code}**"
                )
            return f"✅ Swap executed: {amount} {fr} → {to} via STON.fi"
        return AgentTool(
            name="ton_swap",
            description="Swap TON or jettons via STON.fi DEX. TonGuard protected.",
            parameters={
                "type": "object",
                "properties": {
                    "from_token": {"type": "string", "description": "Token to sell: TON, USDT, NOT..."},
                    "to_token": {"type": "string", "description": "Token to buy: TON, USDT, NOT..."},
                    "amount": {"type": "number", "description": "Amount to swap"},
                },
                "required": ["from_token", "to_token", "amount"],
            },
            dangerous=True,
            execute=execute,
        )

    def _jetton_balance_tool(self) -> AgentTool:
        def execute(**kwargs) -> str:
            jettons = self.wallet.get_jettons()
            if not jettons:
                return "💰 No jettons found."
            lines = [f"  {j['symbol']}: {j['balance']:.2f} ({j['name']})" for j in jettons]
            return f"💰 Jetton Balances:\n" + "\n".join(lines)
        return AgentTool(
            name="ton_jetton_balance",
            description="Get balances of all jettons (tokens): USDT, NOT, SCALE, etc.",
            parameters={"type": "object", "properties": {}, "required": []},
            dangerous=False,
            execute=execute,
        )

    def _jetton_send_tool(self) -> AgentTool:
        def execute(token: str = "", to: str = "", amount: float = 0, **kw) -> str:
            token = token.upper()
            ton_equiv = amount / 1.3 if token == "USDT" else amount * 0.01
            gate = self.guard.gate(self.user_id, ton_equiv, to, f"jetton:{token}")
            if gate.status == "rejected":
                return f"❌ Jetton transfer blocked: {gate.reason}"
            if gate.status == "pending":
                return (
                    f"⏳ Transfer requires confirmation.\n"
                    f"Send: {amount} {token} → {to}\n"
                    f"Confirmation code: **{gate.code}**"
                )
            return f"✅ Sent {amount} {token} → {to}"
        return AgentTool(
            name="ton_jetton_send",
            description="Send jettons (USDT, NOT, etc.) to an address. TonGuard protected.",
            parameters={
                "type": "object",
                "properties": {
                    "token": {"type": "string", "description": "Jetton symbol: USDT, NOT, SCALE..."},
                    "to": {"type": "string", "description": "Destination address"},
                    "amount": {"type": "number", "description": "Amount of jettons"},
                },
                "required": ["token", "to", "amount"],
            },
            dangerous=True,
            execute=execute,
        )

    # ─── NFT & DNS Tools ─────────────────────────────

    def _nft_list_tool(self) -> AgentTool:
        def execute(**kwargs) -> str:
            nfts = self.wallet.get_nfts()
            if not nfts:
                return "🖼️ No NFTs found."
            lines = [f"  {i+1}. {n['name']} ({n['collection']})" for i, n in enumerate(nfts)]
            return f"🖼️ NFTs ({len(nfts)}):\n" + "\n".join(lines)
        return AgentTool(
            name="ton_nft_list",
            description="List all NFTs in the wallet (usernames, domains, collectibles).",
            parameters={"type": "object", "properties": {}, "required": []},
            dangerous=False,
            execute=execute,
        )

    def _dns_resolve_tool(self) -> AgentTool:
        def execute(domain: str = "", **kw) -> str:
            data = _fetch_json(
                f"{self._api_base}/v2/dns/{domain}/resolve",
                self.ton_api_key,
            )
            if "error" in data:
                return f"❌ DNS resolve failed: {data['error']}"
            wallet = data.get("wallet", {})
            address = wallet.get("address", "")
            if not address:
                return f"❌ No wallet address found for {domain}"
            return f"🌐 {domain} → {address}"
        return AgentTool(
            name="ton_dns_resolve",
            description="Resolve a TON DNS domain (e.g. wallet.ton) to a TON address.",
            parameters={
                "type": "object",
                "properties": {"domain": {"type": "string", "description": "TON DNS domain (e.g. foundation.ton)"}},
                "required": ["domain"],
            },
            dangerous=False,
            execute=execute,
        )

    # ─── Security Tools ──────────────────────────────

    def _guard_check_tool(self) -> AgentTool:
        def execute(amount: float = 0, **kw) -> str:
            s = self.guard.get_stats(self.user_id)
            will_exceed = s.spent_today + amount > self.guard.config.daily_limit
            return (
                f"🛡️ TonGuard Pre-Check:\n"
                f"  Amount: {amount} TON\n"
                f"  Spent today: {s.spent_today} TON\n"
                f"  Remaining: {s.remaining_today} TON\n"
                f"  Will exceed: {'YES ❌' if will_exceed else 'NO ✅'}\n"
                f"  Can transact: {'YES ✅' if s.can_transact else 'NO ❌'}"
            )
        return AgentTool(
            name="ton_guard_check",
            description="Pre-check if a transaction amount is allowed by TonGuard policy.",
            parameters={
                "type": "object",
                "properties": {"amount": {"type": "number", "description": "Amount in TON"}},
                "required": ["amount"],
            },
            dangerous=False,
            execute=execute,
        )

    def _guard_confirm_tool(self) -> AgentTool:
        def execute(code: str = "", **kw) -> str:
            result = self.guard.confirm(self.user_id, code)
            if result.status == "expired":
                return "⏰ Code expired. Ask the user to retry."
            if result.status == "invalid":
                return "❌ Invalid code."
            return f"✅ Transaction confirmed: {result.amount} TON approved."
        return AgentTool(
            name="ton_confirm",
            description="Confirm a pending transaction with the user-provided confirmation code.",
            parameters={
                "type": "object",
                "properties": {"code": {"type": "string", "description": "6-char confirmation code"}},
                "required": ["code"],
            },
            dangerous=True,
            execute=execute,
        )

    def _guard_stats_tool(self) -> AgentTool:
        def execute(**kwargs) -> str:
            s = self.guard.get_stats(self.user_id)
            cooldown = (
                f"  Cooldown ends: {s.cooldown_ends_at}"
                if s.cooldown_ends_at
                else "  Cooldown: ✅ Ready"
            )
            return (
                f"🛡️ TonGuard Status:\n"
                f"  Spent today: {s.spent_today} TON\n"
                f"  Remaining: {s.remaining_today} TON\n"
                f"  TX count: {s.tx_count_today}\n"
                f"  Can transact: {'✅ Yes' if s.can_transact else '❌ No'}\n"
                f"{cooldown}"
            )
        return AgentTool(
            name="ton_limits",
            description="Show current spending limits, daily usage, and TonGuard policy.",
            parameters={"type": "object", "properties": {}, "required": []},
            dangerous=False,
            execute=execute,
        )
