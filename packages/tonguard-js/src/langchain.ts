/**
 * LangChain / LangGraph integration for TonGuard.
 *
 * Usage with LangGraph:
 *   import { TonGuard } from '@octoclaw/tonguard';
 *   import { createTonGuardTools } from '@octoclaw/tonguard/langchain';
 *
 *   const guard = new TonGuard({ dailyLimitTon: 10 });
 *   const tools = createTonGuardTools(guard, userId);
 *   // Add tools to your LangGraph agent
 */

import { TonGuard, GateResult, ConfirmResult, UserStats } from './tonguard';

// ─── Tool Definitions (framework-agnostic) ──────────────

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

/**
 * Create tool definitions that any agent framework can use.
 * Compatible with LangChain, LangGraph, CrewAI, AutoGen, etc.
 */
export function createTonGuardTools(guard: TonGuard, userId: string): ToolDefinition[] {
  return [
    {
      name: 'ton_guard_check',
      description: 'Check if a TON transaction is allowed by TonGuard security policy. Call this BEFORE sending any TON. Returns approved/pending/rejected.',
      parameters: {
        type: 'object',
        properties: {
          amount: { type: 'number', description: 'Amount in TON to send' },
          toAddress: { type: 'string', description: 'Destination TON address' },
          comment: { type: 'string', description: 'Transaction comment (optional)' },
        },
        required: ['amount'],
      },
      execute: async (args) => {
        const result = guard.gate(
          userId,
          args.amount as number,
          args.toAddress as string | undefined,
          args.comment as string | undefined,
        );
        return formatGateResult(result);
      },
    },
    {
      name: 'ton_guard_confirm',
      description: 'Confirm a pending TON transaction with the user-provided confirmation code.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'The 6-character confirmation code' },
        },
        required: ['code'],
      },
      execute: async (args) => {
        const result = guard.confirm(userId, args.code as string);
        return formatConfirmResult(result);
      },
    },
    {
      name: 'ton_guard_stats',
      description: 'Get the current spending stats and limits for this user.',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        const stats = guard.getStats(userId);
        return formatStats(stats);
      },
    },
  ];
}

// ─── LangChain DynamicTool adapter ──────────────────────

/**
 * Create LangChain-compatible DynamicTools.
 * Requires @langchain/core as peer dependency.
 *
 * Usage:
 *   import { createLangChainTools } from '@octoclaw/tonguard/langchain';
 *   const tools = createLangChainTools(guard, userId);
 *   const agent = createReactAgent({ llm, tools });
 */
export function createLangChainTools(guard: TonGuard, userId: string): unknown[] {
  try {
    // Dynamic import to avoid hard dependency
    const { DynamicTool } = require('@langchain/core/tools');

    return [
      new DynamicTool({
        name: 'ton_guard_check',
        description: 'Check if a TON transaction is allowed. Input: JSON with "amount" (number), optional "toAddress" and "comment".',
        func: async (input: string) => {
          const args = JSON.parse(input);
          const result = guard.gate(userId, args.amount, args.toAddress, args.comment);
          return formatGateResult(result);
        },
      }),
      new DynamicTool({
        name: 'ton_guard_confirm',
        description: 'Confirm a pending transaction. Input: the 6-character confirmation code.',
        func: async (code: string) => {
          const result = guard.confirm(userId, code.trim());
          return formatConfirmResult(result);
        },
      }),
      new DynamicTool({
        name: 'ton_guard_stats',
        description: 'Get current spending stats and limits.',
        func: async () => {
          return formatStats(guard.getStats(userId));
        },
      }),
    ];
  } catch {
    throw new Error(
      '@langchain/core is required for LangChain integration. Install it: npm install @langchain/core',
    );
  }
}

// ─── Formatters ─────────────────────────────────────────

function formatGateResult(r: GateResult): string {
  if (r.status === 'approved') {
    return `✅ APPROVED: ${r.amount} TON auto-confirmed (below threshold).`;
  }
  if (r.status === 'pending') {
    return `⏳ PENDING: Send confirmation code "${r.code}" to approve ${r.amount} TON. Expires: ${r.expiresAt?.toISOString()}. Ask the user to confirm.`;
  }
  return `❌ REJECTED: ${r.reason}`;
}

function formatConfirmResult(r: ConfirmResult): string {
  if (r.status === 'approved') return `✅ CONFIRMED: ${r.amount} TON transaction approved. Proceed with sending.`;
  if (r.status === 'expired') return `⏰ EXPIRED: Confirmation code has expired. Request a new one.`;
  return `❌ INVALID: Code not found or already used.`;
}

function formatStats(s: UserStats): string {
  return [
    `📊 Spending Stats:`,
    `  Spent today: ${s.spentToday} TON`,
    `  Remaining: ${s.remainingToday} TON`,
    `  Transactions today: ${s.txCountToday}`,
    `  Can transact now: ${s.canTransact ? 'yes' : 'no'}`,
    s.cooldownEndsAt ? `  Cooldown ends: ${s.cooldownEndsAt.toISOString()}` : '',
  ].filter(Boolean).join('\n');
}
