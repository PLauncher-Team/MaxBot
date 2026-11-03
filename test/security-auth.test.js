const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { validateInitData } = require('../auth');

const BOT_TOKEN = 'test-only-max-bot-token';
const NOW_MS = Date.UTC(2026, 10, 3, 12, 0, 0);
const NOW_SECONDS = Math.floor(NOW_MS / 1000);

function createSignedInitData({ userId = '123456789', authDate = NOW_SECONDS, extra = [] } = {}) {
    const params = new URLSearchParams();
    params.append('auth_date', String(authDate));
    params.append('query_id', 'test-query-id');
    params.append('user', JSON.stringify({ id: userId, first_name: 'Test' }));
    for (const [key, value] of extra) params.append(key, value);

    const dataCheckString = [...params.entries()]
        .sort(([left], [right]) => left < right ? -1 : (left > right ? 1 : 0))
        .map(([key, value]) => key + '=' + value)
        .join('\n');
    const secretKey = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    params.append('hash', hash);
    return params.toString();
}

test('accepts valid and fresh MAX launch data', () => {
    const initData = createSignedInitData();
    assert.equal(validateInitData(initData, BOT_TOKEN, NOW_MS), '123456789');
});

test('rejects a signature made with another bot token', () => {
    const initData = createSignedInitData();
    assert.equal(validateInitData(initData, 'another-token', NOW_MS), null);
});

test('rejects tampered launch data', () => {
    const initData = createSignedInitData().replace('Test', 'Changed');
    assert.equal(validateInitData(initData, BOT_TOKEN, NOW_MS), null);
});

test('rejects launch data older than the configured default lifetime', () => {
    const authDate = NOW_SECONDS - (24 * 60 * 60) - 1;
    const initData = createSignedInitData({ authDate });
    assert.equal(validateInitData(initData, BOT_TOKEN, NOW_MS), null);
});

test('rejects launch data too far in the future', () => {
    const initData = createSignedInitData({ authDate: NOW_SECONDS + 61 });
    assert.equal(validateInitData(initData, BOT_TOKEN, NOW_MS), null);
});

test('rejects duplicate parameters', () => {
    const initData = createSignedInitData({ extra: [['auth_date', String(NOW_SECONDS)]] });
    assert.equal(validateInitData(initData, BOT_TOKEN, NOW_MS), null);
});

test('rejects non-numeric user identifiers', () => {
    const initData = createSignedInitData({ userId: 'user_local' });
    assert.equal(validateInitData(initData, BOT_TOKEN, NOW_MS), null);
});

test('rejects malformed hashes and oversized input', () => {
    const valid = createSignedInitData();
    const malformed = valid.replace(/hash=[^&]+/, 'hash=not-a-hash');
    assert.equal(validateInitData(malformed, BOT_TOKEN, NOW_MS), null);
    assert.equal(validateInitData('a'.repeat(16 * 1024 + 1), BOT_TOKEN, NOW_MS), null);
});
