const fs = require('fs');
const path = require('path');
const db = require('./db');

const UPLOADS_DIR = path.join(__dirname, 'data', 'uploads');
const UPLOAD_FILENAME_PATTERN = /^(?:img|file|vid)_[a-f0-9]{16,32}\.[a-z0-9]+$/i;
const DAY_MS = 24 * 60 * 60 * 1000;

function safeJsonParse(data, fallback = []) {
    if (!data || typeof data !== 'string') return fallback;
    try {
        return JSON.parse(data);
    } catch (error) {
        return fallback;
    }
}

function getReferencedUploadNames() {
    const referenced = new Set();

    db.prepare('SELECT images FROM reminders').all().forEach(row => {
        const images = safeJsonParse(row.images, []);
        if (!Array.isArray(images)) return;
        images.forEach(item => {
            if (item && typeof item.filename === 'string') referenced.add(item.filename);
        });
    });

    db.prepare('SELECT filename FROM feedback_files').all().forEach(row => {
        if (typeof row.filename === 'string') referenced.add(row.filename);
    });

    return referenced;
}

function cleanupExpiredRecipientDownloadTickets(nowSeconds = Math.floor(Date.now() / 1000)) {
    return db.prepare('DELETE FROM recipient_download_tickets WHERE expires_at <= ?').run(nowSeconds).changes;
}

function removeUploadFile(filename) {
    if (!UPLOAD_FILENAME_PATTERN.test(filename)) return false;

    const filePath = path.join(UPLOADS_DIR, filename);
    try {
        const stat = fs.lstatSync(filePath);
        if (!stat.isFile()) return false;
        fs.unlinkSync(filePath);
        return true;
    } catch (error) {
        if (error.code === 'ENOENT') return true;
        console.error('Failed to remove expired uploaded file:', filename, error.message);
        return false;
    }
}

function cleanupTemporaryUploads(nowMs = Date.now()) {
    const cutoff = new Date(nowMs - DAY_MS).toISOString().slice(0, 19).replace('T', ' ');
    const referenced = getReferencedUploadNames();
    const expiredUploads = db.prepare('SELECT filename FROM uploaded_media WHERE created_at <= ?').all(cutoff);
    const deleteUploadRecord = db.prepare('DELETE FROM uploaded_media WHERE filename = ?');
    let removed = 0;

    expiredUploads.forEach(row => {
        const filename = row.filename;
        if (typeof filename !== 'string' || referenced.has(filename)) return;
        if (!removeUploadFile(filename)) return;
        removed += deleteUploadRecord.run(filename).changes;
    });

    const tracked = new Set(db.prepare('SELECT filename FROM uploaded_media').all().map(row => row.filename));

    try {
        const filenames = fs.readdirSync(UPLOADS_DIR);
        filenames.forEach(filename => {
            if (!UPLOAD_FILENAME_PATTERN.test(filename) || tracked.has(filename) || referenced.has(filename)) return;

            try {
                const stat = fs.lstatSync(path.join(UPLOADS_DIR, filename));
                if (!stat.isFile() || stat.mtimeMs > nowMs - DAY_MS) return;
                if (fs.unlinkSync(path.join(UPLOADS_DIR, filename)) === undefined) removed++;
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    console.error('Failed to remove orphaned uploaded file:', filename, error.message);
                }
            }
        });
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error('Failed to scan uploaded files:', error.message);
        }
    }

    return removed;
}

function runStorageMaintenance() {
    try {
        const expiredTickets = cleanupExpiredRecipientDownloadTickets();
        const removedUploads = cleanupTemporaryUploads();
        if (expiredTickets > 0 || removedUploads > 0) {
            console.info('Storage maintenance completed:', { expiredTickets, removedUploads });
        }
    } catch (error) {
        console.error('Storage maintenance failed:', error);
    }
}

module.exports = {
    runStorageMaintenance,
    cleanupExpiredRecipientDownloadTickets,
    cleanupTemporaryUploads
};
