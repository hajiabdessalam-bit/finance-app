import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
const root=fileURLToPath(new URL('../',import.meta.url));
await mkdir(new URL('../app/react/',import.meta.url),{recursive:true});
await build({absWorkingDir:root,entryPoints:['frontend/main.tsx'],outfile:'app/react/main.js',bundle:true,format:'esm',platform:'browser',target:['es2022'],minify:true,sourcemap:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
const privateBuild=await build({absWorkingDir:root,entryPoints:['frontend/native-private.mjs'],outfile:'app/private-main.js',bundle:true,format:'esm',platform:'browser',target:['es2022'],minify:true,sourcemap:false,metafile:true});
const privatePackages=[...new Set(Object.keys(privateBuild.metafile.inputs).map(path=>path.match(/^node_modules\/(?:@[^/]+\/)?[^/]+/)?.[0]).filter(Boolean))];
const privateLicenses=await Promise.all(privatePackages.map(async path=>{
  for(const file of ['LICENSE','LICENSE.md','LICENSE.txt'])try{return `${path.slice(13)}\n${await readFile(new URL(`../${path}/${file}`,import.meta.url),'utf8')}`;}catch{}
  throw new Error(`Missing public bundle license for ${path}`);
}));
await writeFile(new URL('../app/private-LICENSES.txt',import.meta.url),privateLicenses.join('\n\n'));
const licenses=await Promise.all(['react','react-dom'].map(async name=>`${name}\n${await readFile(new URL(`../node_modules/${name}/LICENSE`,import.meta.url),'utf8')}`));
await writeFile(new URL('../app/react/LICENSES.txt',import.meta.url),licenses.join('\n\n'));
await import('./build-shell.mjs');
console.log('Built native and React entries with matching, immutable public assets.');
