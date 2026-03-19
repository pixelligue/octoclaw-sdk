# tonguard

> Complete toolkit for building AI agents on TON. 12 tools, TonGuard security, DeFi/NFT/DNS. Works with LangChain, LangGraph, or any framework.

## Install

```bash
pip install tonguard

# With LangChain/LangGraph support:
pip install tonguard[langchain]
```

## Quick Start — Full Agent Kit

```python
from tonguard import TonAgentKit

kit = TonAgentKit(
    daily_limit=10,          # max 10 TON per day
    auto_confirm_below=0.1,  # auto-approve below 0.1 TON
)

tools = kit.get_tools()
# → 12 tools: ton_balance, ton_send, ton_price, ton_history,
#   ton_swap, ton_jetton_balance, ton_jetton_send,
#   ton_nft_list, ton_dns_resolve, ton_guard_check, ...

# Use any tool:
print(tools[0].execute())       # → 💎 Balance: 100.0000 TON
print(tools[2].execute())       # → 💎 TON: $3.45 📈 2.1% (24h)
print(tools[5].execute())       # → 💰 Jetton Balances: USDT: 500.00
print(tools[7].execute())       # → 🖼️ NFTs (2): alice.ton, Cool Cat #42
```

## With LangGraph

```python
from tonguard import TonAgentKit
from langgraph.prebuilt import create_react_agent
from langchain_openai import ChatOpenAI

kit = TonAgentKit(daily_limit=10)
tools = kit.get_langchain_tools()

llm = ChatOpenAI(model="gpt-4o")
agent = create_react_agent(llm, tools)

# Agent automatically:
# ✅ Checks balance before sending
# ✅ Generates confirmation codes
# ✅ Respects daily limits and cooldowns
# ✅ Swaps tokens, checks jettons, lists NFTs

result = agent.invoke({
    "messages": [("user", "Send 5 TON to EQxyz...")]
})
```

## Security Only (TonGuard)

```python
from tonguard import TonGuard

guard = TonGuard(daily_limit=10, auto_confirm_below=0.1)

result = guard.gate("user-123", 5.0)
if result.status == "pending":
    print(f"Confirm: {result.code}")

confirm = guard.confirm("user-123", "A7K2X9")
```

## Tools Reference (12 total)

| Tool | Description | Dangerous |
|------|-------------|:---------:|
| **Wallet** | | |
| `ton_balance` | Wallet balance and address | No |
| `ton_send` | Send TON (TonGuard protected) | ✅ Yes |
| `ton_price` | Live TON/USD price + 24h change | No |
| `ton_history` | Recent transactions | No |
| **DeFi** | | |
| `ton_swap` | Swap via STON.fi (TonGuard protected) | ✅ Yes |
| `ton_jetton_balance` | All jetton balances (USDT, NOT, SCALE...) | No |
| `ton_jetton_send` | Send jettons (TonGuard protected) | ✅ Yes |
| **NFT & DNS** | | |
| `ton_nft_list` | List NFTs (usernames, domains, collectibles) | No |
| `ton_dns_resolve` | Resolve .ton domains to addresses | No |
| **Security** | | |
| `ton_guard_check` | Pre-check spending policy | No |
| `ton_confirm` | Confirm pending transaction | ✅ Yes |
| `ton_limits` | Current spending stats | No |

## Config

```python
TonAgentKit(
    daily_limit=10,          # Max TON per 24h
    per_tx_limit=5,          # Max per transaction
    auto_confirm_below=0.1,  # Auto-approve threshold
    cooldown_seconds=30,     # Seconds between TXs
    network="mainnet",       # or "testnet"
    ton_api_key="...",       # TonAPI key (jettons, NFTs, DNS)
    user_id="default",       # User identifier
)
```

## TonGuard Security — Built In

```
User: "Send 5 TON to EQxyz..."
  ↓
Agent calls ton_send(to="EQxyz...", amount=5)
  ↓
TonGuard.gate():
  ├── ✅ Amount < per-tx limit
  ├── ✅ Daily spent + 5 < daily limit
  ├── ✅ Cooldown passed
  └── ⏳ Amount > auto-confirm → code "A7K2X9"
  ↓
Agent: "Confirm code A7K2X9"
  ↓
User: "A7K2X9"
  ↓
✅ Transaction executed
```

## Custom Store

```python
from tonguard.store import TonGuardStore

class RedisStore(TonGuardStore):
    # Implement: get_pending, set_pending, etc.
    ...

from tonguard import TonAgentKit, TonGuard
guard = TonGuard(store=RedisStore())
```

## License

MIT — [OctoClaw](https://github.com/nicenemo/octoclaw-engine)
