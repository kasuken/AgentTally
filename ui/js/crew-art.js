// Office sprites use a two-pixel drawing grid for each world pixel. The legacy maps
// and the transparent desktop buddy keep their own smaller silhouettes.
import { providerMeta } from "./meta.js";

const frames = new Map();
const ink = "#202735", joint = "#485362", steel = "#8999a5", silver = "#c1ccd0";

export function crewSprite({provider, legs = "stand", arms = false, eyes = "open", chest, gray = false, drone = false, rotor = 0, facing = "south"}) {
  const key = [provider, legs, +arms, eyes, chest, +gray, +drone, rotor, facing].join(":");
  if (frames.has(key)) return frames.get(key);
  const c = document.createElement("canvas");
  c.width = 32; c.height = 36;
  const g = c.getContext("2d"), p = providerMeta(provider);
  const body = gray ? steel : p.body, shade = gray ? joint : p.shade, light = gray ? silver : p.light;
  const accent = gray ? steel : p.accent, eye = gray ? steel : p.eye;
  const r = (x,y,w,h,color) => { g.fillStyle = color; g.fillRect(x,y,w,h); };
  // Stepped corners, a lit top edge and a separate lower bevel; no antialiased paths.
  function shell(x,y,w,h) {
    r(x+2,y,w-4,h,ink); r(x,y+2,w,h-4,ink);
    r(x+2,y+1,w-4,h-2,shade); r(x+1,y+3,w-2,h-6,body);
    r(x+3,y+1,w-6,2,light); r(x+1,y+4,2,h-8,light);
    r(x+w-4,y+4,2,h-7,shade);
  }
  function lens(x,y,w) {
    if (eyes !== "open") { r(x,y+1,w,1,eyes === "off" ? "#47505c" : eye); return; }
    r(x,y,w,3,eye); r(x,y,w-1,1,"#f4fff1");
  }
  if (drone) {
    const y = 12;
    r(15,y-4,2,5,joint);
    r(rotor ? 6 : 2,y-5,rotor ? 8 : 12,2,steel);
    r(18,y-5,rotor ? 8 : 12,2,silver); r(14,y-6,4,4,ink);
    shell(5,y,22,13); r(9,y+4,14,5,ink); lens(10,y+5,3); lens(19,y+5,3);
    r(14,y+10,4,2,chest || accent);
    for (const x of [8,21]) { r(x,y+13,2,3,joint); r(x-1,y+16,4,1,steel); }
  } else {
    const profile = facing === "west" || facing === "east";
    if (facing === "west") { g.translate(32,0); g.scale(-1,1); }
    // The antenna and optical assembly identify the provider even in grayscale.
    r(15,2,2,5,joint);
    if (p.head === "star" || p.head === "sparkle") {
      r(14,0,3,5,accent); r(12,2,7,1,light);
    } else if (p.head === "crown") {
      r(10,2,12,3,accent); for (const x of [10,15,20]) r(x,0,2,3,accent);
    } else if (p.head === "goggles") {
      r(6,2,2,6,shade); r(24,2,2,6,shade); r(5,1,3,2,accent); r(24,1,3,2,accent);
    } else r(14,1,4,2,accent);
    shell(profile ? 5 : 3,5,profile ? 22 : 26,16);
    if (profile) {
      r(16,9,11,8,ink); r(18,10,8,5,"#2a404c"); lens(22,12,4);
      r(8,10,5,7,shade); r(9,11,3,5,steel); r(10,12,2,2,silver);
      r(17,18,7,1,light);
    } else if (facing === "north") {
      r(7,9,18,9,shade); r(8,10,16,7,body);
      for (let i=0;i<4;i++) r(10+i*3,12,1,3,joint);
      r(20,16,3,1,accent); r(5,9,1,2,silver); r(26,16,1,2,steel);
    } else {
      r(2,11,2,5,steel); r(28,11,2,5,joint);
      r(7,8,18,1,body); r(6,10,20,7,ink); r(7,11,18,4,"#2a404c");
      if (p.head === "visor") { lens(8,12,15); r(11,12,2,2,eye); }
      else { lens(9,12,4); lens(20,12,4); }
      if (p.head === "goggles") { r(14,10,4,6,shade); r(14,11,3,2,light); }
      r(6,17,3,1,light); r(20,18,5,1,shade);
    }
    r(10,20,12,2,joint);
    shell(8,21,16,10);
    if (facing === "north") {
      r(11,23,10,6,joint); r(13,24,6,1,steel); r(16,27,3,1,chest || accent);
    } else {
      r(profile ? 19 : 10,24,5,4,ink); r(profile ? 20 : 11,25,3,2,chest || accent);
      if (!profile) { r(18,24,4,1,shade); r(18,26,4,1,shade); }
    }
    r(12,30,8,2,joint);
    for (const side of [0,1]) {
      if (profile) {
        if (side) continue;
        r(12,23,6,6,shade); r(13,24,4,3,body); r(16,27,7,3,joint);
        const handY = arms ? 22 : 25;
        r(21,handY,4,28-handY,steel); r(22,handY,5,2,silver);
        continue;
      }
      const raised = arms && side === 0;
      const x = side ? 24 : raised ? 1 : 4;
      const y = raised ? 16 : 23;
      r(x,y+1,4,6,ink); r(x+1,y+1,2,3,steel); r(x,y,4,2,body);
      r(x,y+(raised ? -1 : 5),4,3,joint); r(x+1,y+(raised ? -1 : 5),2,1,silver);
      if (raised) r(x+2,y+6,5,2,shade);
    }
    if (legs.startsWith("hover")) {
      r(11,31,10,2,steel); r(14,33,4,legs === "hover" ? 3 : 2,accent);
    } else {
      for (const [x,offset] of [[10,0],[18,legs === "step" ? -2 : 0]]) {
        const y = (legs === "sit" ? 29 : 31) + offset;
        r(x,y,4,3,joint); r(x-1,y+2,6,2,ink); r(x,y+2,4,1,steel);
      }
    }
  }
  frames.set(key,c);
  return c;
}
