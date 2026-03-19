# @octoclaw/tonguard

> Security layer for AI agent TON transactions. Confirmation codes, spending limits, cooldowns — works with any framework.

## Install

```bash
npm install @octoclaw/tonguard
```

## Quick Start

```typescript
import { TonGuard } from '@octoclaw/tonguard';

const guard = new TonGuard({
  dailyLimitTon: 10,       // max 10 TON per day per user
  autoConfirmBelow: 0.1,   // auto-approve below 0.1 TON
  cooldownMs: 30_000,      // 30s between transactions
});

// Agent wants to send TON → ask the guard
const result = guard.gate('user-123', 5.0, 'EQxyz...', 'Payment');

if (result.status === 'pending') {
  console.log(`Confirm code: ${result.code}`);  // e.g. "A7K2X9"
  // Show to user, wait for confirmation
}

if (result.status === 'approved') {
  // Small amount, auto-confirmed — proceed with transaction
}

if (result.status === 'rejected') {
  console.log(result.reason);  // "Daily limit exceeded"
}

// User confirms
const confirm = guard.confirm('user-123', 'A7K2X9');
if (confirm.status === 'approved') {
  // Execute the TON transaction
}
```

## LangChain / LangGraph

```typescript
import { TonGuard, createLangChainTools } from '@octoclaw/tonguard';

const guard = new TonGuard({ dailyLimitTon: 10 });
const tools = createLangChainTools(guard, 'user-123');

// Use with LangGraph
import { createReactAgent } from '@langchain/langgraph/prebuilt';
const agent = createReactAgent({ llm, tools });
```

## Framework-Agnostic Tools

```typescript
import { TonGuard, createTonGuardTools } from '@octoclaw/tonguard';

const guard = new TonGuard();
const tools = createTonGuardTools(guard, 'user-123');

// Each tool has: { name, description, parameters, execute }
// Works with CrewAI, AutoGen, or any custom agent
for (const tool of tools) {
  console.log(tool.name, tool.description);
}
```

## API

### `new TonGuard(config?)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `dailyLimitTon` | number | 10 | Max TON per 24h per user |
| `perTxLimitTon` | number | 5 | Max per transaction |
| `autoConfirmBelow` | number | 0.1 | Auto-approve threshold |
| `cooldownMs` | number | 30000 | Min ms between transactions |
| `codeExpiryMs` | number | 300000 | Code TTL (5 min) |
| `store` | TonGuardStore | MemoryStore | Custom storage backend |

### `guard.gate(userId, amount, toAddress?, comment?)`

Returns `{ status, code?, expiresAt?, reason?, amount }`:
- `approved` — auto-confirmed (below threshold)
- `pending` — code generated, needs user confirmation
- `rejected` — policy violation (limit/cooldown)

### `guard.confirm(userId, code)`

Returns `{ status, amount?, userId? }`:
- `approved` — transaction confirmed
- `expired` — code expired
- `invalid` — code not found

### `guard.reject(userId, code)`

Cancel a pending transaction. Returns `true` if found.

### `guard.getStats(userId)`

Returns spending stats: `{ spentToday, remainingToday, txCountToday, canTransact, cooldownEndsAt }`.

## Security Properties

- Codes: 6-char from `crypto.randomBytes`, no ambiguous chars (0/O/1/I)
- TTL: 5 minutes, enforced server-side
- One-time use: deleted after confirm or expiry
- Per-user isolation: codes scoped to userId
- LLM cannot bypass: codes generated outside LLM context

## Custom Store

Implement `TonGuardStore` interface for Redis, database, etc:

```typescript
import { TonGuard, TonGuardStore } from '@octoclaw/tonguard';

class RedisStore implements TonGuardStore {
  // implement: getPending, setPending, deletePending, etc.
}

const guard = new TonGuard({ store: new RedisStore() });
```

## License

MIT — [OctoClaw](https://github.com/nicenemo/octoclaw-engine)
