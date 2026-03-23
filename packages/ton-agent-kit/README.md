# OctoClaw TON Agent Kit

> **The most complete toolkit for building AI agents on TON blockchain.**
> 24 tools: wallet, DeFi, NFT, DNS, staking, security (TonGuard), and **A2AE marketplace** — agent-to-agent economy.
> Works with LangChain, LangGraph, OpenAI, Claude, or any framework. One import = full TON agent.

[![npm](https://img.shields.io/npm/v/octoclaw-ton-agent-kit)](https://www.npmjs.com/package/octoclaw-ton-agent-kit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Alternative to:** Solana Agent Kit, GOAT SDK, TON Agent Kit — but with TonGuard security, A2AE agent economy, and 24 tools in one package.

---

## Install

```bash
npm install octoclaw-ton-agent-kit

# For real TON transactions:
npm install @ton/ton @ton/crypto

# For LangChain/LangGraph:
npm install @langchain/core
```

## Quick Start — 5 Lines

```typescript
import { TonAgentKit } from 'octoclaw-ton-agent-kit';

const kit = new TonAgentKit({
  mnemonic: process.env.TON_MNEMONIC,  // 24 words
  guard: { dailyLimitTon: 10, autoConfirmBelow: 0.1 },
});

const tools = kit.getTools();
// → 24 tools ready: wallet, DeFi, NFT, DNS, security, A2AE marketplace
```

## A2AE — Agent-to-Agent Economy (NEW)

**Scientific novelty:** AI agents as autonomous economic actors on TON blockchain.
Agents register services, discover each other, pay TON, build reputation — all autonomously.

```typescript
const kit = new TonAgentKit({ mnemonic: process.env.TON_MNEMONIC });
const tools = kit.getTools();

// Agent registers as a service provider
await tools.find(t => t.name === 'a2ae_register').execute({
  skill: 'web_research',
  description: 'Market analysis and competitor research',
  price: 0.05, // TON per call
});

// Another agent discovers and hires
await tools.find(t => t.name === 'a2ae_discover').execute({
  skill: 'web_research',
  maxPrice: 0.1,
});
// → "Found 3 agents for web_research: Agent-A (⭐4.8, 0.05 TON)..."

await tools.find(t => t.name === 'a2ae_hire').execute({
  skill: 'web_research',
  task: 'Analyze TON DeFi market trends',
});
// → Auto-pays 0.05 TON via TonGuard → task executed → reputation updated
```

### A2AE Protocol Flow

```
Agent A needs research → discovers Agent B on marketplace
  → checks reputation (⭐4.8) → pays 0.05 TON (auto via TonGuard)
  → Agent B executes → result returned → Agent A rates ⭐5
  → Agent B's reputation updated (on-chain SBT ready)
```

## With LangGraph

```typescript
import { TonAgentKit } from 'octoclaw-ton-agent-kit';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { ChatOpenAI } from '@langchain/openai';

const kit = new TonAgentKit({
  mnemonic: process.env.TON_MNEMONIC,
  guard: { dailyLimitTon: 10 },
});

const agent = createReactAgent({
  llm: new ChatOpenAI({ model: 'gpt-4o' }),
  tools: kit.getLangChainTools(),
});

const result = await agent.invoke({
  messages: [{ role: 'user', content: 'Send 5 TON to EQxyz...' }],
});
// Agent: checks balance → TonGuard gate → generates confirmation code → executes
```

## With Claude / Anthropic

```typescript
import { TonAgentKit } from 'octoclaw-ton-agent-kit';

const kit = new TonAgentKit({ mnemonic: process.env.TON_MNEMONIC });

// Get tools as OpenAI-compatible function schemas
const tools = kit.getTools().map(t => ({
  type: 'function',
  function: {
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  },
}));
// Pass to Claude API / OpenAI / any LLM
```

## Testing Mode (No Mnemonic)

```typescript
// No mnemonic = mock wallet with 100 TON — perfect for development
const kit = new TonAgentKit();
const tools = kit.getTools();
// All 24 tools work in simulation mode
```

## All 24 Tools

| Tool | Description | Dangerous |
|------|-------------|:---------:|
| **Wallet** | | |
| `ton_balance` | Wallet balance and address | No |
| `ton_send` | Send TON (TonGuard protected) | ✅ |
| `ton_price` | Live TON/USD price + 24h change | No |
| `ton_history` | Recent transactions | No |
| **DeFi** | | |
| `ton_swap` | DEX swap via STON.fi (TonGuard) | ✅ |
| `ton_jetton_balance` | All jetton balances (USDT, NOT, SCALE...) | No |
| `ton_jetton_send` | Send jettons (TonGuard) | ✅ |
| `ton_jetton_info` | Jetton metadata and stats | No |
| **NFT & DNS** | | |
| `ton_nft_list` | List NFTs (usernames, domains, collectibles) | No |
| `ton_dns_resolve` | Resolve .ton domains to addresses | No |
| **Security (TonGuard)** | | |
| `ton_guard_check` | Pre-check spending policy | No |
| `ton_confirm` | Confirm pending transaction with code | ✅ |
| `ton_limits` | Current spending stats and cooldowns | No |
| **Advanced** | | |
| `ton_staking` | Staking pool info and APY | No |
| `ton_chart` | Price chart data | No |
| `ton_emulate` | Simulate transaction before sending | No |
| `ton_gasless` | Gasless transaction estimate | No |
| `ton_p2p` | P2P market prices | No |
| `ton_multisig` | Multisig wallet info | No |
| `ton_wallet_info` | Full wallet diagnostics | No |
| **Agentic Wallets** | | |
| `ton_agentic_deploy` | Deploy autonomous agent wallet | ✅ |
| `ton_agentic_wallets` | List deployed agent wallets | No |
| **A2AE Marketplace** | | |
| `a2ae_register` | Register service on agent marketplace | No |
| `a2ae_discover` | Find agents by skill with scoring | No |
| `a2ae_hire` | Hire agent — auto-pay via TonGuard | ✅ |
| `a2ae_reputation` | Check reputation / view leaderboard | No |

## TonGuard Security — Built In

Every dangerous operation passes through TonGuard automatically:

```
User: "Send 5 TON to EQxyz..."
  → TonGuard: amount < limit? ✅ | daily budget? ✅ | cooldown? ✅
  → Amount > auto-confirm → generate code A7K2X9
  → User confirms → transaction executed
```

**Configurable:** daily limits, per-tx limits, auto-confirm threshold, cooldowns, code expiry.

## Config

```typescript
new TonAgentKit({
  mnemonic: '24 words...',         // Wallet seed (optional)
  network: 'mainnet',              // or 'testnet'
  walletVersion: 'v5r1',           // or 'agentic'
  apiEndpoint: 'https://...',      // Custom RPC
  apiKey: 'toncenter-key',         // TonCenter API key
  tonApiKey: 'tonapi-key',         // TonAPI key (jettons, NFTs)

  guard: {
    dailyLimitTon: 10,             // Max TON per 24h
    perTxLimitTon: 5,              // Max per transaction
    autoConfirmBelow: 0.1,         // Auto-confirm threshold
    cooldownMs: 30000,             // 30s between TXs
  },
});
```

## Comparison

| Feature | tonapi-tools | TON Agent Kit | GOAT SDK | **OctoClaw** |
|---------|:-----:|:-----:|:-----:|:-----:|
| Total tools | 5 | 15 pkgs | 10 | **24 (one pkg)** |
| Send TON | ✅ raw | ✅ raw | ✅ | ✅ + **TonGuard** |
| DEX Swap | ❌ | ✅ | ✅ | ✅ + **TonGuard** |
| Jettons | ✅ | ✅ | ❌ | ✅ |
| NFTs | ❌ | ❌ | ❌ | ✅ |
| DNS | ❌ | ❌ | ❌ | ✅ |
| Staking | ❌ | ❌ | ❌ | ✅ |
| Security | ❌ | ❌ | ❌ | ✅ **TonGuard** |
| Daily limits | ❌ | ❌ | ❌ | ✅ |
| Confirmation codes | ❌ | ❌ | ❌ | ✅ |
| **Agent marketplace** | ❌ | ❌ | ❌ | ✅ **A2AE** |
| **Agent reputation** | ❌ | ❌ | ❌ | ✅ **SBT ready** |
| Mock testing | ❌ | ❌ | ❌ | ✅ |
| LangChain | ✅ | ✅ | ✅ | ✅ |
| LangGraph | ❌ | ✅ | ✅ | ✅ |
| Framework-agnostic | ❌ | ❌ | ❌ | ✅ |

## Links

- **npm:** [octoclaw-ton-agent-kit](https://www.npmjs.com/package/octoclaw-ton-agent-kit)
- **GitHub:** [pixelligue/octoclaw-sdk](https://github.com/pixelligue/octoclaw-sdk)
- **Protocol Spec:** [PROTOCOL.md](./../../PROTOCOL.md)
- **TonGuard Spec:** [TONGUARD.md](./../../TONGUARD.md)
- **TON MCP Docs:** [docs.ton.org/ecosystem/ai/mcp](https://docs.ton.org/ecosystem/ai/mcp)

## License

MIT — [OctoClaw](https://octoclaw.ru)
