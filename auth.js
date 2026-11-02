const crypto = require('crypto');

const BOT_TOKEN = process.env.BOT_TOKEN || '';

function sanitizeUserId(rawId) {
    if (!rawId || typeof rawId !== 'string') return 'user_local';
    const cleaned = rawId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    return cleaned.length > 0 ? cleaned : 'user_local';
}

function validateInitData(initData, token) {
    if (!initData || typeof initData !== 'string' || !token) return null;
    try {
        const params = new URLSearchParams(initData);
        const hash = params.get('hash');
        if (!hash) return null;
        params.delete('hash');

        const pairs = [];
        for (const [key, val] of params.entries()) {
            pairs.push(`${key}=${val}`);
        }
        pairs.sort();
        const dataCheckString = pairs.join('\n');

        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
        const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

        if (calculatedHash.length !== hash.length) return null;
        const valid = crypto.timingSafeEqual(Buffer.from(calculatedHash, 'utf-8'), Buffer.from(hash, 'utf-8'));
        if (!valid) return null;

        const userStr = params.get('user');
        if (!userStr) return null;
        const user = JSON.parse(userStr);
        return user && user.id ? String(user.id) : null;
    } catch (e) {
        return null;
    }
}

function authMiddleware(req, res, next) {
    const rawInitData = req.headers['x-webapp-init-data'];
    if (rawInitData && BOT_TOKEN) {
        const validatedUserId = validateInitData(rawInitData, BOT_TOKEN);
        if (validatedUserId) {
            req.userId = sanitizeUserId(validatedUserId);
            return next();
        } else {
            return res.status(401).json({ error: 'Invalid WebApp authentication hash' });
        }
    }

    if (rawInitData && !BOT_TOKEN) {
        const validatedUserId = validateInitData(rawInitData, 'DEV_DUMMY_TOKEN');
        if (validatedUserId) {
            req.userId = sanitizeUserId(validatedUserId);
            return next();
        }
    }

    req.userId = sanitizeUserId(req.headers['x-user-id']);
    next();
}

module.exports = {
    BOT_TOKEN,
    authMiddleware,
    sanitizeUserId
};
