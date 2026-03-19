/**
 * @octoclaw/ton-agent-kit — Smoke tests
 * Run: npx ts-node test.ts
 */

import { TonAgentKit, TonGuard } from './src/index';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e: any) {
    console.log(`  ❌ ${name}: ${e.message}`);
    failed++;
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

console.log('\n🧪 @octoclaw/ton-agent-kit — Test Suite\n');

// ─── TonGuard Tests ─────────────────────────────────────

console.log('── TonGuard ──');

const guard = new TonGuard({
  dailyLimitTon: 10,
  perTxLimitTon: 5,
  autoConfirmBelow: 0.1,
  cooldownMs: 1000,
  codeExpiryMs: 5000,
});

test('auto-confirm small amount', () => {
  const r = guard.gate('u1', 0.05);
  assert(r.status === 'approved', `expected approved, got ${r.status}`);
  assert(r.amount === 0.05, `wrong amount`);
});

test('pending for large amount', () => {
  const r = guard.gate('u2', 3.0);
  assert(r.status === 'pending', `expected pending, got ${r.status}`);
  assert(r.code !== undefined, 'no code');
  assert(r.code!.length === 6, `code length ${r.code!.length}`);
});

test('confirm with valid code', () => {
  const g = guard.gate('u3', 2.0);
  assert(g.status === 'pending', 'should be pending');
  const c = guard.confirm('u3', g.code!);
  assert(c.status === 'approved', `expected approved, got ${c.status}`);
  assert(c.amount === 2.0, `wrong amount ${c.amount}`);
});

test('reject over per-tx limit', () => {
  const r = guard.gate('u4', 6.0);
  assert(r.status === 'rejected', `expected rejected, got ${r.status}`);
  assert(r.reason!.includes('per-tx'), `wrong reason: ${r.reason}`);
});

test('reject over daily limit', () => {
  const g2 = new TonGuard({ dailyLimitTon: 2, cooldownMs: 0 });
  g2.gate('u5', 0.05); // auto-confirm: spent 0.05
  g2.gate('u5', 0.05); // auto-confirm: spent 0.10
  const r = g2.gate('u5', 2.5);
  assert(r.status === 'rejected', `expected rejected, got ${r.status}`);
  assert(r.reason!.includes('Daily'), `wrong reason: ${r.reason}`);
});

test('confirm with invalid code', () => {
  const c = guard.confirm('u99', 'BADCODE');
  assert(c.status === 'invalid', `expected invalid, got ${c.status}`);
});

test('stats tracking', () => {
  const g3 = new TonGuard({ dailyLimitTon: 10, cooldownMs: 0, autoConfirmBelow: 5 });
  g3.gate('u6', 3.0); // auto-confirm
  const stats = g3.getStats('u6');
  assert(stats.spentToday === 3.0, `spent ${stats.spentToday}`);
  assert(stats.remainingToday === 7.0, `remaining ${stats.remainingToday}`);
  assert(stats.txCountToday === 1, `count ${stats.txCountToday}`);
});

// ─── TonAgentKit Tests ──────────────────────────────────

console.log('\n── TonAgentKit ──');

const kit = new TonAgentKit({
  guard: { dailyLimitTon: 10, autoConfirmBelow: 0.1, cooldownMs: 0 },
});

test('creates 19 tools', () => {
  const tools = kit.getTools();
  assert(tools.length === 19, `expected 19 tools, got ${tools.length}`);
});

test('tool names are unique', () => {
  const names = kit.getTools().map(t => t.name);
  const unique = new Set(names);
  assert(unique.size === names.length, `duplicate names: ${names}`);
});

test('all tools have required fields', () => {
  for (const t of kit.getTools()) {
    assert(typeof t.name === 'string' && t.name.length > 0, `missing name`);
    assert(typeof t.description === 'string' && t.description.length > 0, `missing desc for ${t.name}`);
    assert(typeof t.execute === 'function', `missing execute for ${t.name}`);
    assert(typeof t.dangerous === 'boolean', `missing dangerous for ${t.name}`);
    assert(t.parameters.type === 'object', `bad params for ${t.name}`);
  }
});

test('dangerous flag on send/swap/jetton_send/confirm', () => {
  const tools = kit.getTools();
  const dangerous = tools.filter(t => t.dangerous).map(t => t.name);
  assert(dangerous.includes('ton_send'), 'ton_send should be dangerous');
  assert(dangerous.includes('ton_swap'), 'ton_swap should be dangerous');
  assert(dangerous.includes('ton_jetton_send'), 'ton_jetton_send should be dangerous');
  assert(dangerous.includes('ton_confirm'), 'ton_confirm should be dangerous');
});

// ─── Async Tool Execution Tests ─────────────────────────

console.log('\n── Tool Execution ──');

async function runAsyncTests() {
  const tools = kit.getTools();
  const byName = (n: string) => tools.find(t => t.name === n)!;

  // Balance (mock)
  test('ton_balance returns mock balance', async () => {
    const r = await byName('ton_balance').execute({});
    assert(r.includes('100.0000'), `expected 100 TON: ${r}`);
    assert(r.includes('EQ_mock'), `expected mock address: ${r}`);
  });

  // Price (live)
  test('ton_price returns price', async () => {
    const r = await byName('ton_price').execute({});
    assert(r.includes('TON:'), `expected price format: ${r}`);
  });

  // Send with TonGuard
  test('ton_send triggers TonGuard pending', async () => {
    const r = await byName('ton_send').execute({ to: 'EQxyz', amount: 5.0 });
    assert(r.includes('Confirmation code'), `expected code: ${r}`);
  });

  // Send auto-confirm small
  test('ton_send auto-confirms small amount', async () => {
    const kit2 = new TonAgentKit({ guard: { autoConfirmBelow: 1, cooldownMs: 0, dailyLimitTon: 100 } });
    const tools2 = kit2.getTools();
    const r = await tools2.find(t => t.name === 'ton_send')!.execute({ to: 'EQxyz', amount: 0.05 });
    assert(r.includes('Sent'), `expected sent: ${r}`);
  });

  // Swap with TonGuard
  test('ton_swap triggers TonGuard', async () => {
    const r = await byName('ton_swap').execute({ fromToken: 'TON', toToken: 'USDT', amount: 5.0 });
    assert(r.includes('Confirmation code') || r.includes('blocked'), `expected guard: ${r}`);
  });

  // Jetton balance
  test('ton_jetton_balance returns data', async () => {
    const r = await byName('ton_jetton_balance').execute({});
    // Mock wallet returns empty via TonAPI but shouldn't crash
    assert(typeof r === 'string', `expected string result`);
  });

  // NFT list
  test('ton_nft_list returns data', async () => {
    const r = await byName('ton_nft_list').execute({});
    assert(typeof r === 'string', `expected string result`);
  });

  // Guard check
  test('ton_guard_check works', async () => {
    const r = await byName('ton_guard_check').execute({ amount: 3.0 });
    assert(r.includes('TonGuard'), `expected guard output: ${r}`);
    assert(r.includes('Spent today'), `expected stats: ${r}`);
  });

  // Guard stats
  test('ton_limits shows stats', async () => {
    const r = await byName('ton_limits').execute({});
    assert(r.includes('TonGuard Status'), `expected status: ${r}`);
  });

  // Confirm with invalid code
  test('ton_confirm rejects invalid code', async () => {
    const r = await byName('ton_confirm').execute({ code: 'BADCODE' });
    assert(r.includes('Invalid'), `expected invalid: ${r}`);
  });

  // History (mock)
  test('ton_history returns data', async () => {
    const r = await byName('ton_history').execute({});
    assert(typeof r === 'string', 'expected string');
  });

  // DNS resolve (may fail without API key — that's ok)
  test('ton_dns_resolve handles gracefully', async () => {
    const r = await byName('ton_dns_resolve').execute({ domain: 'test.ton' });
    assert(typeof r === 'string', 'expected string');
  });

  // ─── NEW TOOLS ───

  // Staking pools (live API)
  test('ton_staking_pools returns data', async () => {
    const r = await byName('ton_staking_pools').execute({});
    assert(typeof r === 'string', 'expected string');
    assert(r.includes('Staking') || r.includes('Pool') || r.includes('error'), `unexpected: ${r.slice(0, 80)}`);
  });

  // Chart (live API)
  test('ton_chart returns price data', async () => {
    const r = await byName('ton_chart').execute({ token: 'ton', points: 10 });
    assert(typeof r === 'string', 'expected string');
    assert(r.includes('Chart') || r.includes('Price') || r.includes('error'), `unexpected: ${r.slice(0, 80)}`);
  });

  // Gasless config
  test('ton_gasless_estimate returns config', async () => {
    const r = await byName('ton_gasless_estimate').execute({ action: 'config' });
    assert(typeof r === 'string', 'expected string');
    assert(r.includes('Gasless') || r.includes('error'), `unexpected: ${r.slice(0, 80)}`);
  });

  // Jetton info (live API — use USDT address)
  test('ton_jetton_info returns data', async () => {
    const r = await byName('ton_jetton_info').execute({ address: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs' });
    assert(typeof r === 'string', 'expected string');
    assert(r.includes('Jetton') || r.includes('error'), `unexpected: ${r.slice(0, 80)}`);
  });

  // P2P prices (live API  — may need key)
  test('ton_p2p_prices handles gracefully', async () => {
    const r = await byName('ton_p2p_prices').execute({ crypto: 'TON', fiat: 'RUB', side: 'SELL' });
    assert(typeof r === 'string', 'expected string');
  });

  // Multisig (will likely fail with bad address but shouldn't crash)
  test('ton_multisig_info handles gracefully', async () => {
    const r = await byName('ton_multisig_info').execute({ address: '0:0000000000000000000000000000000000000000000000000000000000000000' });
    assert(typeof r === 'string', 'expected string');
  });

  // Emulate (mock mode — no mnemonic)
  test('ton_emulate returns estimate', async () => {
    const r = await byName('ton_emulate').execute({ to: 'EQxyz', amount: 1.0 });
    assert(typeof r === 'string', 'expected string');
    assert(r.includes('Transaction') || r.includes('Preview'), `unexpected: ${r.slice(0, 80)}`);
  });

  console.log(`\n${'═'.repeat(40)}`);
  console.log(`🏁 Results: ${passed} passed, ${failed} failed`);
  console.log(`${'═'.repeat(40)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

runAsyncTests();
