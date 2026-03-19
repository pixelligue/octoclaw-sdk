"""
tonguard — Smoke tests
Run: python test_kit.py
"""

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

passed = 0
failed = 0

def test(name, fn):
    global passed, failed
    try:
        fn()
        print(f"  ✅ {name}")
        passed += 1
    except Exception as e:
        print(f"  ❌ {name}: {e}")
        failed += 1

print("\n🧪 tonguard (Python) — Test Suite\n")

# ── TonGuard ──
print("── TonGuard ──")
from tonguard import TonGuard

guard = TonGuard(daily_limit=10, per_tx_limit=5, auto_confirm_below=0.1, cooldown_seconds=0)

def test_auto_confirm():
    r = guard.gate("u1", 0.05)
    assert r.status == "approved", f"expected approved, got {r.status}"
test("auto-confirm small amount", test_auto_confirm)

def test_pending():
    r = guard.gate("u2", 3.0)
    assert r.status == "pending", f"expected pending, got {r.status}"
    assert r.code is not None and len(r.code) == 6, f"bad code: {r.code}"
test("pending for large amount", test_pending)

def test_confirm():
    g = guard.gate("u3", 2.0)
    assert g.status == "pending"
    c = guard.confirm("u3", g.code)
    assert c.status == "approved", f"expected approved, got {c.status}"
    assert c.amount == 2.0
test("confirm with valid code", test_confirm)

def test_reject_pertx():
    r = guard.gate("u4", 6.0)
    assert r.status == "rejected", f"expected rejected, got {r.status}"
test("reject over per-tx limit", test_reject_pertx)

def test_invalid_code():
    c = guard.confirm("u99", "BADCODE")
    assert c.status == "invalid"
test("confirm with invalid code", test_invalid_code)

def test_stats():
    g2 = TonGuard(daily_limit=10, cooldown_seconds=0, auto_confirm_below=5)
    g2.gate("u6", 3.0)
    s = g2.get_stats("u6")
    assert s.spent_today == 3.0, f"spent {s.spent_today}"
    assert s.remaining_today == 7.0, f"remaining {s.remaining_today}"
    assert s.tx_count_today == 1
test("stats tracking", test_stats)

# ── TonAgentKit ──
print("\n── TonAgentKit ──")
from tonguard import TonAgentKit

kit = TonAgentKit(daily_limit=10, auto_confirm_below=0.1, cooldown_seconds=0)

def test_12_tools():
    tools = kit.get_tools()
    assert len(tools) == 12, f"expected 12 tools, got {len(tools)}"
test("creates 12 tools", test_12_tools)

def test_unique_names():
    names = [t.name for t in kit.get_tools()]
    assert len(set(names)) == len(names), f"duplicate names"
test("tool names are unique", test_unique_names)

def test_tool_fields():
    for t in kit.get_tools():
        assert t.name, f"missing name"
        assert t.description, f"missing desc for {t.name}"
        assert callable(t.execute), f"execute not callable for {t.name}"
        assert isinstance(t.dangerous, bool), f"bad dangerous for {t.name}"
test("all tools have required fields", test_tool_fields)

def test_dangerous_flags():
    dangerous = [t.name for t in kit.get_tools() if t.dangerous]
    assert "ton_send" in dangerous
    assert "ton_swap" in dangerous
    assert "ton_jetton_send" in dangerous
    assert "ton_confirm" in dangerous
test("dangerous flags correct", test_dangerous_flags)

# ── Tool Execution ──
print("\n── Tool Execution ──")
tools = kit.get_tools()
by_name = {t.name: t for t in tools}

def test_balance():
    r = by_name["ton_balance"].execute()
    assert "100.0000" in r, f"expected 100: {r}"
    assert "EQ_mock" in r
test("ton_balance returns mock", test_balance)

def test_price():
    r = by_name["ton_price"].execute()
    assert "TON:" in r, f"expected price: {r}"
test("ton_price returns data", test_price)

def test_send_guard():
    r = by_name["ton_send"].execute(to="EQxyz", amount=5.0)
    assert "Confirmation code" in r, f"expected code: {r}"
test("ton_send triggers TonGuard", test_send_guard)

def test_send_small():
    kit2 = TonAgentKit(auto_confirm_below=1, cooldown_seconds=0, daily_limit=100)
    t2 = {t.name: t for t in kit2.get_tools()}
    r = t2["ton_send"].execute(to="EQxyz", amount=0.05)
    assert "Sent" in r, f"expected sent: {r}"
test("ton_send auto-confirms small", test_send_small)

def test_swap():
    r = by_name["ton_swap"].execute(from_token="TON", to_token="USDT", amount=5.0)
    assert "Confirmation code" in r or "blocked" in r, f"expected guard: {r}"
test("ton_swap triggers TonGuard", test_swap)

def test_jetton_balance():
    r = by_name["ton_jetton_balance"].execute()
    assert "USDT" in r and "NOT" in r, f"expected jettons: {r}"
test("ton_jetton_balance shows mock data", test_jetton_balance)

def test_nft_list():
    r = by_name["ton_nft_list"].execute()
    assert "alice.ton" in r, f"expected NFTs: {r}"
test("ton_nft_list shows mock data", test_nft_list)

def test_guard_check():
    r = by_name["ton_guard_check"].execute(amount=3.0)
    assert "TonGuard" in r
test("ton_guard_check works", test_guard_check)

def test_limits():
    r = by_name["ton_limits"].execute()
    assert "TonGuard Status" in r
test("ton_limits shows stats", test_limits)

def test_confirm_invalid():
    r = by_name["ton_confirm"].execute(code="BADCODE")
    assert "Invalid" in r
test("ton_confirm rejects invalid", test_confirm_invalid)

def test_history():
    r = by_name["ton_history"].execute()
    assert isinstance(r, str)
test("ton_history returns data", test_history)

# ── Results ──
print(f"\n{'═' * 40}")
print(f"🏁 Results: {passed} passed, {failed} failed")
print(f"{'═' * 40}\n")

sys.exit(1 if failed > 0 else 0)
