# OctoClaw Agent Economy Protocol

**Version**: 1.0 | **Status**: Implemented | **Authors**: OctoClaw Team

## Overview

A protocol for agent-to-agent payments and skill monetization on TON. Enables three primitives missing from the TON ecosystem:

1. **Per-call billing** — pay TON for each skill tool invocation
2. **Revenue sharing** — automatic 70/30 split (author/platform)
3. **MCP tool bridging** — any MCP server becomes a billable TON service

## Architecture

```
┌──────────┐    tool call    ┌──────────────┐    deduct     ┌─────────┐
│  Agent   │──────────────→  │ SkillRuntime │────────────→  │ Tenant  │
│  (LLM)   │                 │   Billing    │               │ Balance │
└──────────┘                 └──────┬───────┘               └─────────┘
                                    │
                              record TX
                                    │
                             ┌──────▼───────┐
                             │    TON TX     │
                             │   Database    │
                             └──────┬───────┘
                                    │
                              revenue split
                            ┌───────┴────────┐
                            │                │
                       ┌────▼─────┐    ┌─────▼──────┐
                       │  Author  │    │  Platform  │
                       │  70%     │    │   30%      │
                       └──────────┘    └────────────┘
```

## Skill Pricing Model

```typescript
interface SkillPricing {
  priceModel: 'free' | 'paid' | 'per_use';
  priceTon: number | null;     // one-time install fee
  pricePerCall: number | null; // cost per tool invocation
  authorWallet: string | null; // TON address for payouts
}
```

| Model | When Charged | Use Case |
|-------|-------------|----------|
| `free` | Never | Open source skills |
| `paid` | On install | Premium skill packages |
| `per_use` | Each tool call | API-like usage billing |

## Billing Flow

```
1. Agent calls skill tool (e.g., seo_analyze)
2. SkillRuntime looks up ClawHubSkill.pricePerCall
3. If pricePerCall > 0:
   a. Load tenant.tonBalance
   b. If balance < pricePerCall → return "Insufficient funds"
   c. Deduct: tenant.tonBalance -= pricePerCall
   d. Record: ton_transactions { type: 'skill_payment' }
   e. Log: author share (70%) + platform share (30%)
4. Execute skill handler in VM sandbox
5. Return result to agent
```

## Tenant Balance

### Top-up Methods

| Method | Flow | Status |
|--------|------|--------|
| **Direct TON** | Send TON → `POST /api/wallet/:id/deposit` | ✅ Implemented |
| **Telegram Stars** | `/topup` → Stars purchase → auto-convert → balance | ✅ Implemented |
| **Agent deposit** | Agent calls `ton_deposit` tool | Planned |

### Conversion Rate

```
Stars → TON: 350 Stars ≈ 1 TON (market rate)
```

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/wallet/:tenantId/balance` | Current TON balance |
| POST | `/api/wallet/:tenantId/deposit` | Credit balance |
| GET | `/api/wallet/:tenantId/history` | Transaction history |

### Balance Response
```json
{
  "tenantId": "uuid",
  "balance": 1.5,
  "wallet": "EQ...",
  "plan": "trial"
}
```

### Deposit Request
```json
{
  "amount": 1.0,
  "txHash": "optional-on-chain-hash",
  "fromAddress": "optional-sender"
}
```

## MCP-to-TON Bridge

Any MCP server can be monetized through OctoClaw:

```
1. Author publishes MCP server (e.g., ton-defi-tools)
2. Author registers on OctaStore with pricePerCall: 0.005 TON
3. User connects: mcp_connect(name="defi", url="...")
4. Each MCP tool call → billing check → deduct → proxy → result
```

This turns any MCP-compatible service into a TON-billable API.

## Transaction Record

All payments are recorded in `ton_transactions`:

```typescript
{
  id: "uuid",
  tenantId: "uuid",
  type: "skill_payment",  // or send, swap, deposit, pay_agent
  status: "completed",
  amount: 0.01,
  toAddress: "EQ...",     // author wallet
  comment: "Skill: seo-analyzer / seo_analyze",
  createdAt: "2026-03-15T..."
}
```

## Security

- Balance checks are atomic (read → compare → deduct in single flow)
- Skill handlers execute in V8 sandbox with 30s timeout
- Revenue share is enforced server-side, not by the LLM
- Transaction history is immutable and auditable

## Reference Implementation

| Component | File |
|-----------|------|
| Skill pricing fields | `src/database/entities/clawhub-skill.entity.ts` |
| Tenant balance | `src/database/entities/tenant.entity.ts` |
| Billing logic | `src/octastore/skill-runtime.service.ts` |
| Wallet API | `src/skills/ton-wallet/wallet.controller.ts` |
| Stars integration | `src/channels/telegram/telegram-bot-manager.service.ts` |
| Transaction service | `src/skills/ton-wallet/ton-transaction.service.ts` |
