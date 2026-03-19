# @octoclaw/ton-agent-kit

> Complete toolkit for building AI agents on TON. 12 tools, TonGuard security, DeFi/NFT/DNS, LangChain/LangGraph ready. One import = full TON agent.

## Install

```bash
npm install @octoclaw/ton-agent-kit

# For real TON transactions:
npm install @ton/ton @ton/crypto

# For LangChain/LangGraph:
npm install @langchain/core
```

## Quick Start — 5 Lines

```typescript
import { TonAgentKit } from '@octoclaw/ton-agent-kit';

const kit = new TonAgentKit({
  mnemonic: process.env.TON_MNEMONIC,  // 24 words
  guard: { dailyLimitTon: 10, autoConfirmBelow: 0.1 },
});

const tools = kit.getTools();
// → 12 tools: ton_balance, ton_send, ton_price, ton_history,
//   ton_swap, ton_jetton_balance, ton_jetton_send,
//   ton_nft_list, ton_dns_resolve, ton_guard_check, ...
```

## With LangGraph

```typescript
import { TonAgentKit } from '@octoclaw/ton-agent-kit';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { ChatOpenAI } from '@langchain/openai';

const kit = new TonAgentKit({
  mnemonic: process.env.TON_MNEMONIC,
  guard: { dailyLimitTon: 10 },
});

const llm = new ChatOpenAI({ model: 'gpt-4o' });
const agent = createReactAgent({ llm, tools: kit.getLangChainTools() });

// Agent automatically:
// ✅ Checks balance before sending
// ✅ Generates confirmation codes for large amounts
// ✅ Respects daily limits and cooldowns
// ✅ Gets live TON price

const result = await agent.invoke({
  messages: [{ role: 'user', content: 'Send 5 TON to EQxyz...' }],
});
```

## With LangChain

```typescript
import { TonAgentKit } from '@octoclaw/ton-agent-kit';
import { AgentExecutor, createOpenAIToolsAgent } from 'langchain/agents';

const kit = new TonAgentKit({ mnemonic: process.env.TON_MNEMONIC });
const tools = kit.getLangChainTools();

const agent = createOpenAIToolsAgent({ llm, tools, prompt });
const executor = new AgentExecutor({ agent, tools });
```

## Testing Mode (No Mnemonic)

```typescript
// No mnemonic = mock wallet with 100 TON
const kit = new TonAgentKit();
const tools = kit.getTools();

// Perfect for development and testing
const result = await tools[0].execute({});
// → "💎 Balance: 100.0000 TON\n📍 Address: EQ_mock_address_for_testing"
```

## Tools Reference

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

## TonGuard Security — Built In

Every `ton_send` call passes through TonGuard automatically:

```
User: "Send 5 TON to EQxyz..."
  ↓
Agent calls ton_send(to="EQxyz...", amount=5)
  ↓
TonGuard.gate():
  ├── ✅ Amount < per-tx limit (5 TON)
  ├── ✅ Daily spent + 5 < daily limit (10 TON)
  ├── ✅ Cooldown passed
  └── ⏳ Amount > auto-confirm (0.1) → generate code
  ↓
Agent: "Confirm code A7K2X9 to approve 5 TON transfer"
  ↓
User: "A7K2X9"
  ↓
Agent calls ton_confirm(code="A7K2X9")
  ↓
✅ Transaction executed
```

## Config

```typescript
new TonAgentKit({
  mnemonic: '24 words...',         // Wallet seed (optional for testing)
  network: 'mainnet',              // or 'testnet'
  apiEndpoint: 'https://...',      // Custom RPC endpoint
  apiKey: 'your-key',              // TonCenter API key
  tonApiKey: 'your-key',           // TonAPI key (jettons, NFTs, DNS)

  guard: {
    dailyLimitTon: 10,             // Max TON per 24h
    perTxLimitTon: 5,              // Max per transaction
    autoConfirmBelow: 0.1,         // Auto-confirm threshold
    cooldownMs: 30000,             // 30s between TXs
    codeExpiryMs: 300000,          // 5 min code TTL
  },
});
```

## Comparison

| Feature | tonapi-langchain-tools | TON Agent Kit | **@octoclaw/ton-agent-kit** |
|---------|:-----:|:-----:|:-----:|
| Total tools | 5 | 15 pkgs | **12 (one package)** |
| Balance | ✅ | ✅ | ✅ |
| Send | ✅ (raw) | ✅ (raw) | ✅ + **TonGuard** |
| Swap (DEX) | ❌ | ✅ | ✅ + **TonGuard** |
| Jetton balance | ✅ | ✅ | ✅ |
| Jetton send | ❌ | ✅ | ✅ + **TonGuard** |
| NFTs | ❌ | ❌ | ✅ |
| DNS resolve | ❌ | ❌ | ✅ |
| Security | ❌ | ❌ | ✅ Confirmation codes |
| Daily limits | ❌ | ❌ | ✅ Configurable |
| Cooldowns | ❌ | ❌ | ✅ Built-in |
| Price feed | ❌ | ✅ | ✅ |
| LangChain | ✅ | ✅ | ✅ |
| LangGraph | ❌ | ✅ | ✅ |
| Mock testing | ❌ | ❌ | ✅ |
| Framework-agnostic | ❌ | ❌ | ✅ |

## License

MIT — [OctoClaw](https://github.com/nicenemo/octoclaw-engine)
