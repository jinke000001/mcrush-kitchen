/** Original McRush miniature kit. Geometry, palette and articulation authored
 * here; no source-game mesh, texture, skeleton or animation is consumed. */
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(value => { this.result = value; this.onloadend?.(); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then(value => { this.result = 'data:application/octet-stream;base64,' + Buffer.from(value).toString('base64'); this.onloadend?.(); }); }
};
const OUT = 'public/assets/original';
await mkdir(OUT + '/models', { recursive: true });
await mkdir(OUT + '/icons', { recursive: true });
const palette = {
  cream: 0xffe9bd, porcelain: 0xfdf5e1, red: 0xc94936, redDark: 0x922e2e,
  gold: 0xf1bc47, steel: 0x91a5a2, silver: 0xd1dbd1, charcoal: 0x263c43,
  wood: 0xba8357, tan: 0xd49e69, bun: 0xe8a64c, toast: 0xc67a32,
  patty: 0x74422c, raw: 0xc96867, green: 0x72a56c, cheese: 0xffc94c,
  skin: 0xf1b58b, hair: 0x413b36, blue: 0x398cb3, mint: 0x479686,
};
const materials = new Map();
function mat(color, metalness = 0, roughness = .72) {
  color = palette[color] ?? color;
  const key = `${color}:${metalness}:${roughness}`;
  if (!materials.has(key)) { const m = new T.MeshStandardMaterial({ color, metalness, roughness }); m.name = key; materials.set(key, m); }
  return materials.get(key);
}
function mesh(g, geometry, color, x=0,y=0,z=0) {
  const m = new T.Mesh(geometry, typeof color === 'object' ? color : mat(color)); m.position.set(x,y,z); g.add(m); return m;
}
const box=(g,w,h,d,c,x=0,y=0,z=0,r=.035)=>mesh(g,new RoundedBoxGeometry(w,h,d,1,Math.min(r,w/3,h/3,d/3)),c,x,y,z);
const ball=(g,x,y,z,sx,sy,sz,c)=>{const m=mesh(g,new T.SphereGeometry(1,16,10),c,x,y,z);m.scale.set(sx,sy,sz);return m;};
const cylinder=(g,rt,rb,h,c,x=0,y=0,z=0,n=20)=>mesh(g,new T.CylinderGeometry(rt,rb,h,n),c,x,y,z);
const group=()=>new T.Group();
function badge(g,x,y,z,color='gold',scale=1) {
  for(const side of [-1,1]) { const b=box(g,.025*scale,.13*scale,.012*scale,color,x+side*.032*scale,y,z,.005); b.rotation.z=side*.28; }
}
function cabinet(kind='counter') {
  const g=group();
  box(g,.91,.65,.91,'cream',0,.355,0);
  box(g,.95,.08,.95,mat('charcoal',.05),0,.07,0,.02);
  box(g,1,.10,1,mat('silver',.45,.4),0,.73,0,.045);
  box(g,.84,.48,.023,kind==='serve'?'red':'porcelain',0,.39,.468,.025);
  box(g,.42,.025,.045,mat('steel',.55),0,.59,.49,.008);
  box(g,.01,.43,.015,'cream',0,.35,.483,.003);
  if(kind==='serve') {box(g,.91,.045,.12,'gold',0,.785,.38,.01);badge(g,0,.39,.487,'gold',2);}
  return g;
}
function equipment(kind) {
  const g=cabinet();
  if(kind==='griddle') {
    box(g,.91,.06,.85,'charcoal',0,.81,0,.02);
    for(let i=0;i<9;i++)box(g,.025,.016,.74,mat('steel',.4),-.36+i*.09,.849,0,.004);
    box(g,.94,.22,.08,mat('steel',.5),0,.91,-.42,.02);
    for(const x of [-.26,.26]) {const knob=cylinder(g,.052,.052,.035,'charcoal',x,.64,.502,16);knob.rotation.x=Math.PI/2;box(g,.014,.035,.012,'gold',x,.65,.526,.003);}
    box(g,.16,.035,.012,'red',0,.64,.51,.005);
  } else if(kind==='fryer') {
    box(g,.89,.06,.88,'charcoal',0,.81,0,.02);
    box(g,.71,.018,.66,mat(0xb98326,.12,.25),0,.835,.02,.015);
    for(const x of [-.4,.4])box(g,.07,.07,.88,mat('silver',.6),x,.83,0,.01);
    box(g,.95,.30,.12,mat('steel',.4),0,.94,-.4,.025);
    box(g,.22,.09,.015,'charcoal',-.16,.99,-.333,.01);
    box(g,.13,.04,.018,'green',-.16,.99,-.322,.005);
    const dial=cylinder(g,.055,.055,.03,'charcoal',.19,.97,-.32);dial.rotation.x=Math.PI/2;
  }
  return g;
}
function food(id) {
  const g=group();
  if(id==='bun'||id==='bun-lid'||id==='bun-base') {
    if(id==='bun-base') cylinder(g,.27,.255,.105,'toast',0,.055,0);
    else { ball(g,0,.06,0,.28,.19,.28,'bun'); cylinder(g,.27,.26,.045,'toast',0,.027,0);
      for(let i=0;i<9;i++){const a=i*2.4,r=.07+ (i%3)*.058;const seed=ball(g,Math.cos(a)*r,.195-Math.pow(r,2)*1.5,Math.sin(a)*r,.012,.006,.028,'porcelain'); seed.rotation.y=a;}}
  } else if(id==='patty'||id==='patty-raw'||id==='burnt') {
    cylinder(g,.25,.255,.085,id==='patty-raw'?'raw':id==='burnt'?'charcoal':'patty',0,.045,0,24);
    if(id!=='patty-raw') for(let i=-2;i<=2;i++)box(g,.38-Math.abs(i)*.04,.009,.014,'charcoal',0,.09,i*.075,.003);
    else for(let i=0;i<8;i++)ball(g,Math.sin(i*5)*.17,.09,Math.cos(i*4)*.17,.018,.004,.013,'skin');
  } else if(id==='cheese') {const b=box(g,.5,.028,.49,'cheese',0,.02,0,.018);b.rotation.y=.12;}
  else if(id==='potato') {ball(g,0,.10,0,.17,.14,.24,'tan');for(const p of [[.09,.21,.02],[-.08,.19,.1],[.05,.20,-.13]])ball(g,...p,.014,.005,.012,'wood');}
  else if(id==='potato-cut'||id==='fries') {
    for(let i=0;i<9;i++){const b=box(g,.045,id==='fries'?.27+(i%3)*.045:.06,id==='fries'?.045:.29,'cheese',(i%3-1)*.075,id==='fries'?.17:.04+(Math.floor(i/3)*.035),(Math.floor(i/3)-1)*.07,.01);b.rotation.z=id==='fries'?(i%3-1)*.15:0;b.rotation.y=i*.18;}
  } else if(id.startsWith('chicken')||id==='nuggets') {
    const cooked=id==='nuggets',cut=id!=='chicken-raw';
    for(let i=0;i<(cut?5:1);i++) { const b=ball(g,cut?(i%3-1)*.13:0,.07,cut?(Math.floor(i/3)-.5)*.13:0,cut?.105:.23,.065,cut?.075:.13,cooked?'bun':'skin'); b.rotation.y=i*.7; }
  } else if(id==='cup'||id==='cola') {
    cylinder(g,.17,.13,.43,'porcelain',0,.22,0); cylinder(g,.172,.172,.19,'red',0,.23,0);
    badge(g,0,.23,.177,'gold',.9);
    cylinder(g,.155,.155,.015,id==='cola'?'porcelain':'charcoal',0,.443,0);
    if(id==='cola') {const straw=cylinder(g,.012,.012,.28,'red',.04,.54,.02,8);straw.rotation.z=-.16;cylinder(g,.18,.18,.025,'porcelain',0,.458,0);}
  } else if(id==='tray') {
    box(g,.86,.035,.7,'cream',0,.025,0,.03);
    for(const x of [-.42,.42])box(g,.035,.07,.7,'red',x,.045,0,.015);
    for(const z of [-.34,.34])box(g,.86,.07,.035,'red',0,.045,z,.015);
    for(let i=-2;i<=2;i++)box(g,.012,.003,.57,0xe5d3ac,i*.13,.046,0,.002);
  }
  return g;
}
function chef(id) {
  const g=group(), color=id==='player'?'blue':id==='a'?'red':'mint';
  const skin=id==='b'?0xc28a62:'skin';
  const torso=group();torso.name='torso';g.add(torso);
  box(torso,.49,.48,.31,color,0,.63,0,.12);
  box(torso,.36,.32,.025,'cream',0,.57,.17,.06);
  badge(torso,0,.59,.19,'red',1.0);
  box(torso,.12,.07,.02,color,.10,.47,.19,.01);
  for(const sign of [-1,1]) {const strap=box(torso,.04,.26,.02,'cream',sign*.14,.76,.16,.01);strap.rotation.z=sign*.1;}
  const head=group();head.name='head';head.position.y=.99;g.add(head);
  ball(head,0,.04,0,.24,.255,.215,skin);
  for(const x of [-.235,.235])ball(head,x,.015,0,.044,.069,.052,skin);
  ball(head,0,.01,.216,.043,.038,.037,skin);
  for(const x of [-.085,.085]) {ball(head,x,.065,.205,.018,.027,.014,'hair');box(head,.05,.012,.018,'hair',x,.12,.19,.005);}
  const smile=mesh(head,new T.TorusGeometry(.048,.009,4,14,Math.PI),'hair',0,-.065,.205);smile.rotation.z=Math.PI;
  if(id==='player') {
    ball(head,0,.21,-.01,.247,.13,.23,'hair');
    box(head,.49,.075,.43,'blue',0,.19,.015,.03);
    box(head,.43,.03,.22,'blue',0,.16,.26,.04);
    badge(head,0,.20,.24,'cream',.7);
  } else if(id==='a') {
    box(head,.45,.09,.4,'porcelain',0,.26,0,.03);
    for(let i=0;i<3;i++)ball(head,(i-1)*.12,.36,0,.13,.14,.19,'porcelain');
    for(const x of [-.09,.09]) { const lens=mesh(head,new T.TorusGeometry(.064,.009,5,18),'charcoal',x,.063,.216);lens.scale.y=.8; }
    box(head,.06,.012,.012,'charcoal',0,.06,.22,.004);
    ball(head,0,-.025,.221,.055,.015,.014,'hair');
  } else {
    for(let i=0;i<7;i++)ball(head,Math.cos(i*.9)*.19,.2+Math.sin(i*.9)*.065,-.04+Math.sin(i*2)*.08,.105,.095,.12,'hair');
    ball(head,0,.29,-.12,.13,.12,.13,'hair');
    box(head,.48,.07,.39,'mint',0,.19,.02,.03);
    const knot=box(head,.09,.13,.06,'mint',.25,.17,-.09,.02);knot.rotation.z=.6;
  }
  for(const [side,sign] of [['left',-1],['right',1]]) {
    const arm=group();arm.name=side+'Arm';arm.position.set(sign*.28,.79,0);g.add(arm);
    box(arm,.16,.19,.20,color,0,-.065,0,.065);ball(arm,0,-.21,0,.085,.12,.075,skin);
    ball(arm,0,-.30,.015,.092,.092,.084,skin);
    const leg=group();leg.name=side+'Leg';leg.position.set(sign*.13,.43,0);g.add(leg);
    box(leg,.17,.24,.20,'charcoal',0,-.09,0,.05);box(leg,.19,.10,.27,'charcoal',0,-.235,.035,.04);
    box(leg,.19,.022,.27,'cream',0,-.276,.036,.007);
  }
  const grip=group();grip.name='grip';grip.position.set(0,.65,.38);g.add(grip);
  g.userData.original='McRush miniature crew v1';
  return g;
}
function prop(id) {
  if(id==='counter'||id==='counter-flat'||id==='serve') return cabinet(id);
  if(id==='griddle'||id==='fryer')return equipment(id);
  if(id.startsWith('chef-'))return chef(id.slice(5));
  const g=group();
  if(id==='bin') {box(g,.64,.67,.64,'mint',0,.35,0,.09);box(g,.68,.08,.68,'charcoal',0,.72,0,.04);box(g,.42,.02,.35,'charcoal',0,.77,0,.04);box(g,.3,.12,.02,'cream',0,.43,.33,.02);}
  else if(id==='crate') {box(g,.8,.05,.7,'cream',0,.03,0);for(const x of [-.38,.38])box(g,.045,.24,.7,'wood',x,.12,0);for(const z of [-.33,.33])box(g,.8,.20,.045,'tan',0,.11,z);}
  else if(id==='board') {box(g,.74,.05,.65,'wood',0,.03,0,.05);box(g,.68,.008,.59,'tan',0,.058,0,.04);for(let i=0;i<4;i++)box(g,.55,.002,.006,'wood',0,.064,(i-1.5)*.12,.002);}
  else if(id==='pan') {box(g,.85,.025,.81,'charcoal',0,.015,0,.04);}
  else if(id==='fryer-basket') {for(const x of [-.32,.32])box(g,.025,.11,.65,mat('silver',.65),x,.06,0,.006);for(let i=0;i<7;i++)box(g,.64,.015,.012,'steel',0,.02,(i-3)*.1,.003);box(g,.08,.07,.3,'charcoal',0,.09,.43,.02);}
  else if(id==='drink-machine') {
    box(g,.62,.68,.39,'red',0,.48,-.08,.06);box(g,.58,.24,.03,'charcoal',0,.66,.13,.025);
    for(let i=0;i<3;i++) {cylinder(g,.042,.042,.10,'silver',(i-1)*.16,.34,.15,12);box(g,.06,.07,.016,['gold','porcelain','mint'][i],(i-1)*.16,.64,.15,.008);}
    box(g,.65,.06,.64,'charcoal',0,.06,.03,.025);box(g,.55,.015,.38,'steel',0,.10,.14,.01);
    badge(g,0,.80,.132,'gold',1);
  } else if(id==='plate')cylinder(g,.34,.31,.04,'porcelain',0,.025,0);
  else return food(id);
  return g;
}
function batch(g) {
  // Merge within each rigid joint only; character articulation stays independent.
  for(const child of [...g.children])if(child.isGroup)batch(child);
  const byMaterial=new Map();
  for(const child of [...g.children])if(child.isMesh) {
    child.updateMatrix();let geo=child.geometry.clone().applyMatrix4(child.matrix);if(geo.index)geo=geo.toNonIndexed();
    const list=byMaterial.get(child.material)??[];list.push(geo);byMaterial.set(child.material,list);g.remove(child);
  }
  for(const [material,geometries]of byMaterial)g.add(new T.Mesh(mergeGeometries(geometries),material));
}
const names=['counter','counter-flat','griddle','pan','fryer','fryer-basket','board','serve','bin','crate','plate','tray','drink-machine','bun','bun-base','bun-lid','patty-raw','patty','burnt','cheese','potato','potato-cut','chicken-raw','chicken-cut','fries','nuggets','cup','cola','chef-player','chef-a','chef-b'];
const manifest={version:2,collection:'McRush original miniature kitchen',units:'metres / one tile',license:'MIT (original code and generated geometry); brand names are not licensed by this manifest',generator:'scripts/make-original-assets.mjs',assets:{}};
for(const id of names) {
  const g=prop(id);g.name=id;batch(g);g.updateMatrixWorld(true);
  const bounds=new T.Box3().setFromObject(g);
  const glb=await new GLTFExporter().parseAsync(g,{binary:true,onlyVisible:false});
  const bytes=Buffer.from(glb);await writeFile(`${OUT}/models/${id}.glb`,bytes);
  manifest.assets[id]={url:`/assets/original/models/${id}.glb`,name:id,kind:id.startsWith('chef')?'character':'prop',bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),source:'Original parametric geometry, authored for McRush',license:'MIT',...(id.startsWith('chef')?{grip:{node:'grip',position:[0,.65,.38]},rig:{leftArm:'leftArm',rightArm:'rightArm',leftLeg:'leftLeg',rightLeg:'rightLeg',head:'head',torso:'torso'},animations:['idle','walk','carry','dash','chop','pour','acknowledge']}:{} )};
}
await writeFile(OUT+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');
// Authored offline vector icons: no GPU readbacks or image downloads at startup.
const shadow='<ellipse cx="48" cy="79" rx="32" ry="6" fill="#74482c" opacity=".13"/>';
const bun='<path d="M17 47 Q19 19 48 19 Q77 19 79 47Z" fill="#e8ad51" stroke="#b47731" stroke-width="2"/><g fill="#fff2ca"><ellipse cx="35" cy="31" rx="2" ry="4" transform="rotate(30 35 31)"/><ellipse cx="55" cy="29" rx="2" ry="4"/><ellipse cx="66" cy="39" rx="2" ry="4" transform="rotate(-30 66 39)"/></g>';
const base='<path d="M17 63 H79 Q77 79 62 79 H34 Q19 79 17 63" fill="#e8ad51" stroke="#b47731" stroke-width="2"/>';
const burger=cheese=>base+'<rect x="17" y="52" width="62" height="14" rx="7" fill="#79462e"/>'+(cheese?'<path d="M17 50 L73 48 L80 55 L64 65 L44 56 L25 61Z" fill="#ffc943"/>':'')+bun;
const cup=full=>'<path d="M26 25 H70 L64 78 H32Z" fill="#fff5da" stroke="#bb9b71" stroke-width="2"/><path d="M29 40 H67 L65 63 H31Z" fill="#c94936"/><path d="M40 56 L43 46 L48 54 L53 46 L56 56" fill="none" stroke="#ffcf57" stroke-width="3"/>'+(full?'<rect x="24" y="22" width="48" height="6" rx="3" fill="#fff7e9"/><path d="M52 24 L56 10" stroke="#c94936" stroke-width="4"/>':'<ellipse cx="48" cy="25" rx="22" ry="5" fill="#8c7056"/>');
const fries='<g fill="#f3c14c" stroke="#c98a2c" stroke-width="1.5">'+[0,1,2,3,4].map(i=>`<rect x="${27+i*8}" y="${19+i%3*5}" width="7" height="42" rx="2" transform="rotate(${(i-2)*4} ${30+i*8} 62)"/>`).join('')+'</g><path d="M23 44 Q48 54 73 44 L67 78 H29Z" fill="#c94936"/><path d="M38 68 L42 57 L48 65 L54 57 L58 68" fill="none" stroke="#ffcf57" stroke-width="3"/>';
const nuggets='<path d="M16 48 L79 48 L73 78 H23Z" fill="#c94936"/><path d="M16 48 L22 27 L76 27 L79 48Z" fill="#ffebc7"/>'+[0,1,2,3,4].map(i=>`<ellipse cx="${28+i%3*19}" cy="${46+Math.floor(i/3)*12}" rx="12" ry="9" fill="#dea348" stroke="#bd7d2a" stroke-width="2"/>`).join('');
const raw=(color)=>`<ellipse cx="48" cy="54" rx="31" ry="17" fill="${color}"/><ellipse cx="48" cy="49" rx="31" ry="15" fill="${color}" stroke="#805344" stroke-width="2"/>`;
const icons={burger:burger(false),cheeseburger:burger(true),assembly:burger(false),cola:cup(true),cup:cup(false),fries,nuggets,bun:base+bun,rawPatty:raw('#ce7774'),patty:raw('#895039')+'<path d="M27 43 L59 55 M36 39 L68 51" stroke="#57382b" stroke-width="3"/>',burnt:raw('#343a3a'),cheese:'<path d="M14 48 L52 28 L81 47 L46 72Z" fill="#ffce4e" stroke="#c19130" stroke-width="2"/>',potato:'<ellipse cx="48" cy="51" rx="22" ry="30" fill="#cc995e" stroke="#a4713d" stroke-width="2" transform="rotate(-28 48 51)"/><g fill="#a4713d"><circle cx="43" cy="40" r="2"/><circle cx="54" cy="63" r="2"/><circle cx="58" cy="46" r="2"/></g>',cutPotato:'<g fill="#f7dda4" stroke="#c9ae77" stroke-width="2" transform="rotate(-22 48 48)">'+[0,1,2,3,4].map(i=>`<rect x="${23+i*10}" y="${27+i%2*9}" width="8" height="43" rx="2"/>`).join('')+'</g>',rawChicken:'<path d="M22 65 C8 53 23 22 43 26 C57 13 79 34 74 52 C88 70 46 81 22 65Z" fill="#efb48e" stroke="#b77d66" stroke-width="2"/>',cutChicken:'<g fill="#efb48e" stroke="#b77d66" stroke-width="2">'+[0,1,2,3,4,5].map(i=>`<rect x="${17+i%3*22}" y="${28+Math.floor(i/3)*25}" width="18" height="19" rx="5"/>`).join('')+'</g>',tray:'<path d="M12 37 L70 28 L86 68 L22 80Z" fill="#c94936" stroke="#9e3e2f" stroke-width="2"/><path d="M17 39 L67 32 L80 65 L25 74Z" fill="#fff0cf"/>'};
for(const [id,content]of Object.entries(icons))await writeFile(`${OUT}/icons/${id}.svg`,`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">${shadow}${content}</svg>\n`);
console.log(JSON.stringify({models:names.length,bytes:Object.values(manifest.assets).reduce((n,a)=>n+a.bytes,0),icons:Object.keys(icons).length}));
