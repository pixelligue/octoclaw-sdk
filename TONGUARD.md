# TonGuard: Secure Agent Transaction Protocol for TON

**Version**: 1.0 | **Status**: Implemented | **Authors**: OctoClaw Team

## Problem

AI agents with wallet access can drain funds via prompt injection, hallucinated tool calls, or infinite loops. No existing TON project provides a security layer between the LLM and the wallet.

## Solution

TonGuard is a server-side security protocol that prevents unauthorized transactions by enforcing confirmation codes, spending policies, and human-in-the-loop approval.

**Key principle**: The LLM never has direct wallet access. Every transaction passes through TonGuard, which is outside the LLM's control.

## Protocol Flow

```
User → "Send 5 TON to EQ..."
  ↓
LLM → calls ton_send(to, amount)
  ↓
TonGuard.gate()
  ├── Check daily limit     → REJECT if exceeded
  ├── Check cooldown        → REJECT if too soon
  ├── Check auto-confirm    → AUTO-APPROVE if amount < threshold
  └── Generate confirm code → PENDING (requires user approval)
  ↓
Agent returns: "Confirm TX-A7K2: 5 TON → EQ... Send code A7K2 to confirm."
  ↓
[Telegram: inline button ✅ Confirm / ❌ Cancel]
  ↓
User clicks ✅ → code "A7K2" sent back
  ↓
TonGuard.confirm("A7K2")
  ├── Validate code exists
  ├── Check not expired (5 min TTL)
  ├── Check tenant match
  └── Execute transaction
  ↓
TON blockchain → TX hash returned
```

## Security Properties

| Property | Implementation |
|----------|---------------|
| **Code unpredictability** | 6-char alphanumeric, `crypto.randomBytes(4)` |
| **Time-limited** | 5-minute expiry, enforced server-side |
| **One-time use** | Code deleted after confirmation or expiry |
| **Tenant isolation** | Codes scoped to `tenantId` |
| **LLM cannot bypass** | Codes generated outside LLM context, never in prompt |
| **Rate limiting** | Configurable cooldown between transactions |

## Policy Engine

```typescript
interface TonGuardPolicy {
  dailyLimitTon: number;      // Max TON per 24h (default: 10)
  perTxLimitTon: number;      // Max per transaction (default: 5)
  autoConfirmBelow: number;   // Skip confirmation below this (default: 0.1)
  cooldownMs: number;         // Min ms between TXs (default: 30000)
  codeExpiryMs: number;       // Confirmation code TTL (default: 300000)
}
```

Policies are per-tenant and stored in the database.

## Transaction Types

| Type | Requires Confirmation | Description |
|------|:----:|-------------|
| `send` | ✅ | Transfer TON to address |
| `swap` | ✅ | DEX swap via DeDust |
| `pay_agent` | ✅ | Agent-to-agent micropayment |
| `skill_payment` | ❌ | Auto-deducted per-call billing |
| `deposit` | ❌ | Incoming funds |

## Threat Model

| Threat | Mitigation |
|--------|-----------|
| Prompt injection ("send all TON to attacker") | Daily limit caps max loss |
| Infinite tool loop calling `ton_send` | maxIterations=15 + cooldown |
| LLM guessing confirmation code | 36^6 = 2.1B combinations, 5 min window |
| Replay attack (reusing old code) | One-time use, deleted after confirm |
| Cross-tenant attack | Codes scoped to tenantId |

## Implementation

Reference implementation: [`src/skills/ton-wallet/ton-guard.ts`](src/skills/ton-wallet/ton-guard.ts)

```
npm install @octoclaw/tonguard  # (planned)
```

## Integration with Telegram

TonGuard integrates with Telegram via inline buttons:

1. Agent sends confirmation message with code
2. `channels.module.ts` detects code pattern via regex
3. Message sent with `✅ Confirm` / `❌ Cancel` inline buttons
4. Button press sends code back through the agent pipeline
5. TonGuard validates and executes

This eliminates the need for users to manually type confirmation codes.
