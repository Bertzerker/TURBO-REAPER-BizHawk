import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
await build({entryPoints:[fileURLToPath(new URL('./renderer.mjs',import.meta.url))],outfile:fileURLToPath(new URL('../public/vendor/note-renderer.mjs',import.meta.url)),bundle:true,format:'esm',platform:'browser',minify:true,legalComments:'linked'});
