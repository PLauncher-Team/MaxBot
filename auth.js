const crypto = require('crypto');
const fs = require('fs');

const tokenFile = process.env.BOT_TOKEN_FILE;
const BOT_TOKEN = process.env.BOT_TOKEN || (tokenFile && fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, 'utf8').trim() : '');
const DEFAULT_INIT_DATA_TTL_SECONDS = 24 * 60 * 60;
const MAX_FUTURE_CLOCK_SKEW_SECONDS = 60;
const MAX_INIT_DATA_LENGTH = 16 * 1024;
const API_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const API_RATE_LIMIT_MAX_REQUESTS = 300;
const apiRateLimitBuckets = new Map();
const uploadRateLimitBuckets = new Map();
const reminderWriteRateLimitBuckets = new Map();

function parsePositiveInteger(value, fallback) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const INIT_DATA_TTL_SECONDS = parsePositiveInteger(
    process.env.MAX_INIT_DATA_TTL_SECONDS,
    DEFAULT_INIT_DATA_TTL_SECONDS
);

function parseUserIdSet(value, variableName) {
    const raw = String(value ?? '');
    if (!raw.trim()) return new Set();

    const values = raw.split(',').map(id => id.trim());
    if (values.some(id => !/^[0-9]{1,32}$/.test(id) || /^0+$/.test(id))) {
        throw new Error(variableName + ' must contain comma-separated numeric MAX user IDs');
    }

    return new Set(values);
}

const ALLOWLIST_ENABLED = Object.prototype.hasOwnProperty.call(process.env, 'MAX_ALLOWED_USER_IDS');
const ALLOWED_USER_IDS = parseUserIdSet(process.env.MAX_ALLOWED_USER_IDS, 'MAX_ALLOWED_USER_IDS');
const BLOCKED_USER_IDS = parseUserIdSet(process.env.MAX_BLOCKED_USER_IDS, 'MAX_BLOCKED_USER_IDS');

function isUserAllowed(userId, allowlistEnabled = ALLOWLIST_ENABLED, allowedUserIds = ALLOWED_USER_IDS) {
    return !allowlistEnabled || allowedUserIds.has(String(userId));
}

function validateInitData(initData, token, nowMs = Date.now()) {
    if (
        typeof initData !== 'string' ||
        initData.length === 0 ||
        initData.length > MAX_INIT_DATA_LENGTH ||
        typeof token !== 'string' ||
        token.length === 0
    ) {
        return null;
    }

    try {
        const params = new URLSearchParams(initData);
        const entries = [...params.entries()];
        if (entries.length < 3) return null;

        const seenKeys = new Set();
        for (const [key] of entries) {
            if (!key || seenKeys.has(key)) return null;
            seenKeys.add(key);
        }

        const hashes = params.getAll('hash');
        const authDates = params.getAll('auth_date');
        const users = params.getAll('user');
        if (hashes.length !== 1 || authDates.length !== 1 || users.length !== 1) return null;

        const receivedHash = hashes[0];
        if (!/^[a-f0-9]{64}$/i.test(receivedHash)) return null;

        const authDate = Number(authDates[0]);
        if (!Number.isSafeInteger(authDate) || authDate <= 0) return null;

        const nowSeconds = Math.floor(nowMs / 1000);
        const ageSeconds = nowSeconds - authDate;
        if (ageSeconds > INIT_DATA_TTL_SECONDS || ageSeconds < -MAX_FUTURE_CLOCK_SKEW_SECONDS) return null;

        const user = JSON.parse(users[0]);
        if (!user || typeof user !== 'object' || Array.isArray(user) || user.id === undefined || user.id === null) return null;

        const userId = String(user.id);
        if (!/^[0-9]{1,32}$/.test(userId) || /^0+$/.test(userId)) return null;

        const dataCheckString = entries
            .filter(([key]) => key !== 'hash')
            .sort(([leftKey], [rightKey]) => leftKey < rightKey ? -1 : (leftKey > rightKey ? 1 : 0))
            .map(([key, value]) => `${key}=${value}`)
            .join('\n');

        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
        const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest();
        const suppliedHash = Buffer.from(receivedHash, 'hex');

        if (suppliedHash.length !== calculatedHash.length || !crypto.timingSafeEqual(calculatedHash, suppliedHash)) {
            return null;
        }

        return userId;
    } catch (error) {
        return null;
    }
}

function getMaxUserProfileFromInitData(initData, token, nowMs = Date.now()) {
    const userId = validateInitData(initData, token, nowMs);
    if (!userId) return null;

    try {
        const params = new URLSearchParams(initData);
        const user = JSON.parse(params.get('user'));
        if (!user || String(user.id) !== userId) return null;

        const cleanValue = value => typeof value === 'string'
            ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80)
            : '';
        const firstName = cleanValue(user.first_name);
        const lastName = cleanValue(user.last_name);
        const username = cleanValue(user.username);
        const name = [firstName, lastName].filter(Boolean).join(' ') || username;

        return { id: userId, name };
    } catch (error) {
        return null;
    }
}

function authMiddleware(req, res, next) {
    if (!BOT_TOKEN) {
        return res.status(503).json({ error: 'API authentication is not configured' });
    }

    const rawInitData = req.get('X-Webapp-Init-Data');
    if (!rawInitData) {
        return res.status(401).json({ error: 'MAX authentication data is required' });
    }

    const userProfile = getMaxUserProfileFromInitData(rawInitData, BOT_TOKEN);
    if (!userProfile) {
        return res.status(401).json({ error: 'MAX authentication data is invalid or expired' });
    }
    const userId = userProfile.id;

    if (BLOCKED_USER_IDS.has(userId)) {
        return res.status(403).json({ error: 'Access is disabled for this account' });
    }

    if (!isUserAllowed(userId)) {
        return res.status(403).json({ error: 'This account is not on the access list' });
    }

    req.userId = userId;
    req.userName = userProfile.name;
    next();
}

function recipientAuthMiddleware(req, res, next) {
    if (!BOT_TOKEN) {
        return res.status(503).json({ error: 'API authentication is not configured' });
    }

    const rawInitData = req.get('X-Webapp-Init-Data');
    if (!rawInitData) {
        return res.status(401).json({ error: 'MAX authentication data is required' });
    }

    const userId = validateInitData(rawInitData, BOT_TOKEN);
    if (!userId) {
        return res.status(401).json({ error: 'MAX authentication data is invalid or expired' });
    }

    if (BLOCKED_USER_IDS.has(userId)) {
        return res.status(403).json({ error: 'Access is disabled for this account' });
    }

    req.userId = userId;
    next();
}

function createUserRateLimiter(bucketMap, windowMs, maxRequests, message) {
    return function userRateLimit(req, res, next) {
        const now = Date.now();
        const key = req.userId;
        let bucket = bucketMap.get(key);

        if (!bucket || bucket.resetAt <= now) {
            bucket = { count: 0, resetAt: now + windowMs };
            bucketMap.set(key, bucket);
        }

        if (bucket.count >= maxRequests) {
            const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
            res.setHeader('Retry-After', String(retryAfterSeconds));
            return res.status(429).json({ error: message });
        }

        bucket.count += 1;

        if (bucketMap.size > 10000) {
            for (const [userId, entry] of bucketMap) {
                if (entry.resetAt <= now) bucketMap.delete(userId);
            }
        }

        next();
    };
}

const apiRateLimit = createUserRateLimiter(
    apiRateLimitBuckets,
    API_RATE_LIMIT_WINDOW_MS,
    API_RATE_LIMIT_MAX_REQUESTS,
    'Too many requests. Please try again shortly.'
);

const uploadRateLimit = createUserRateLimiter(
    uploadRateLimitBuckets,
    5 * 60 * 1000,
    15,
    'Upload limit reached. Please try again in a few minutes.'
);

const reminderWriteRateLimit = createUserRateLimiter(
    reminderWriteRateLimitBuckets,
    60 * 1000,
    10,
    'Too many reminder changes. Please try again shortly.'
);

module.exports = {
    BOT_TOKEN,
    authMiddleware,
    recipientAuthMiddleware,
    apiRateLimit,
    uploadRateLimit,
    reminderWriteRateLimit,
    validateInitData,
    getMaxUserProfileFromInitData,
    parseUserIdSet,
    isUserAllowed
};
