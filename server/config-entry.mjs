import {configuredPublicConfig} from './public-config.mjs';
const handle=configuredPublicConfig({env:process.env});
export default {fetch:request=>handle(request)};
