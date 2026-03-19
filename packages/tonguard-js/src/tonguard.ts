import { randomBytes } from 'crypto';

// ─── Types ──────────────────────────────────────────────

export interface TonGuardConfig {
  /** Max TON per 24h per user (default: 10) */
  dailyLimitTon?: number;
  /** Max TON per single transaction (default: 5) */
  perTxLimitTon?: number;
  /** Auto-approve transactions below this amount (default: 0.1) */
  autoConfirmBelow?: number;
  /** Minimum ms between transactions (default: 30000) */
  cooldownMs?: number;
  /** Confirmation code TTL in ms (default: 300000 = 5 min) */
  codeExpiryMs?: number;
  /** Code length in characters (default: 6) */
  codeLength?: number;
  /** Custom store (default: in-memory) */
  store?: TonGuardStore;
}

export type GateStatus = 'approved' | 'pending' | 'rejected';

export interface GateResult {
  status: GateStatus;
  code?: string;
  expiresAt?: Date;
  reason?: string;
  amount: number;
}

export interface ConfirmResult {
  status: 'approved' | 'expired' | 'invalid';
  amount?: number;
  userId?: string;
}

export interface PendingTx {
  userId: string;
  code: string;
  amount: number;
  toAddress?: string;
  comment?: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface UserStats {
  spentToday: number;
  remainingToday: number;
  txCountToday: number;
  lastTxAt: Date | null;
  canTransact: boolean;
  cooldownEndsAt: Date | null;
}

// ─── Store Interface ────────────────────────────────────

export interface TonGuardStore {
  getPending(userId: string, code: string): PendingTx | undefined;
  setPending(userId: string, code: string, tx: PendingTx): void;
  deletePending(userId: string, code: string): void;
  getDailySpent(userId: string): number;
  addDailySpent(userId: string, amount: number): void;
  getLastTxTime(userId: string): number | null;
  setLastTxTime(userId: string, time: number): void;
  getDailyTxCount(userId: string): number;
  cleanup(): void;
}

// ─── In-Memory Store ────────────────────────────────────

export class MemoryStore implements TonGuardStore {
  private pending = new Map<string, PendingTx>();
  private dailySpent = new Map<string, { amount: number; date: string }>();
  private lastTx = new Map<string, number>();
  private dailyCount = new Map<string, { count: number; date: string }>();

  private key(userId: string, code: string): string {
    return `${userId}::${code}`;
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  getPending(userId: string, code: string): PendingTx | undefined {
    const tx = this.pending.get(this.key(userId, code));
    if (tx && tx.expiresAt < new Date()) {
      this.pending.delete(this.key(userId, code));
      return undefined;
    }
    return tx;
  }

  setPending(userId: string, code: string, tx: PendingTx): void {
    this.pending.set(this.key(userId, code), tx);
  }

  deletePending(userId: string, code: string): void {
    this.pending.delete(this.key(userId, code));
  }

  getDailySpent(userId: string): number {
    const entry = this.dailySpent.get(userId);
    if (!entry || entry.date !== this.today()) return 0;
    return entry.amount;
  }

  addDailySpent(userId: string, amount: number): void {
    const current = this.getDailySpent(userId);
    this.dailySpent.set(userId, { amount: current + amount, date: this.today() });
    const countEntry = this.dailyCount.get(userId);
    const count = (countEntry?.date === this.today() ? countEntry.count : 0) + 1;
    this.dailyCount.set(userId, { count, date: this.today() });
  }

  getLastTxTime(userId: string): number | null {
    return this.lastTx.get(userId) ?? null;
  }

  setLastTxTime(userId: string, time: number): void {
    this.lastTx.set(userId, time);
  }

  getDailyTxCount(userId: string): number {
    const entry = this.dailyCount.get(userId);
    if (!entry || entry.date !== this.today()) return 0;
    return entry.count;
  }

  cleanup(): void {
    const now = new Date();
    for (const [key, tx] of this.pending) {
      if (tx.expiresAt < now) this.pending.delete(key);
    }
  }
}

// ─── TonGuard ───────────────────────────────────────────

export class TonGuard {
  private readonly config: Required<Omit<TonGuardConfig, 'store'>>;
  private readonly store: TonGuardStore;

  constructor(config: TonGuardConfig = {}) {
    this.config = {
      dailyLimitTon: config.dailyLimitTon ?? 10,
      perTxLimitTon: config.perTxLimitTon ?? 5,
      autoConfirmBelow: config.autoConfirmBelow ?? 0.1,
      cooldownMs: config.cooldownMs ?? 30_000,
      codeExpiryMs: config.codeExpiryMs ?? 300_000,
      codeLength: config.codeLength ?? 6,
    };
    this.store = config.store ?? new MemoryStore();
  }

  /**
   * Gate a transaction. Returns 'approved' (auto-confirm),
   * 'pending' (needs user confirmation), or 'rejected' (policy violation).
   */
  gate(userId: string, amount: number, toAddress?: string, comment?: string): GateResult {
    // 1. Check per-tx limit
    if (amount > this.config.perTxLimitTon) {
      return {
        status: 'rejected',
        reason: `Amount ${amount} TON exceeds per-transaction limit of ${this.config.perTxLimitTon} TON`,
        amount,
      };
    }

    // 2. Check daily limit
    const spent = this.store.getDailySpent(userId);
    if (spent + amount > this.config.dailyLimitTon) {
      return {
        status: 'rejected',
        reason: `Daily limit exceeded: spent ${spent} + ${amount} > ${this.config.dailyLimitTon} TON`,
        amount,
      };
    }

    // 3. Check cooldown
    const lastTx = this.store.getLastTxTime(userId);
    if (lastTx) {
      const elapsed = Date.now() - lastTx;
      if (elapsed < this.config.cooldownMs) {
        const waitSec = Math.ceil((this.config.cooldownMs - elapsed) / 1000);
        return {
          status: 'rejected',
          reason: `Cooldown active: wait ${waitSec}s before next transaction`,
          amount,
        };
      }
    }

    // 4. Auto-confirm small amounts
    if (amount <= this.config.autoConfirmBelow) {
      this.store.addDailySpent(userId, amount);
      this.store.setLastTxTime(userId, Date.now());
      return { status: 'approved', amount };
    }

    // 5. Generate confirmation code
    const code = this.generateCode();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.codeExpiryMs);

    this.store.setPending(userId, code, {
      userId,
      code,
      amount,
      toAddress,
      comment,
      createdAt: now,
      expiresAt,
    });

    return { status: 'pending', code, expiresAt, amount };
  }

  /**
   * Confirm a pending transaction with the confirmation code.
   */
  confirm(userId: string, code: string): ConfirmResult {
    const tx = this.store.getPending(userId, code.toUpperCase());
    if (!tx) {
      return { status: 'invalid' };
    }

    if (tx.expiresAt < new Date()) {
      this.store.deletePending(userId, code.toUpperCase());
      return { status: 'expired' };
    }

    // Approve
    this.store.deletePending(userId, code.toUpperCase());
    this.store.addDailySpent(userId, tx.amount);
    this.store.setLastTxTime(userId, Date.now());

    return { status: 'approved', amount: tx.amount, userId: tx.userId };
  }

  /**
   * Reject/cancel a pending transaction.
   */
  reject(userId: string, code: string): boolean {
    const tx = this.store.getPending(userId, code.toUpperCase());
    if (!tx) return false;
    this.store.deletePending(userId, code.toUpperCase());
    return true;
  }

  /**
   * Get spending stats for a user.
   */
  getStats(userId: string): UserStats {
    const spent = this.store.getDailySpent(userId);
    const lastTx = this.store.getLastTxTime(userId);
    const cooldownEnds = lastTx ? new Date(lastTx + this.config.cooldownMs) : null;
    const now = Date.now();

    return {
      spentToday: spent,
      remainingToday: Math.max(0, this.config.dailyLimitTon - spent),
      txCountToday: this.store.getDailyTxCount(userId),
      lastTxAt: lastTx ? new Date(lastTx) : null,
      canTransact: (!cooldownEnds || cooldownEnds.getTime() <= now) && spent < this.config.dailyLimitTon,
      cooldownEndsAt: cooldownEnds && cooldownEnds.getTime() > now ? cooldownEnds : null,
    };
  }

  /**
   * Clean up expired pending transactions.
   */
  cleanup(): void {
    this.store.cleanup();
  }

  private generateCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
    const bytes = randomBytes(this.config.codeLength);
    let code = '';
    for (let i = 0; i < this.config.codeLength; i++) {
      code += chars[bytes[i] % chars.length];
    }
    return code;
  }
}
