import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
await build({entryPoints:[fileURLToPath(new URL('../server/sync-entry.mjs',import.meta.url))],outfile:fileURLToPath(new URL('../app/api/plan/sync.mjs',import.meta.url)),bundle:true,format:'esm',platform:'node',target:'node22',sourcemap:false,minify:false,legalComments:'none'});
console.log('Built private sync function with runtime configuration; no credentials included.');
