import {configuredSyncRoute} from './sync-route.mjs';
// Bundling retains runtime env lookups; keys must never be inserted into source/assets.
const handle=configuredSyncRoute({env:process.env});
export default {fetch:request=>handle(request)};
