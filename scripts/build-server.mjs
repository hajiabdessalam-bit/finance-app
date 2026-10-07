import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
for(const name of ['sync','advisor','config'])await build({entryPoints:[fileURLToPath(new URL('../server/'+name+'-entry.mjs',import.meta.url))],outfile:fileURLToPath(new URL('../app/api/plan/'+name+'.mjs',import.meta.url)),bundle:true,format:'esm',platform:'node',target:'node22',sourcemap:false,minify:false,legalComments:'none'});
console.log('Built private sync and closed advisor functions; no credentials included.');
