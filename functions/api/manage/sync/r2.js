import { importR2Page } from '../../../utils/storage/r2Import.js';
import { batchAddFilesToIndex, mergeOperationsToIndex } from '../../../utils/indexManager.js';

const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
};

function response(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers });
}

/**
 * Import an existing R2 bucket one page at a time. Pass the returned cursor to
 * the next request; the last page is merged into the visible file index.
 */
export async function onRequestPost(context) {
    try {
        const body = await context.request.json().catch(() => ({}));
        const result = await importR2Page(context, body);

        if (result.importedFiles.length) {
            await batchAddFilesToIndex(context, result.importedFiles, { skipExisting: !body.overwrite });
        }

        // Make every completed page visible immediately. This also allows a
        // caller to stop and resume a large import without losing indexed data.
        await mergeOperationsToIndex(context);

        return response({
            success: true,
            scanned: result.scanned,
            imported: result.imported,
            skipped: result.skipped,
            truncated: result.truncated,
            cursor: result.cursor
        });
    } catch (error) {
        console.error('Failed to synchronize R2 objects:', error);
        const status = error instanceof SyntaxError ? 400 : 500;
        return response({ success: false, error: error.message }, status);
    }
}

export async function onRequest(context) {
    if (context.request.method === 'POST') return onRequestPost(context);
    return response({ success: false, error: 'Method not allowed' }, 405);
}
