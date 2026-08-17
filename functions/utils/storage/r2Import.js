import { getDatabase } from '../databaseAdapter.js';

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 1000;

const MIME_TYPES = {
    avif: 'image/avif', gif: 'image/gif', jpeg: 'image/jpeg', jpg: 'image/jpeg',
    png: 'image/png', svg: 'image/svg+xml', webp: 'image/webp',
    mp4: 'video/mp4', webm: 'video/webm', pdf: 'application/pdf',
    txt: 'text/plain', json: 'application/json', zip: 'application/zip'
};

function fileNameFromKey(key) {
    const parts = key.split('/');
    return parts[parts.length - 1] || key;
}

function directoryFromKey(key) {
    const slash = key.lastIndexOf('/');
    return slash === -1 ? '' : key.slice(0, slash + 1);
}

function inferContentType(key, object) {
    if (object.httpMetadata?.contentType) return object.httpMetadata.contentType;
    const extension = fileNameFromKey(key).split('.').pop()?.toLowerCase();
    return MIME_TYPES[extension] || 'application/octet-stream';
}

/** Build ImgBed metadata from the information returned by R2.list(). */
export function createR2Metadata(object, channelName = 'R2_env') {
    const uploaded = object.uploaded instanceof Date ? object.uploaded : new Date(object.uploaded || Date.now());
    const size = Number(object.size) || 0;

    return {
        FileName: fileNameFromKey(object.key),
        FileType: inferContentType(object.key, object),
        FileSize: (size / 1024 / 1024).toFixed(2),
        FileSizeBytes: size,
        UploadIP: '',
        UploadAddress: '',
        ListType: 'None',
        TimeStamp: Number.isNaN(uploaded.getTime()) ? Date.now() : uploaded.getTime(),
        Label: 'None',
        Directory: directoryFromKey(object.key),
        Tags: [],
        Channel: 'CloudflareR2',
        ChannelName: channelName
    };
}

/**
 * Import one R2 listing page into the metadata database.
 * Existing records are preserved unless overwrite is explicitly enabled.
 */
export async function importR2Page(context, options = {}) {
    const { env } = context;
    if (!env.img_r2 || typeof env.img_r2.list !== 'function') {
        throw new Error('R2 binding img_r2 is not configured');
    }

    const db = getDatabase(env);
    if (!db) throw new Error('Metadata database is not configured');

    const requestedLimit = Number(options.limit) || DEFAULT_LIMIT;
    const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(requestedLimit)));
    const listOptions = { limit };
    if (options.cursor) listOptions.cursor = options.cursor;
    if (options.prefix) listOptions.prefix = options.prefix;

    const page = await env.img_r2.list(listOptions);
    const importedFiles = [];
    let skipped = 0;

    for (const object of page.objects || []) {
        if (!options.overwrite) {
            const existing = await db.getWithMetadata(object.key);
            if (existing) {
                skipped++;
                continue;
            }
        }

        const metadata = createR2Metadata(object, options.channelName || 'R2_env');
        await db.put(object.key, '', { metadata });
        importedFiles.push({ fileId: object.key, metadata });
    }

    return {
        importedFiles,
        scanned: (page.objects || []).length,
        imported: importedFiles.length,
        skipped,
        truncated: Boolean(page.truncated),
        cursor: page.truncated ? page.cursor : null
    };
}
