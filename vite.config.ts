import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
/** Explicit build allowlist: private reference assets are never copied to dist. */
function originalPublicAssets():Plugin {
  return {name:'original-public-assets',apply:'build',async generateBundle(){
    const emit=async(relative:string)=>{
      for(const entry of await readdir(path.join('public',relative),{withFileTypes:true})) {
        if(entry.name.startsWith('.'))continue;
        const file=path.posix.join(relative,entry.name);
        if(entry.isDirectory())await emit(file);
        else if(entry.isFile())this.emitFile({type:'asset',fileName:file,source:await readFile(path.join('public',file))});
      }
    };
    for(const dir of ['assets/original','audio','challenges'])await emit(dir);
    for(const file of ['LICENSE','THIRD_PARTY_NOTICES.md'])this.emitFile({type:'asset',fileName:file,source:await readFile(file)});
  }};
}
export default defineConfig(({command})=>({
  plugins:[react(),originalPublicAssets()],
  publicDir:command==='build'?false:'public',
  server:{port:5173,strictPort:true},
  build:{rollupOptions:{output:{manualChunks:(id:string)=>id.includes('/node_modules/three/')?'three':/node_modules\/(react|react-dom|scheduler)\//.test(id)?'react':undefined}}},
}));
