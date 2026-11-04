const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { validateInitData, getMaxUserProfileFromInitData, parseUserIdSet, isUserAllowed } = require('../auth');

const BOT_TOKEN = 'test-only-max-bot-token';
const NOW_MS = Date.UTC(2026, 10, 3, 12, 0, 0);
const NOW_SECONDS = Math.floor(NOW_MS / 1000);

function createSignedInitData({ userId = '123456789', authDate = NOW_SECONDS, extra = [] } = {}) {
    const params = new URLSearchParams();
    params.append('auth_date', String(authDate));
    params.append('query_id', 'test-query-id');
    params.append('user', JSON.stringify({ id: userId, first_name: 'Test', last_name: 'Teacher', username: 'test.teacher' }));
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
    assert.equal(validateInitData(createSignedInitData(), BOT_TOKEN, NOW_MS), '123456789');
});

test('returns the account name from verified MAX launch data', () => {
    assert.deepEqual(
        getMaxUserProfileFromInitData(createSignedInitData(), BOT_TOKEN, NOW_MS),
        { id: '123456789', name: 'Test Teacher' }
    );
});

test('uses the MAX username when the account has no first or last name', () => {
    const params = new URLSearchParams();
    params.append('auth_date', String(NOW_SECONDS));
    params.append('query_id', 'test-query-id');
    params.append('user', JSON.stringify({ id: '123456789', username: 'test.teacher' }));
    const dataCheckString = [...params.entries()]
        .sort(([left], [right]) => left < right ? -1 : (left > right ? 1 : 0))
        .map(([key, value]) => key + '=' + value)
        .join('\n');
    const secretKey = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    params.append('hash', createHmac('sha256', secretKey).update(dataCheckString).digest('hex'));
    assert.deepEqual(
        getMaxUserProfileFromInitData(params.toString(), BOT_TOKEN, NOW_MS),
        { id: '123456789', name: 'test.teacher' }
    );
});

test('rejects a signature made with another bot token', () => {
    assert.equal(validateInitData(createSignedInitData(), 'another-token', NOW_MS), null);
});

test('rejects tampered launch data', () => {
    assert.equal(validateInitData(createSignedInitData().replace('Test', 'Changed'), BOT_TOKEN, NOW_MS), null);
});

test('rejects launch data older than the configured default lifetime', () => {
    const authDate = NOW_SECONDS - (24 * 60 * 60) - 1;
    assert.equal(validateInitData(createSignedInitData({ authDate }), BOT_TOKEN, NOW_MS), null);
});

test('rejects launch data too far in the future', () => {
    assert.equal(validateInitData(createSignedInitData({ authDate: NOW_SECONDS + 61 }), BOT_TOKEN, NOW_MS), null);
});

test('rejects duplicate parameters', () => {
    const initData = createSignedInitData({ extra: [['auth_date', String(NOW_SECONDS)]] });
    assert.equal(validateInitData(initData, BOT_TOKEN, NOW_MS), null);
});

test('rejects non-numeric user identifiers', () => {
    assert.equal(validateInitData(createSignedInitData({ userId: 'user_local' }), BOT_TOKEN, NOW_MS), null);
});

test('rejects malformed hashes and oversized input', () => {
    const valid = createSignedInitData();
    const malformed = valid.replace(/hash=[^&]+/, 'hash=not-a-hash');
    assert.equal(validateInitData(malformed, BOT_TOKEN, NOW_MS), null);
    assert.equal(validateInitData('a'.repeat(16 * 1024 + 1), BOT_TOKEN, NOW_MS), null);
});

test('enforces a configured allowlist and denies all users when it is explicitly empty', () => {
    const allowlist = parseUserIdSet('123456789,987654321', 'MAX_ALLOWED_USER_IDS');
    assert.equal(isUserAllowed('123456789', true, allowlist), true);
    assert.equal(isUserAllowed('111111111', true, allowlist), false);
    assert.equal(isUserAllowed('111111111', true, new Set()), false);
    assert.equal(isUserAllowed('111111111', false, new Set()), true);
});

test('rejects malformed allowlist entries instead of silently disabling the allowlist', () => {
    assert.throws(() => parseUserIdSet('123456789,not-a-user', 'MAX_ALLOWED_USER_IDS'));
});
