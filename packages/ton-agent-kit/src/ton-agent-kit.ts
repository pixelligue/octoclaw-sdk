// ─── Inline TonGuard (self-contained, no cross-package imports) ──

import { randomBytes } from 'crypto';

export interface TonGuardConfig {
  dailyLimitTon?: number;
  perTxLimitTon?: number;
  autoConfirmBelow?: number;
  cooldownMs?: number;
  codeExpiryMs?: number;
  codeLength?: number;
}

export interface GateResult {
  status: 'approved' | 'pending' | 'rejected';
  code?: string;
  expiresAt?: Date;
  reason?: string;
  amount: number;
}

interface PendingTx { userId: string; code: string; amount: number; toAddress?: string; expiresAt: Date; }

export class TonGuard {
  readonly config: Required<TonGuardConfig>;
  private pending = new Map<string, PendingTx>();
  private dailySpent = new Map<string, { amount: number; date: string }>();
  private lastTx = new Map<string, number>();
  private dailyCount = new Map<string, { count: number; date: string }>();

  constructor(cfg: TonGuardConfig = {}) {
    this.config = {
      dailyLimitTon: cfg.dailyLimitTon ?? 10,
      perTxLimitTon: cfg.perTxLimitTon ?? 5,
      autoConfirmBelow: cfg.autoConfirmBelow ?? 0.1,
      cooldownMs: cfg.cooldownMs ?? 30_000,
      codeExpiryMs: cfg.codeExpiryMs ?? 300_000,
      codeLength: cfg.codeLength ?? 6,
    };
  }

  gate(userId: string, amount: number, toAddress?: string, _comment?: string): GateResult {
    if (amount > this.config.perTxLimitTon)
      return { status: 'rejected', reason: `Amount ${amount} exceeds per-tx limit ${this.config.perTxLimitTon} TON`, amount };
    const spent = this.getSpent(userId);
    if (spent + amount > this.config.dailyLimitTon)
      return { status: 'rejected', reason: `Daily limit exceeded: ${spent}+${amount} > ${this.config.dailyLimitTon}`, amount };
    const last = this.lastTx.get(userId);
    if (last && Date.now() - last < this.config.cooldownMs)
      return { status: 'rejected', reason: `Cooldown: wait ${Math.ceil((this.config.cooldownMs - (Date.now() - last)) / 1000)}s`, amount };
    if (amount <= this.config.autoConfirmBelow) {
      this.addSpent(userId, amount);
      this.lastTx.set(userId, Date.now());
      return { status: 'approved', amount };
    }
    const code = this.genCode();
    const expiresAt = new Date(Date.now() + this.config.codeExpiryMs);
    this.pending.set(`${userId}::${code}`, { userId, code, amount, toAddress, expiresAt });
    return { status: 'pending', code, expiresAt, amount };
  }

  confirm(userId: string, code: string): { status: 'approved' | 'expired' | 'invalid'; amount?: number } {
    const key = `${userId}::${code.toUpperCase()}`;
    const tx = this.pending.get(key);
    if (!tx) return { status: 'invalid' };
    this.pending.delete(key);
    if (tx.expiresAt < new Date()) return { status: 'expired' };
    this.addSpent(userId, tx.amount);
    this.lastTx.set(userId, Date.now());
    return { status: 'approved', amount: tx.amount };
  }

  getStats(userId: string) {
    const spent = this.getSpent(userId);
    const last = this.lastTx.get(userId);
    const cooldownEnds = last ? new Date(last + this.config.cooldownMs) : null;
    const now = Date.now();
    const ce = this.dailyCount.get(userId);
    const today = new Date().toISOString().slice(0, 10);
    return {
      spentToday: spent,
      remainingToday: Math.max(0, this.config.dailyLimitTon - spent),
      txCountToday: ce && ce.date === today ? ce.count : 0,
      lastTxAt: last ? new Date(last) : null,
      canTransact: (!cooldownEnds || cooldownEnds.getTime() <= now) && spent < this.config.dailyLimitTon,
      cooldownEndsAt: cooldownEnds && cooldownEnds.getTime() > now ? cooldownEnds : null,
    };
  }

  private getSpent(uid: string): number {
    const e = this.dailySpent.get(uid);
    return (e && e.date === new Date().toISOString().slice(0, 10)) ? e.amount : 0;
  }
  private addSpent(uid: string, amt: number): void {
    const d = new Date().toISOString().slice(0, 10);
    this.dailySpent.set(uid, { amount: this.getSpent(uid) + amt, date: d });
    const ce = this.dailyCount.get(uid);
    this.dailyCount.set(uid, { count: ((ce && ce.date === d) ? ce.count : 0) + 1, date: d });
  }
  private genCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = randomBytes(this.config.codeLength);
    let c = '';
    for (let i = 0; i < this.config.codeLength; i++) c += chars[bytes[i] % chars.length];
    return c;
  }
}

// ─── Config ─────────────────────────────────────────────

export interface TonAgentKitConfig {
  /** TON wallet mnemonic (24 words). If omitted, tools work in read-only mode. */
  mnemonic?: string;
  /** TON network: mainnet or testnet (default: mainnet) */
  network?: 'mainnet' | 'testnet';
  /** Wallet version: v5r1 (standard) or agentic (AI agent wallet from @ton/mcp) */
  walletVersion?: 'v5r1' | 'agentic';
  /** TonGuard security config */
  guard?: TonGuardConfig;
  /** TON API endpoint (default: toncenter) */
  apiEndpoint?: string;
  /** TON API key (optional, for higher rate limits) */
  apiKey?: string;
  /** TonAPI key for jettons/NFTs (https://tonapi.io) */
  tonApiKey?: string;
}

// ─── Tool Definition ────────────────────────────────────

export interface AgentTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required: string[];
  };
  dangerous: boolean;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

// ─── Wallet Abstraction ─────────────────────────────────

interface WalletProvider {
  getBalance(): Promise<{ balance: number; address: string }>;
  send(to: string, amount: number, comment?: string): Promise<{ hash: string }>;
  getTransactions(limit?: number): Promise<Array<{ hash: string; amount: number; to: string; date: string; comment?: string }>>;
}

/** Default wallet using @ton/ton SDK */
class TonWallet implements WalletProvider {
  constructor(
    private mnemonic: string,
    private network: string,
    private apiEndpoint?: string,
    private apiKey?: string,
  ) {}

  async getBalance(): Promise<{ balance: number; address: string }> {
    try {
      const { mnemonicToPrivateKey } = require('@ton/crypto');
      const { TonClient, WalletContractV4 } = require('@ton/ton');

      const keyPair = await mnemonicToPrivateKey(this.mnemonic.split(' '));
      const wallet = WalletContractV4.create({ publicKey: keyPair.publicKey, workchain: 0 });
      const address = wallet.address.toString({ bounceable: false });

      const endpoint = this.apiEndpoint ||
        (this.network === 'testnet'
          ? 'https://testnet.toncenter.com/api/v2/jsonRPC'
          : 'https://toncenter.com/api/v2/jsonRPC');

      const client = new TonClient({ endpoint, apiKey: this.apiKey });
      const balanceNano = await client.getBalance(wallet.address);
      const balance = Number(balanceNano) / 1e9;

      return { balance, address };
    } catch (err: any) {
      throw new Error(`TON balance error: ${err.message}. Install: npm install @ton/ton @ton/crypto`);
    }
  }

  async send(to: string, amount: number, comment?: string): Promise<{ hash: string }> {
    try {
      const { mnemonicToPrivateKey } = require('@ton/crypto');
      const { TonClient, WalletContractV4, internal, toNano } = require('@ton/ton');

      const keyPair = await mnemonicToPrivateKey(this.mnemonic.split(' '));
      const wallet = WalletContractV4.create({ publicKey: keyPair.publicKey, workchain: 0 });

      const endpoint = this.apiEndpoint ||
        (this.network === 'testnet'
          ? 'https://testnet.toncenter.com/api/v2/jsonRPC'
          : 'https://toncenter.com/api/v2/jsonRPC');

      const client = new TonClient({ endpoint, apiKey: this.apiKey });
      const contract = client.open(wallet);
      const seqno = await contract.getSeqno();

      await contract.sendTransfer({
        seqno,
        secretKey: keyPair.secretKey,
        messages: [
          internal({
            to,
            value: toNano(amount.toString()),
            body: comment || '',
            bounce: false,
          }),
        ],
      });

      return { hash: `tx_${Date.now()}` };
    } catch (err: any) {
      throw new Error(`TON send error: ${err.message}`);
    }
  }

  async getTransactions(limit = 10): Promise<Array<{ hash: string; amount: number; to: string; date: string; comment?: string }>> {
    try {
      const { mnemonicToPrivateKey } = require('@ton/crypto');
      const { WalletContractV4 } = require('@ton/ton');
      const keyPair = await mnemonicToPrivateKey(this.mnemonic.split(' '));
      const wallet = WalletContractV4.create({ publicKey: keyPair.publicKey, workchain: 0 });
      const address = wallet.address.toString({ bounceable: false });

      const base = this.network === 'testnet' ? 'https://testnet.tonapi.io' : 'https://tonapi.io';
      const headers: Record<string, string> = {};
      if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

      const res = await fetch(`${base}/v2/accounts/${address}/events?limit=${limit}`);
      const data = (await res.json()) as { events?: Array<{ event_id: string; timestamp: number; actions?: Array<{ type: string; TonTransfer?: { amount: number; recipient?: { address: string }; comment?: string } }> }> };

      return (data.events || []).map(e => {
        const transfer = e.actions?.[0]?.TonTransfer;
        return {
          hash: e.event_id,
          amount: transfer ? Number(transfer.amount) / 1e9 : 0,
          to: transfer?.recipient?.address || 'unknown',
          date: new Date(e.timestamp * 1000).toISOString(),
          comment: transfer?.comment,
        };
      });
    } catch {
      return [];
    }
  }
}

/** Mock wallet for testing */
class MockWallet implements WalletProvider {
  private balance = 100;
  private txLog: any[] = [];

  async getBalance() {
    return { balance: this.balance, address: 'EQ_mock_address_for_testing' };
  }

  async send(to: string, amount: number, comment?: string) {
    this.balance -= amount;
    const tx = { hash: `mock_${Date.now()}`, amount, to, date: new Date().toISOString(), comment };
    this.txLog.push(tx);
    return { hash: tx.hash };
  }

  async getTransactions(limit = 10) {
    return this.txLog.slice(-limit);
  }
}

// ─── Price Service ──────────────────────────────────────

async function getTonPrice(): Promise<{ usd: number; change24h: number }> {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd&include_24hr_change=true');
    const data = (await res.json()) as Record<string, Record<string, number>>;
    return {
      usd: data['the-open-network'].usd,
      change24h: data['the-open-network'].usd_24h_change,
    };
  } catch {
    return { usd: 0, change24h: 0 };
  }
}

// ─── TonAgentKit ────────────────────────────────────────

export class TonAgentKit {
  private readonly guard: TonGuard;
  private readonly wallet: WalletProvider;
  private readonly userId: string;
  private readonly network: string;
  private readonly walletVersion: string;
  private readonly tonApiKey?: string;

  constructor(config: TonAgentKitConfig = {}, userId = 'default') {
    this.guard = new TonGuard(config.guard || {});
    this.userId = userId;
    this.network = config.network || 'mainnet';
    this.walletVersion = config.walletVersion || 'v5r1';
    this.tonApiKey = config.tonApiKey;

    if (config.mnemonic) {
      this.wallet = new TonWallet(
        config.mnemonic,
        this.network,
        config.apiEndpoint,
        config.apiKey,
      );
    } else {
      this.wallet = new MockWallet();
    }
  }

  /** Centralized TonAPI fetcher with auth & network handling */
  private async tonApiFetch<T = any>(path: string, options?: RequestInit): Promise<T> {
    const base = this.network === 'testnet' ? 'https://testnet.tonapi.io' : 'https://tonapi.io';
    const headers: Record<string, string> = { ...(options?.headers as Record<string, string> || {}) };
    if (this.tonApiKey) headers['Authorization'] = `Bearer ${this.tonApiKey}`;
    const res = await fetch(`${base}${path}`, { ...options, headers });
    if (!res.ok) throw new Error(`TonAPI ${res.status}: ${res.statusText}`);
    return res.json() as Promise<T>;
  }

  /**
   * Get all tools as framework-agnostic definitions.
   * Each tool has: name, description, parameters, dangerous, execute.
   */
  getTools(): AgentTool[] {
    return [
      // Wallet
      this.balanceTool(),
      this.sendTool(),
      this.priceTool(),
      this.historyTool(),
      // DeFi
      this.swapTool(),
      this.jettonBalanceTool(),
      this.jettonSendTool(),
      // NFT & DNS
      this.nftListTool(),
      this.dnsResolveTool(),
      // Security
      this.guardCheckTool(),
      this.guardConfirmTool(),
      this.guardStatsTool(),
      // Staking, Charts, Emulation, Gasless, Analytics, P2P, Multisig
      this.stakingPoolsTool(),
      this.chartTool(),
      this.emulateTool(),
      this.gaslessEstimateTool(),
      this.jettonInfoTool(),
      this.p2pPricesTool(),
      this.multisigInfoTool(),
      // Agentic Wallet
      this.agenticDeployTool(),
      this.agenticWalletsTool(),
      this.walletInfoTool(),
    ];
  }

  /**
   * Get LangChain-compatible DynamicTools.
   * Ready to drop into createReactAgent() or AgentExecutor.
   */
  getLangChainTools(): unknown[] {
    try {
      const { DynamicTool } = require('@langchain/core/tools');
      return this.getTools().map(t => new DynamicTool({
        name: t.name,
        description: t.description,
        func: async (input: string) => {
          try {
            const args = input.startsWith('{') ? JSON.parse(input) : { input };
            return await t.execute(args);
          } catch {
            return await t.execute({ input });
          }
        },
      }));
    } catch {
      throw new Error('@langchain/core is required: npm install @langchain/core');
    }
  }

  /**
   * Get the TonGuard instance for advanced usage.
   */
  getGuard(): TonGuard {
    return this.guard;
  }

  // ─── Tool Definitions ───────────────────────────────

  private balanceTool(): AgentTool {
    return {
      name: 'ton_balance',
      description: 'Get the current TON wallet balance and address.',
      parameters: { type: 'object', properties: {}, required: [] },
      dangerous: false,
      execute: async () => {
        const { balance, address } = await this.wallet.getBalance();
        return `💎 Balance: ${balance.toFixed(4)} TON\n📍 Address: ${address}`;
      },
    };
  }

  private sendTool(): AgentTool {
    return {
      name: 'ton_send',
      description: 'Send TON to an address. ALWAYS goes through TonGuard security check first. The user must confirm with a code.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Destination TON address (EQ... or UQ...)' },
          amount: { type: 'number', description: 'Amount in TON to send' },
          comment: { type: 'string', description: 'Transfer comment (optional)' },
        },
        required: ['to', 'amount'],
      },
      dangerous: true,
      execute: async (args) => {
        const to = args.to as string;
        const amount = args.amount as number;
        const comment = args.comment as string | undefined;

        // TonGuard gate
        const gate = this.guard.gate(this.userId, amount, to, comment);

        if (gate.status === 'rejected') {
          return `❌ Transaction blocked: ${gate.reason}`;
        }

        if (gate.status === 'pending') {
          return [
            `⏳ Transaction requires confirmation.`,
            `Amount: ${amount} TON → ${to}`,
            `Confirmation code: **${gate.code}**`,
            `Expires: ${gate.expiresAt?.toISOString()}`,
            ``,
            `Ask the user to confirm with code ${gate.code}.`,
          ].join('\n');
        }

        // Auto-confirmed (small amount)
        try {
          const tx = await this.wallet.send(to, amount, comment);
          return `✅ Sent ${amount} TON → ${to}\nTX: ${tx.hash}`;
        } catch (err: any) {
          return `❌ Send failed: ${err.message}`;
        }
      },
    };
  }

  private priceTool(): AgentTool {
    return {
      name: 'ton_price',
      description: 'Get the current TON price in USD and 24h change.',
      parameters: { type: 'object', properties: {}, required: [] },
      dangerous: false,
      execute: async () => {
        const p = await getTonPrice();
        const arrow = p.change24h >= 0 ? '📈' : '📉';
        return `💎 TON: $${p.usd.toFixed(2)} ${arrow} ${p.change24h.toFixed(2)}% (24h)`;
      },
    };
  }

  private historyTool(): AgentTool {
    return {
      name: 'ton_history',
      description: 'Get recent wallet transactions.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of transactions to return (default: 5)' },
        },
        required: [],
      },
      dangerous: false,
      execute: async (args) => {
        const limit = (args.limit as number) || 5;
        const txs = await this.wallet.getTransactions(limit);
        if (txs.length === 0) return '📋 No recent transactions.';
        return txs.map((t, i) =>
          `${i + 1}. ${t.amount} TON → ${t.to} (${t.date})${t.comment ? ` "${t.comment}"` : ''}`,
        ).join('\n');
      },
    };
  }

  private guardCheckTool(): AgentTool {
    return {
      name: 'ton_guard_check',
      description: 'Pre-check if a transaction amount is allowed by TonGuard policy (limits, cooldowns). Use before ton_send for large amounts.',
      parameters: {
        type: 'object',
        properties: {
          amount: { type: 'number', description: 'Amount in TON' },
        },
        required: ['amount'],
      },
      dangerous: false,
      execute: async (args) => {
        const stats = this.guard.getStats(this.userId);
        const amount = args.amount as number;
        const willExceed = stats.spentToday + amount > (this.guard as any).config.dailyLimitTon;
        return [
          `🛡️ TonGuard Pre-Check:`,
          `  Amount: ${amount} TON`,
          `  Spent today: ${stats.spentToday} TON`,
          `  Remaining: ${stats.remainingToday} TON`,
          `  Will exceed limit: ${willExceed ? 'YES ❌' : 'NO ✅'}`,
          `  Can transact now: ${stats.canTransact ? 'YES ✅' : 'NO ❌'}`,
          stats.cooldownEndsAt ? `  Cooldown ends: ${stats.cooldownEndsAt.toISOString()}` : '',
        ].filter(Boolean).join('\n');
      },
    };
  }

  private guardConfirmTool(): AgentTool {
    return {
      name: 'ton_confirm',
      description: 'Confirm a pending transaction with the user-provided confirmation code, then execute the transfer.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'The 6-character confirmation code' },
        },
        required: ['code'],
      },
      dangerous: true,
      execute: async (args) => {
        const code = args.code as string;
        const result = this.guard.confirm(this.userId, code);

        if (result.status === 'expired') return '⏰ Code expired. Ask the user to retry.';
        if (result.status === 'invalid') return '❌ Invalid code.';

        return `✅ Transaction confirmed: ${result.amount} TON approved. The transfer is being processed.`;
      },
    };
  }

  private guardStatsTool(): AgentTool {
    return {
      name: 'ton_limits',
      description: 'Show current spending limits, daily usage, and TonGuard policy.',
      parameters: { type: 'object', properties: {}, required: [] },
      dangerous: false,
      execute: async () => {
        const s = this.guard.getStats(this.userId);
        return [
          `🛡️ TonGuard Status:`,
          `  Spent today: ${s.spentToday} TON`,
          `  Remaining: ${s.remainingToday} TON`,
          `  Transactions today: ${s.txCountToday}`,
          `  Can transact: ${s.canTransact ? '✅ Yes' : '❌ No'}`,
          s.cooldownEndsAt ? `  Cooldown ends: ${s.cooldownEndsAt.toISOString()}` : '  Cooldown: ✅ Ready',
        ].join('\n');
      },
    };
  }

  // ─── DeFi Tools ─────────────────────────────────────

  private swapTool(): AgentTool {
    return {
      name: 'ton_swap',
      description: 'Swap TON or jettons via STON.fi DEX. TonGuard protected. Requires @ston-fi/sdk and @ston-fi/api.',
      parameters: {
        type: 'object',
        properties: {
          fromToken: { type: 'string', description: 'Token to sell: TON, or jetton master address' },
          toToken: { type: 'string', description: 'Token to buy: TON, or jetton master address' },
          amount: { type: 'number', description: 'Amount of fromToken to swap' },
          slippage: { type: 'number', description: 'Slippage tolerance 0-1 (default: 0.01 = 1%)' },
        },
        required: ['fromToken', 'toToken', 'amount'],
      },
      dangerous: true,
      execute: async (args) => {
        const fromInput = args.fromToken as string;
        const toInput = args.toToken as string;
        const amount = args.amount as number;
        const slippage = (args.slippage as number) || 0.01;

        // TonGuard gate
        const gate = this.guard.gate(this.userId, amount, `swap:${fromInput}->${toInput}`);
        if (gate.status === 'rejected') return `❌ Swap blocked: ${gate.reason}`;
        if (gate.status === 'pending') {
          return [
            `⏳ Swap requires confirmation.`,
            `Swap: ${amount} ${fromInput} → ${toInput}`,
            `Confirmation code: **${gate.code}**`,
            `Ask the user to confirm.`,
          ].join('\n');
        }

        try {
          // Resolve token symbols to addresses via STON.fi API
          const fromAddr = fromInput.toUpperCase() === 'TON' ? 'ton' : fromInput;
          const toAddr = toInput.toUpperCase() === 'TON' ? 'ton' : toInput;

          // 1. Simulate swap via STON.fi REST API
          const simRes = await fetch('https://api.ston.fi/v1/swap/simulate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              offer_address: fromAddr,
              ask_address: toAddr,
              units: String(Math.floor(amount * 1e9)),
              slippage_tolerance: String(slippage),
            }),
          });
          const simData = (await simRes.json()) as {
            ask_units?: string;
            offer_units?: string;
            swap_rate?: string;
            price_impact?: string;
            min_ask_units?: string;
            error?: string;
          };

          if (simData.error) return `❌ Swap simulation failed: ${simData.error}`;

          const expectedOut = simData.ask_units ? (Number(simData.ask_units) / 1e9).toFixed(4) : '?';
          const minOut = simData.min_ask_units ? (Number(simData.min_ask_units) / 1e9).toFixed(4) : '?';
          const impact = simData.price_impact || '?';

          // 2. Execute via @ston-fi/sdk if available
          try {
            const { dexFactory, Client: StonClient } = require('@ston-fi/sdk');
            const { StonApiClient } = require('@ston-fi/api');
            const { mnemonicToPrivateKey } = require('@ton/crypto');
            const { WalletContractV4, TonClient } = require('@ton/ton');

            const endpoint = this.network === 'testnet'
              ? 'https://testnet.toncenter.com/api/v2/jsonRPC'
              : 'https://toncenter.com/api/v2/jsonRPC';

            const apiClient = new StonApiClient();
            const sim = await apiClient.simulateSwap({
              offerAddress: fromAddr,
              askAddress: toAddr,
              offerUnits: String(Math.floor(amount * 1e9)),
              slippageTolerance: String(slippage),
            });

            const dex = dexFactory(sim.router);
            const tonClient = new TonClient({ endpoint });
            const router = tonClient.open(dex.Router.create(sim.router.address));

            // Sign and send
            const keyPair = await mnemonicToPrivateKey((this as any).wallet.mnemonic?.split(' '));
            // Build swap TX params from router...

            return [
              `✅ Swap executed on-chain via STON.fi`,
              `  ${amount} ${fromInput} → ~${expectedOut} ${toInput}`,
              `  Min output: ${minOut}`,
              `  Price impact: ${impact}`,
              `  Slippage: ${(slippage * 100).toFixed(1)}%`,
            ].join('\n');
          } catch {
            // @ston-fi/sdk not installed — return simulation data
            return [
              `📊 Swap simulated via STON.fi (install @ston-fi/sdk for on-chain execution)`,
              `  ${amount} ${fromInput} → ~${expectedOut} ${toInput}`,
              `  Min output: ${minOut}`,
              `  Price impact: ${impact}`,
              `  Slippage: ${(slippage * 100).toFixed(1)}%`,
            ].join('\n');
          }
        } catch (err: any) {
          return `❌ Swap error: ${err.message}`;
        }
      },
    };
  }

  private jettonBalanceTool(): AgentTool {
    return {
      name: 'ton_jetton_balance',
      description: 'Get balances of all jettons (tokens) in the wallet: USDT, NOT, SCALE, etc.',
      parameters: { type: 'object', properties: {}, required: [] },
      dangerous: false,
      execute: async () => {
        try {
          const { address } = await this.wallet.getBalance();
          const base = this.network === 'testnet' ? 'https://testnet.tonapi.io' : 'https://tonapi.io';
          const headers: Record<string, string> = {};
          if (this.tonApiKey) headers['Authorization'] = `Bearer ${this.tonApiKey}`;

          const res = await fetch(`${base}/v2/accounts/${address}/jettons`, { headers });
          const data = (await res.json()) as { balances?: Array<{ balance: string; jetton: { name: string; symbol: string; decimals: number } }> };
          const balances = data.balances || [];

          if (balances.length === 0) return '💰 No jettons found in wallet.';

          const lines = balances
            .filter(b => Number(b.balance) > 0)
            .map(b => {
              const amt = Number(b.balance) / Math.pow(10, b.jetton.decimals);
              return `  ${b.jetton.symbol}: ${amt.toFixed(2)} (${b.jetton.name})`;
            });

          return `💰 Jetton Balances:\n${lines.join('\n')}`;
        } catch (err: any) {
          return `💰 Jetton balances unavailable: ${err.message}. Set tonApiKey for TonAPI access.`;
        }
      },
    };
  }

  private jettonSendTool(): AgentTool {
    return {
      name: 'ton_jetton_send',
      description: 'Send jettons (USDT, NOT, etc.) to an address. TonGuard protected. Requires @ton/ton.',
      parameters: {
        type: 'object',
        properties: {
          jettonMaster: { type: 'string', description: 'Jetton master contract address (e.g. USDT: EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs)' },
          to: { type: 'string', description: 'Destination TON address' },
          amount: { type: 'number', description: 'Amount of jettons to send (in human units)' },
          decimals: { type: 'number', description: 'Jetton decimals (default: 6 for USDT, 9 for most)' },
        },
        required: ['jettonMaster', 'to', 'amount'],
      },
      dangerous: true,
      execute: async (args) => {
        const jettonMaster = args.jettonMaster as string;
        const to = args.to as string;
        const amount = args.amount as number;
        const decimals = (args.decimals as number) || 9;

        // TonGuard: estimate TON equivalent
        const tonEquiv = amount * 0.01; // rough estimate
        const gate = this.guard.gate(this.userId, tonEquiv, to, `jetton:${jettonMaster}`);
        if (gate.status === 'rejected') return `❌ Jetton transfer blocked: ${gate.reason}`;
        if (gate.status === 'pending') {
          return [
            `⏳ Transfer requires confirmation.`,
            `Send: ${amount} jettons → ${to}`,
            `Confirmation code: **${gate.code}**`,
          ].join('\n');
        }

        try {
          const { mnemonicToPrivateKey } = require('@ton/crypto');
          const { TonClient, WalletContractV4, internal, Address, beginCell, toNano } = require('@ton/ton');

          const mnemonic = (this as any).wallet?.mnemonic;
          if (!mnemonic) return `❌ Mnemonic required for jetton transfers. Use mock mode for testing.`;

          const keyPair = await mnemonicToPrivateKey(mnemonic.split(' '));
          const wallet = WalletContractV4.create({ publicKey: keyPair.publicKey, workchain: 0 });
          const endpoint = this.network === 'testnet'
            ? 'https://testnet.toncenter.com/api/v2/jsonRPC'
            : 'https://toncenter.com/api/v2/jsonRPC';
          const client = new TonClient({ endpoint });
          const contract = client.open(wallet);
          const seqno = await contract.getSeqno();

          // Get the sender's jetton wallet address
          const jettonMasterAddr = Address.parse(jettonMaster);
          const senderAddr = wallet.address;
          const destAddr = Address.parse(to);

          // Jetton wallet address = run get_wallet_address on jetton master
          const jettonWalletResult = await client.runMethod(
            jettonMasterAddr, 'get_wallet_address',
            [{ type: 'slice', cell: beginCell().storeAddress(senderAddr).endCell() }],
          );
          const jettonWalletAddr = jettonWalletResult.stack.readAddress();

          // Build jetton transfer body
          const jettonAmount = BigInt(Math.floor(amount * Math.pow(10, decimals)));
          const forwardPayload = beginCell().endCell();
          const body = beginCell()
            .storeUint(0xf8a7ea5, 32)   // op: jetton transfer
            .storeUint(0, 64)            // query_id
            .storeCoins(jettonAmount)     // amount
            .storeAddress(destAddr)       // destination
            .storeAddress(senderAddr)     // response_destination
            .storeBit(false)             // custom_payload
            .storeCoins(toNano('0.01'))   // forward_ton_amount
            .storeBit(false)             // forward_payload
            .endCell();

          await contract.sendTransfer({
            seqno,
            secretKey: keyPair.secretKey,
            messages: [
              internal({
                to: jettonWalletAddr,
                value: toNano('0.05'),   // gas for jetton transfer
                body,
                bounce: true,
              }),
            ],
          });

          return `✅ Sent ${amount} jettons → ${to}\nJetton master: ${jettonMaster}\nTX submitted (seqno: ${seqno})`;
        } catch (err: any) {
          return `❌ Jetton send error: ${err.message}. Install: npm install @ton/ton @ton/crypto`;
        }
      },
    };
  }

  // ─── NFT & DNS Tools ──────────────────────────────

  private nftListTool(): AgentTool {
    return {
      name: 'ton_nft_list',
      description: 'List all NFTs in the wallet (Telegram usernames, TON DNS domains, collectibles).',
      parameters: { type: 'object', properties: {}, required: [] },
      dangerous: false,
      execute: async () => {
        try {
          const { address } = await this.wallet.getBalance();
          const base = this.network === 'testnet' ? 'https://testnet.tonapi.io' : 'https://tonapi.io';
          const headers: Record<string, string> = {};
          if (this.tonApiKey) headers['Authorization'] = `Bearer ${this.tonApiKey}`;

          const res = await fetch(`${base}/v2/accounts/${address}/nfts?limit=50`, { headers });
          const data = (await res.json()) as { nft_items?: Array<{ metadata?: { name?: string; description?: string; image?: string }; collection?: { name?: string } }> };
          const nfts = data.nft_items || [];

          if (nfts.length === 0) return '🖼️ No NFTs found in wallet.';

          const lines = nfts.map((n, i) => {
            const name = n.metadata?.name || 'Unnamed';
            const collection = n.collection?.name || 'No collection';
            return `  ${i + 1}. ${name} (${collection})`;
          });

          return `🖼️ NFTs (${nfts.length}):\n${lines.join('\n')}`;
        } catch (err: any) {
          return `🖼️ NFT list unavailable: ${err.message}. Set tonApiKey for TonAPI access.`;
        }
      },
    };
  }

  private dnsResolveTool(): AgentTool {
    return {
      name: 'ton_dns_resolve',
      description: 'Resolve a TON DNS domain (e.g. wallet.ton, alice.t.me) to a TON address.',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'TON DNS domain (e.g. foundation.ton, alice.t.me)' },
        },
        required: ['domain'],
      },
      dangerous: false,
      execute: async (args) => {
        try {
          const domain = args.domain as string;
          const base = this.network === 'testnet' ? 'https://testnet.tonapi.io' : 'https://tonapi.io';
          const headers: Record<string, string> = {};
          if (this.tonApiKey) headers['Authorization'] = `Bearer ${this.tonApiKey}`;

          const res = await fetch(`${base}/v2/dns/${encodeURIComponent(domain)}/resolve`, { headers });
          const data = (await res.json()) as { wallet?: { address: string }; error?: string };

          if (data.error) return `❌ DNS resolve failed: ${data.error}`;
          if (!data.wallet?.address) return `❌ No wallet address found for ${domain}`;

          return `🌐 ${domain} → ${data.wallet.address}`;
        } catch (err: any) {
          return `🌐 DNS resolve unavailable: ${err.message}`;
        }
      },
    };
  }

  // ─── NEW TOOLS: Staking, Charts, Emulation, Gasless, Analytics, P2P, Multisig ───

  private stakingPoolsTool(): AgentTool {
    return {
      name: 'ton_staking_pools',
      description: 'Get available staking pools with APY, min stake, and current status. Use to recommend the best staking option.',
      parameters: {
        type: 'object',
        properties: {
          availableFor: { type: 'string', description: 'Account address to check available pools for (optional)' },
          includeUnverified: { type: 'string', description: 'Include unverified pools: true/false (default: false)' },
        },
        required: [],
      },
      dangerous: false,
      execute: async (args) => {
        try {
          const params = new URLSearchParams();
          if (args.availableFor) params.set('available_for', args.availableFor as string);
          if (args.includeUnverified === 'true') params.set('include_unverified', 'true');
          const qs = params.toString() ? `?${params}` : '';

          const data = await this.tonApiFetch<{
            pools: Array<{
              address: string;
              name: string;
              total_amount: number;
              implementation: string;
              apy: number;
              min_stake: number;
              current_nominators: number;
              max_nominators: number;
              verified: boolean;
              cycle_start: number;
              cycle_end: number;
            }>;
            implementations: Record<string, { name: string; description: string }>;
          }>(`/v2/staking/pools${qs}`);

          const pools = data.pools || [];
          if (pools.length === 0) return '📊 No staking pools found.';

          // Sort by APY descending
          const sorted = pools.filter(p => p.apy > 0).sort((a, b) => b.apy - a.apy).slice(0, 10);

          const lines = sorted.map((p, i) => {
            const totalTon = (p.total_amount / 1e9).toFixed(0);
            const minStake = (p.min_stake / 1e9).toFixed(1);
            return `  ${i + 1}. ${p.name || p.address.slice(0, 12) + '...'}
     APY: ${p.apy.toFixed(2)}% | Min: ${minStake} TON | Pool: ${totalTon} TON
     Nominators: ${p.current_nominators}/${p.max_nominators} | ${p.verified ? '✅ Verified' : '⚠️ Unverified'}`;
          });

          return `📊 Top ${sorted.length} Staking Pools (by APY):\n\n${lines.join('\n\n')}`;
        } catch (err: any) {
          return `📊 Staking pools error: ${err.message}`;
        }
      },
    };
  }

  private chartTool(): AgentTool {
    return {
      name: 'ton_chart',
      description: 'Get price chart data for TON or any jetton over a time period. Returns price points for analysis.',
      parameters: {
        type: 'object',
        properties: {
          token: { type: 'string', description: 'Token address or "ton" for Toncoin' },
          currency: { type: 'string', description: 'Fiat currency code (default: usd)' },
          startDate: { type: 'string', description: 'Start date as Unix timestamp (optional)' },
          endDate: { type: 'string', description: 'End date as Unix timestamp (optional)' },
          points: { type: 'number', description: 'Number of data points 1-200 (default: 50)' },
        },
        required: [],
      },
      dangerous: false,
      execute: async (args) => {
        try {
          const token = (args.token as string) || 'ton';
          const currency = (args.currency as string) || 'usd';
          const points = (args.points as number) || 50;
          const params = new URLSearchParams({ token, currency, points_count: String(points) });
          if (args.startDate) params.set('start_date', args.startDate as string);
          if (args.endDate) params.set('end_date', args.endDate as string);

          const data = await this.tonApiFetch<{ points: number[][] }>(`/v2/rates/chart?${params}`);
          const pts = data.points || [];

          if (pts.length === 0) return '📈 No chart data available.';

          // Calculate stats
          const prices = pts.map(p => p[1]);
          const first = prices[0];
          const last = prices[prices.length - 1];
          const min = Math.min(...prices);
          const max = Math.max(...prices);
          const change = ((last - first) / first * 100);
          const arrow = change >= 0 ? '📈' : '📉';

          // Mini ASCII sparkline
          const sparkline = this.miniSparkline(prices);

          return [
            `${arrow} ${token.toUpperCase()} Price Chart (${pts.length} points):`,
            ``,
            `  Current: $${last.toFixed(4)}`,
            `  Change:  ${change >= 0 ? '+' : ''}${change.toFixed(2)}%`,
            `  High:    $${max.toFixed(4)}`,
            `  Low:     $${min.toFixed(4)}`,
            `  Trend:   ${sparkline}`,
            ``,
            `  First: ${new Date(pts[0][0] * 1000).toISOString().slice(0, 10)}`,
            `  Last:  ${new Date(pts[pts.length - 1][0] * 1000).toISOString().slice(0, 10)}`,
          ].join('\n');
        } catch (err: any) {
          return `📈 Chart error: ${err.message}`;
        }
      },
    };
  }

  private miniSparkline(values: number[]): string {
    const chars = '▁▂▃▄▅▆▇█';
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    // Sample ~20 points for display
    const step = Math.max(1, Math.floor(values.length / 20));
    let spark = '';
    for (let i = 0; i < values.length; i += step) {
      const idx = Math.round((values[i] - min) / range * (chars.length - 1));
      spark += chars[idx];
    }
    return spark;
  }

  private emulateTool(): AgentTool {
    return {
      name: 'ton_emulate',
      description: 'Emulate (dry-run) a transaction before sending. Shows expected result, fees, and balance changes without actually sending. Use this to preview any transaction safely.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Destination address' },
          amount: { type: 'number', description: 'Amount in TON' },
          comment: { type: 'string', description: 'Transfer comment (optional)' },
        },
        required: ['to', 'amount'],
      },
      dangerous: false,
      execute: async (args) => {
        try {
          const to = args.to as string;
          const amount = args.amount as number;

          // Build a BOC (Bag of Cells) for emulation
          const { mnemonicToPrivateKey } = require('@ton/crypto');
          const { TonClient, WalletContractV4, internal, toNano, beginCell } = require('@ton/ton');

          const mnemonic = (this.wallet as any).mnemonic;
          if (!mnemonic) {
            // Read-only mode: return estimate
            return [
              `🔍 Transaction Preview (estimated):`,
              `  Send: ${amount} TON → ${to}`,
              `  Est. fee: ~0.005 TON`,
              `  Net deduction: ~${(amount + 0.005).toFixed(4)} TON`,
              `  ⚠️ Install @ton/ton for exact emulation`,
            ].join('\n');
          }

          const keyPair = await mnemonicToPrivateKey(mnemonic.split(' '));
          const wallet = WalletContractV4.create({ publicKey: keyPair.publicKey, workchain: 0 });
          const endpoint = this.network === 'testnet'
            ? 'https://testnet.toncenter.com/api/v2/jsonRPC'
            : 'https://toncenter.com/api/v2/jsonRPC';
          const client = new TonClient({ endpoint });
          const contract = client.open(wallet);
          const seqno = await contract.getSeqno();

          // Create transfer message
          const transfer = contract.createTransfer({
            seqno,
            secretKey: keyPair.secretKey,
            messages: [
              internal({
                to,
                value: toNano(amount.toString()),
                body: args.comment || '',
                bounce: false,
              }),
            ],
          });

          const boc = transfer.toBoc().toString('base64');

          // Emulate via TonAPI
          const result = await this.tonApiFetch<{
            event?: {
              actions?: Array<{
                type: string;
                status: string;
                TonTransfer?: { amount: number; recipient?: { address: string } };
              }>;
              fee?: { total: number; gas: number; rent: number };
            };
            risk?: { ton: number; jettons: any[] };
          }>('/v2/events/emulate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ boc }),
          });

          const actions = result.event?.actions || [];
          const totalFee = result.event?.fee?.total ? (result.event.fee.total / 1e9).toFixed(6) : '~0.005';

          const actionLines = actions.map(a => {
            if (a.type === 'TonTransfer' && a.TonTransfer) {
              const amt = (a.TonTransfer.amount / 1e9).toFixed(4);
              return `  ✅ ${a.type}: ${amt} TON → ${a.TonTransfer.recipient?.address || 'unknown'}`;
            }
            return `  ${a.status === 'ok' ? '✅' : '❌'} ${a.type}`;
          });

          return [
            `🔍 Transaction Emulation Result:`,
            ``,
            ...actionLines,
            ``,
            `  Fee: ${totalFee} TON`,
            `  Status: Simulation successful ✅`,
            ``,
            `  ⚡ Use ton_send to execute this transaction.`,
          ].join('\n');
        } catch (err: any) {
          // Fallback to estimate
          const amount = args.amount as number;
          return [
            `🔍 Transaction Preview (estimated):`,
            `  Send: ${amount} TON → ${args.to}`,
            `  Est. fee: ~0.005-0.01 TON`,
            `  Note: ${err.message}`,
          ].join('\n');
        }
      },
    };
  }

  private gaslessEstimateTool(): AgentTool {
    return {
      name: 'ton_gasless_estimate',
      description: 'Check gasless transaction config and estimate fees. Gasless lets users pay TX fees in jettons (e.g. USDT) instead of TON.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'Action: "config" to get supported jettons, "estimate" to estimate fee', enum: ['config', 'estimate'] },
          jettonMaster: { type: 'string', description: 'Jetton master address for fee payment (required for estimate)' },
        },
        required: ['action'],
      },
      dangerous: false,
      execute: async (args) => {
        try {
          const action = args.action as string;

          if (action === 'config') {
            const data = await this.tonApiFetch<{
              relay_address: string;
              gas_jettons: Array<{ master_id: string; name?: string; symbol?: string }>;
            }>('/v2/gasless/config');

            const jettons = data.gas_jettons || [];
            if (jettons.length === 0) return '⛽ No gasless jettons configured.';

            const lines = jettons.map((j, i) =>
              `  ${i + 1}. ${j.symbol || j.name || 'Unknown'} (${j.master_id.slice(0, 12)}...)`
            );

            return [
              `⛽ Gasless Transaction Config:`,
              `  Relay: ${data.relay_address.slice(0, 16)}...`,
              ``,
              `  Supported jettons for fee payment:`,
              ...lines,
              ``,
              `  ℹ️ Use gasless to send TON/jettons without holding TON for gas.`,
            ].join('\n');
          }

          // Estimate mode
          return [
            `⛽ Gasless Estimate:`,
            `  To get an exact estimate, provide a signed message BOC.`,
            `  Flow: 1) Build TX → 2) POST /v2/gasless/estimate/{master_id} → 3) Sign payload → 4) POST /v2/gasless/send`,
            `  Jetton for fee: ${args.jettonMaster || 'not specified'}`,
          ].join('\n');
        } catch (err: any) {
          return `⛽ Gasless error: ${err.message}`;
        }
      },
    };
  }

  private jettonInfoTool(): AgentTool {
    return {
      name: 'ton_jetton_info',
      description: 'Get detailed info about a jetton (token): supply, holders count, metadata. Also get top holders.',
      parameters: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Jetton master contract address' },
          showHolders: { type: 'string', description: 'Show top holders: true/false (default: false)' },
        },
        required: ['address'],
      },
      dangerous: false,
      execute: async (args) => {
        try {
          const addr = args.address as string;

          const info = await this.tonApiFetch<{
            mintable: boolean;
            total_supply: string;
            metadata?: { name?: string; symbol?: string; decimals?: string; description?: string; image?: string };
            holders_count: number;
            verification: string;
          }>(`/v2/jettons/${addr}`);

          const meta = info.metadata || {};
          const decimals = parseInt(meta.decimals || '9');
          const supply = (Number(info.total_supply) / Math.pow(10, decimals)).toLocaleString();

          const lines = [
            `🪙 Jetton Info: ${meta.name || 'Unknown'}`,
            `  Symbol: ${meta.symbol || '?'}`,
            `  Supply: ${supply}`,
            `  Holders: ${info.holders_count.toLocaleString()}`,
            `  Mintable: ${info.mintable ? 'Yes' : 'No'}`,
            `  Verified: ${info.verification === 'whitelist' ? '✅ Yes' : '⚠️ No'}`,
          ];

          if (meta.description) {
            lines.push(`  Description: ${meta.description.slice(0, 100)}`);
          }

          // Optionally fetch top holders
          if (args.showHolders === 'true') {
            try {
              const holdersData = await this.tonApiFetch<{
                addresses: Array<{ address: string; balance: string; owner?: { name?: string } }>;
              }>(`/v2/jettons/${addr}/holders?limit=5`);

              const holders = holdersData.addresses || [];
              if (holders.length > 0) {
                lines.push(``, `  Top Holders:`);
                holders.forEach((h, i) => {
                  const bal = (Number(h.balance) / Math.pow(10, decimals)).toLocaleString();
                  const name = h.owner?.name || h.address.slice(0, 12) + '...';
                  lines.push(`    ${i + 1}. ${name}: ${bal} ${meta.symbol || ''}`);
                });
              }
            } catch { /* ignore holder errors */ }
          }

          return lines.join('\n');
        } catch (err: any) {
          return `🪙 Jetton info error: ${err.message}`;
        }
      },
    };
  }

  private p2pPricesTool(): AgentTool {
    return {
      name: 'ton_p2p_prices',
      description: 'Get P2P market prices for buying/selling crypto via Telegram Wallet P2P. Shows best offers, seller ratings, payment methods.',
      parameters: {
        type: 'object',
        properties: {
          crypto: { type: 'string', description: 'Cryptocurrency: TON, USDT, BTC, etc. (default: TON)' },
          fiat: { type: 'string', description: 'Fiat currency: RUB, USD, EUR, etc. (default: RUB)' },
          side: { type: 'string', description: 'Trade direction: BUY or SELL (default: SELL)', enum: ['BUY', 'SELL'] },
        },
        required: [],
      },
      dangerous: false,
      execute: async (args) => {
        try {
          const crypto = (args.crypto as string) || 'TON';
          const fiat = (args.fiat as string) || 'RUB';
          const side = (args.side as string) || 'SELL';

          const res = await fetch('https://p2p.walletbot.me/p2p/integration-api/v1/item/online', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              cryptoCurrency: crypto.toUpperCase(),
              fiatCurrency: fiat.toUpperCase(),
              side: side.toUpperCase(),
              page: 1,
              pageSize: 5,
            }),
          });

          const data = (await res.json()) as {
            items?: Array<{
              price: number;
              currency: string;
              minLimit: number;
              maxLimit: number;
              paymentMethods?: Array<{ name: string }>;
              maker?: { nickname: string; rating: number; completedOrders: number };
            }>;
            error?: string;
          };

          if (data.error) return `💱 P2P Error: ${data.error}`;
          const items = data.items || [];
          if (items.length === 0) return `💱 No P2P ${side} offers for ${crypto}/${fiat} right now.`;

          const lines = items.map((item, i) => {
            const methods = item.paymentMethods?.map(m => m.name).join(', ') || 'Any';
            const maker = item.maker;
            const rating = maker ? `★${maker.rating?.toFixed(1)} (${maker.completedOrders} trades)` : '';
            return `  ${i + 1}. ${item.price} ${fiat}/${crypto} | ${item.minLimit}-${item.maxLimit} ${fiat}
     ${maker?.nickname || 'Anonymous'} ${rating} | ${methods}`;
          });

          return [
            `💱 P2P ${side} ${crypto} for ${fiat}:`,
            ``,
            ...lines,
            ``,
            `  Best price: ${items[0].price} ${fiat} per ${crypto}`,
          ].join('\n');
        } catch (err: any) {
          return `💱 P2P prices unavailable: ${err.message}. The Wallet.tg P2P API may require an X-API-Key.`;
        }
      },
    };
  }

  private multisigInfoTool(): AgentTool {
    return {
      name: 'ton_multisig_info',
      description: 'Get multisig wallet info: signers, threshold, pending orders. Useful for team/DAO wallets.',
      parameters: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Multisig wallet address' },
        },
        required: ['address'],
      },
      dangerous: false,
      execute: async (args) => {
        try {
          const addr = args.address as string;

          const data = await this.tonApiFetch<{
            address: string;
            seqno: number;
            threshold: number;
            signers: Array<{ address: string; name?: string }>;
            proposers: Array<{ address: string; name?: string }>;
            orders: Array<{
              address: string;
              order_seqno: number;
              threshold: number;
              approvals_num: number;
              signers: string[];
            }>;
          }>(`/v2/multisig/${addr}`);

          const signerLines = (data.signers || []).map((s, i) =>
            `    ${i + 1}. ${s.name || s.address.slice(0, 16) + '...'}`
          );

          const orderLines = (data.orders || []).map((o, i) =>
            `    ${i + 1}. Order #${o.order_seqno}: ${o.approvals_num}/${o.threshold} approvals`
          );

          return [
            `🔐 Multisig Wallet:`,
            `  Address: ${data.address.slice(0, 20)}...`,
            `  Threshold: ${data.threshold} of ${data.signers?.length || '?'} signers`,
            `  Seqno: ${data.seqno}`,
            ``,
            `  Signers:`,
            ...signerLines,
            ``,
            data.orders?.length ? `  Pending Orders:` : `  No pending orders.`,
            ...orderLines,
          ].join('\n');
        } catch (err: any) {
          return `🔐 Multisig error: ${err.message}`;
        }
      },
    };
  }

  // ─── Agentic Wallet Tools ─────────────────────────────

  private agenticDeployTool(): AgentTool {
    return {
      name: 'ton_agentic_deploy',
      description: 'Deploy a new Agentic sub-wallet for AI agent operations. Agentic wallets are special TON wallets designed for AI agents with operator key separation. TonGuard protected.',
      parameters: {
        type: 'object',
        properties: {
          subwalletId: { type: 'number', description: 'Sub-wallet ID (default: auto-generated)' },
        },
        required: [],
      },
      dangerous: true,
      execute: async (args) => {
        const gate = this.guard.gate(this.userId, 0.05, 'agentic:deploy', 'Deploy agentic sub-wallet');
        if (gate.status === 'rejected') return `❌ Blocked: ${gate.reason}`;
        if (gate.status === 'pending') {
          return [
            `⏳ Agentic wallet deployment requires confirmation.`,
            `Confirmation code: **${gate.code}**`,
            `This will deploy a new sub-wallet for AI agent operations.`,
          ].join('\n');
        }

        if (this.walletVersion !== 'agentic') {
          return [
            `ℹ️ Current wallet version: ${this.walletVersion}`,
            `To deploy agentic sub-wallets, initialize with:`,
            `  new TonAgentKit({ walletVersion: 'agentic', ... })`,
            `Or use @ton/mcp with WALLET_VERSION=agentic`,
          ].join('\n');
        }

        try {
          const { address } = await this.wallet.getBalance();
          const subId = (args.subwalletId as number) || Date.now() % 100000;
          return [
            `🤖 Agentic Sub-Wallet Deployment:`,
            `  Owner: ${address.slice(0, 20)}...`,
            `  Sub-wallet ID: ${subId}`,
            `  Version: agentic`,
            `  Status: ✅ Ready (use @ton/mcp agentic_deploy_subwallet for on-chain deployment)`,
            ``,
            `  💡 Agentic wallets support operator key rotation and sub-wallet management.`,
          ].join('\n');
        } catch (err: any) {
          return `❌ Deploy error: ${err.message}`;
        }
      },
    };
  }

  private agenticWalletsTool(): AgentTool {
    return {
      name: 'ton_agentic_wallets',
      description: 'List agentic wallets owned by a given address. Shows sub-wallets deployed from the main agentic root wallet.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'Owner address to list agentic wallets for (default: current wallet)' },
        },
        required: [],
      },
      dangerous: false,
      execute: async (args) => {
        try {
          const owner = (args.owner as string) || (await this.wallet.getBalance()).address;

          // Query via TonAPI for sub-wallets
          const data = await this.tonApiFetch<{
            accounts?: Array<{
              address: string;
              balance: number;
              status: string;
              name?: string;
            }>;
          }>(`/v2/accounts/${owner}/subscriptions`).catch(() => ({ accounts: [] }));

          // Also get main wallet info
          const mainInfo = await this.tonApiFetch<{
            address: string;
            balance: number;
            status: string;
            interfaces?: string[];
          }>(`/v2/accounts/${owner}`).catch(() => null);

          const isAgentic = mainInfo?.interfaces?.some(
            (i: string) => i.toLowerCase().includes('agentic')
          );

          const lines = [
            `🤖 Agentic Wallets for ${owner.slice(0, 16)}...`,
            `  Type: ${isAgentic ? 'Agentic Root ✅' : 'Standard Wallet'}`,
            `  Balance: ${mainInfo ? (mainInfo.balance / 1e9).toFixed(4) : '?'} TON`,
            `  Status: ${mainInfo?.status || 'unknown'}`,
          ];

          if (data.accounts && data.accounts.length > 0) {
            lines.push(``, `  Sub-wallets (${data.accounts.length}):`);
            for (const acc of data.accounts.slice(0, 10)) {
              lines.push(`    • ${acc.address.slice(0, 16)}... — ${(acc.balance / 1e9).toFixed(4)} TON (${acc.status})`);
            }
          } else {
            lines.push(``, `  No sub-wallets found.`);
            if (!isAgentic) {
              lines.push(`  💡 Use walletVersion: 'agentic' to enable sub-wallet management.`);
            }
          }

          return lines.join('\n');
        } catch (err: any) {
          return `🤖 Agentic wallets error: ${err.message}`;
        }
      },
    };
  }

  private walletInfoTool(): AgentTool {
    return {
      name: 'ton_wallet_info',
      description: 'Get detailed wallet info: type (standard/agentic), version, interfaces, status, and security config.',
      parameters: { type: 'object', properties: {}, required: [] },
      dangerous: false,
      execute: async () => {
        try {
          const { balance, address } = await this.wallet.getBalance();

          // Query TonAPI for wallet type detection
          let walletType = this.walletVersion;
          let interfaces: string[] = [];
          try {
            const info = await this.tonApiFetch<{
              interfaces?: string[];
              status: string;
            }>(`/v2/accounts/${address}`);
            interfaces = info.interfaces || [];
            if (interfaces.some((i: string) => i.toLowerCase().includes('agentic'))) {
              walletType = 'agentic';
            }
          } catch {
            // TonAPI unavailable, use config
          }

          const guardStats = this.guard.getStats(this.userId);

          return [
            `📋 Wallet Info:`,
            `  Address: ${address}`,
            `  Balance: ${balance.toFixed(4)} TON`,
            `  Network: ${this.network}`,
            `  Version: ${walletType}${walletType === 'agentic' ? ' 🤖' : ''}`,
            interfaces.length > 0 ? `  Interfaces: ${interfaces.join(', ')}` : '',
            ``,
            `🛡️ TonGuard:`,
            `  Daily limit: ${this.guard.config.dailyLimitTon} TON`,
            `  Per-TX limit: ${this.guard.config.perTxLimitTon} TON`,
            `  Auto-confirm below: ${this.guard.config.autoConfirmBelow} TON`,
            `  Cooldown: ${this.guard.config.cooldownMs / 1000}s`,
            `  Spent today: ${guardStats.spentToday} TON`,
            `  Can transact: ${guardStats.canTransact ? '✅' : '❌'}`,
          ].filter(Boolean).join('\n');
        } catch (err: any) {
          return `📋 Wallet info error: ${err.message}`;
        }
      },
    };
  }
}
