import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import validator from 'gltf-validator';
const manifest=JSON.parse(await readFile('public/assets/original/manifest.json','utf8'));
const results=[];
for(const [id,asset]of Object.entries(manifest.assets)) {
  if(!asset.url.startsWith('/assets/original/models/')||!asset.source||!asset.license)throw Error('Missing original provenance: '+id);
  const bytes=await readFile('public'+asset.url);
  if(createHash('sha256').update(bytes).digest('hex')!==asset.sha256)throw Error('Asset identity changed: '+id);
  const report=await validator.validateBytes(new Uint8Array(bytes),{uri:asset.url,maxIssues:100});
  results.push({id,bytes:bytes.length,errors:report.issues.numErrors,warnings:report.issues.numWarnings,messages:report.issues.messages});
}
await mkdir('output/asset-check',{recursive:true});
await writeFile('output/asset-check/original-validation.json',JSON.stringify({validator:validator.version(),results},null,2));
console.log(JSON.stringify({models:results.length,bytes:results.reduce((n,r)=>n+r.bytes,0),errors:results.reduce((n,r)=>n+r.errors,0),warnings:results.reduce((n,r)=>n+r.warnings,0)}));
if(results.some(r=>r.errors))process.exitCode=1;
