import { Group, Mesh, SphereGeometry, type Material, type Object3D } from 'three';
import type { LevelDefinition } from '../kitchen/types';
interface Builder {
  box(w:number,h:number,d:number,m:Material,r?:number):Mesh;
  material(c:number,metal?:number,rough?:number):Material;
  sign(text:string,color:string,bg:string,w?:number,h?:number):Mesh;
  track<T extends {dispose():void}>(r:T):T;
}
/** Detail stays beyond work ports, with no invisible colliders or moving obstacles. */
export function buildDecor(root:Object3D,level:LevelDefinition,b:Builder):Group[] {
  const night=level.timeOfDay==='night', cream=b.material(0xffedcf), dark=b.material(0x354d50), red=b.material(0xbc4838), gold=b.material(0xeab346), steel=b.material(0x98aaa7,.35,.5);
  const add=(w:number,h:number,d:number,m:Material,x:number,y:number,z:number,r=.04)=>{const n=b.box(w,h,d,m,r);n.position.set(x,y,z);root.add(n);return n;};
  // A shallow shopfront with mullions, sun shades and a view of the street.
  add(4.8,1.15,.11,dark,10.5,1.92,.16);
  add(4.55,.97,.025,b.material(night?0x30475f:0xb6dcd8,0,.45),10.5,1.94,.225);
  for(const x of [8.28,9.77,11.25,12.73])add(.045,1.12,.06,cream,x,1.92,.255,.008);
  add(4.8,.07,.3,cream,10.5,1.37,.27);add(4.9,.18,.6,red,10.5,2.52,.22);
  for(let i=0;i<6;i++)add(.4,.08,.6,cream,8.47+i*.8,2.44,.22,.005);
  const status=b.sign(night?'OPEN LATE · TAKEAWAY':'FRESH EVERY SHIFT',night?'#f8c558':'#fff2d3','#354d50',768,128);status.scale.set(2.5,.36,1);status.position.set(10.5,1.95,.29);root.add(status);
  // Extractor and prep shelving are at the back and left perimeter.
  add(.85,.20,2.25,steel,.70,2.12,4.8);add(.35,.55,.65,steel,.45,2.45,4.8);
  for(let i=0;i<7;i++)add(.56,.022,.05,dark,.71,2.0,3.99+i*.26,.005);
  add(4.6,.10,.6,b.material(0xb98557),4.6,1.7,.27);add(4.7,.08,.1,gold,4.6,1.76,.56,.01);
  for(let i=0;i<8;i++){const c=[cream,red,dark][i%3];add(.24,.25+(i%2)*.08,.27,c,2.7+i*.52,1.9,.25);add(.26,.03,.28,gold,2.7+i*.52,2.04+(i%2)*.04,.25,.009);}
  for(const x of [3.1,7.7,13.6]) {add(.024,1.0,.024,dark,x,3.0,.9,.005);add(.5,.15,.45,gold,x,2.47,.9,.06);add(.36,.025,.32,cream,x,2.38,.9,.015);}
  // Pickup bays advertise both shape and text, not colour alone.
  for(const s of level.stations.filter(s=>s.kind==='serve')) {
    const x=s.x+.5,z=s.y+1.15,color=s.channel==='takeaway'?dark:red;
    add(1.6,.05,.6,color,x,.08,z+.2);
    const text=s.channel==='dine-in'?'○ 堂食':s.channel==='takeaway'?'□ 外带':'取餐 PICK UP';
    const sign=b.sign(text,'#fff3cf',s.channel==='takeaway'?'#354d50':'#bc4838',512,128);sign.scale.set(1.4,.35,1);sign.position.set(x,.58,z+.33);root.add(sign);
  }
  // A narrow customer promenade, outside the playable map.
  add(16.3,.12,1.3,b.material(night?0x4b5c64:0xb9ae91),8,-.18,11.4,.04);
  for(const x of [2,14]) {
    add(.55,.5,.55,red,x,.1,11.5,.07);
    const plant=new Mesh(b.track(new SphereGeometry(.40,10,8)),b.material(0x5d8d68));plant.scale.y=1.35;plant.position.set(x,.55,11.5);root.add(plant);
  }
  const customers:Group[]=[];
  for(let i=0;i<2;i++) {
    const g=new Group();
    const body=b.box(.29,.38,.22,b.material(i?0x71998e:0xd9a555),.10);body.position.y=.37;g.add(body);
    const head=new Mesh(b.track(new SphereGeometry(.14,12,8)),b.material(i?0xca9268:0xf1bc92));head.position.y=.68;g.add(head);
    const hair=new Mesh(b.track(new SphereGeometry(.15,12,8)),dark);hair.scale.set(1,.55,1);hair.position.set(0,.78,-.02);g.add(hair);
    for(const x of [-.08,.08]){const leg=b.box(.10,.20,.12,dark,.025);leg.position.set(x,.11,0);g.add(leg);}
    const bag=b.box(.18,.23,.13,cream,.015);bag.position.set(.23,.3,.08);g.add(bag);
    g.position.set(5+i*5,0,11.5);g.scale.setScalar(.85);root.add(g);customers.push(g);
  }
  return customers;
}
