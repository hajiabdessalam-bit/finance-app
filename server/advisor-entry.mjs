import {configuredAdvisorRoute} from './advisor-route.mjs';
// No live generator is configured. Flags alone cannot enable paid/model traffic.
const handle=await configuredAdvisorRoute({env:process.env});
export default {fetch:request=>handle(request)};
