// Pixel interiors for Agent Office: carpet tiles, cutaway walls,
// wooden doors and softly outlined furniture. Original art drawn with rectangles.
// Positions are ground points (where things touch the floor) so the renderer can depth-sort
// furniture together with the robots.

import { px } from "./sprites.js";
import { crewSprite } from "./crew-art.js";
import { line, pixelText, textWidth } from "./yard-sprites.js";

export const LINE = "#39354b";
export const OUT = LINE;
export { pixelText, textWidth };

/** Box with the soft office outline. */
export function obox(g, x, y, w, h, fill, outline = LINE) {
  px(g, x, y, w, h, outline);
  px(g, x + 1, y + 1, w - 2, h - 2, fill);
}

const WOOD = "#daa57c", WOOD_HI = "#f5d4a0", WOOD_LO = "#ac756b";
const CHAIR = "#4d526c", CHAIR_HI = "#82889c";
const METAL = "#a3a9b6", METAL_HI = "#c7ccd6";

// Half-unit details use the office's finer backing grid at close range.
function detail(g, x, y, w, h, color) {
  g.fillStyle = color; g.fillRect(x, y, w, h);
}

function editorScreen(g, x, y, w, h, t, seed) {
  detail(g,x,y,w,h,"#1e3943");
  detail(g,x,y,w,1,"#58777b");
  detail(g,x+1,y+1,1,h-1,"#304f59");
  for (let row=0;row<4;row++) {
    const xx = x + 2.5 + row%2;
    const n = 1.5 + (seed+row*3)%2;
    detail(g,xx,y+2+row*1.5,n,.5,["#ffcf91","#a8e7d1","#aacaeb","#eeb1bc"][row]);
    detail(g,xx+n+.5,y+2+row*1.5,Math.max(.5,w-(xx-x)-n-1.5),.5,"#829eaa");
  }
  if (Math.floor(t*2) % 2 === 0) detail(g,x+w-1.5,y+h-2,.5,1.5,"#eff9da");
}

// ---------------------------------------------------------------- floors and walls

export const FLOORS = {
  studio:  { a: "#b7b9ba", b: "#b3b4b7", line: "#adafb2", hi: "#bfc1c0", size: 16, woven: true },
  tile:    { a: "#c9ccd3", b: "#c3c6ce", line: "#b6bac3", hi: "#d4d7dd", size: 16 },
  lobby:   { a: "#d3d5db", b: "#cdd0d6", line: "#bec2ca", hi: "#dfe1e6", size: 24 },
  wood:    { a: "#bf9790", b: "#c89d8c", line: "#b28782", hi: "#d0aa98", size: 9, planks: true },
  kitchen: { a: "#d6d9c8", b: "#adc2af", line: "#a4b2a7", hi: "#d7dfce", size: 10 },
  bath:    { a: "#e9ecf2", b: "#e2e6ee", line: "#d0d5df", hi: "#f3f5f8", size: 8 },
  server:  { a: "#8a91a1", b: "#848b9b", line: "#737a8a", hi: "#98a0b0", size: 12 },
  dark:    { a: "#7d8292", b: "#777c8c", line: "#6a6f80", hi: "#8a90a0", size: 16 },
};

export function drawFloor(g, x, y, w, h, kind) {
  const f = FLOORS[kind] || FLOORS.tile;
  px(g, x, y, w, h, f.a);
  if (f.planks) {
    for (let yy = 0; yy < h; yy += f.size) {
      px(g, x, y + yy, w, 1, f.line);
      const row = yy / f.size, th = Math.min(f.size,h-yy);
      const off = (row * 19) % 49;
      for (let xx = off - 49; xx < w; xx += 49) {
        const start = Math.max(xx,0), end = Math.min(xx+49,w);
        if (end <= start || th < 2) continue;
        if ((row + Math.floor((xx-off)/49)) % 3 === 0) px(g,x+start,y+yy+1,end-start,th-1,f.b);
        if (xx >= 0) px(g,x+xx,y+yy,1,th,f.line);
        if (xx + 5 >= 0 && xx + 15 < w && th > 4) px(g,x+xx+5,y+yy+4,7+row%4,1,f.hi);
      }
    }
    return;
  }
  if (f.woven) {
    for (let yy=0;yy<h;yy+=f.size) for (let xx=0;xx<w;xx+=f.size) {
      const tw=Math.min(f.size,w-xx), th=Math.min(f.size,h-yy);
      const cross = ((xx+yy)/f.size)%2 === 1;
      px(g,x+xx,y+yy,tw,th,cross ? f.b : f.a);
      for (let k=3;k<(cross ? th : tw);k+=4) {
        px(g,x+xx+(cross ? 0 : k),y+yy+(cross ? k : 0),cross ? tw : 1,cross ? 1 : th,"rgba(74,70,86,.035)");
      }
    }
    return;
  }
  for (let yy = 0; yy < h; yy += f.size) {
    for (let xx = 0; xx < w; xx += f.size) {
      const tw = Math.min(f.size, w - xx), th = Math.min(f.size, h - yy);
      if (((xx + yy) / f.size) % 2) px(g, x + xx, y + yy, tw, th, f.b);
      px(g, x + xx, y + yy, tw, 1, f.line);
      px(g, x + xx, y + yy, 1, th, f.line);
      px(g, x + xx + 1, y + yy + 1, Math.max(0, tw - 2), 1, f.hi);
    }
  }
}

export function drawRug(g, x, y, w, h, color, border) {
  px(g, x + 1, y + 2, w, h, "rgba(63,54,64,.18)");
  px(g, x, y, w, h, border);
  px(g, x + 2, y + 2, w - 4, h - 4, color);
  for (const edge of [x+3,x+w-4]) {
    px(g,edge,y+3,1,h-6,"rgba(255,247,219,.36)");
    for (let i=7;i<h-6;i+=6) px(g,edge+(edge===x+3?1:-1),y+i,1,2,border);
  }
  for (let i = 5; i < w - 5; i += 5) {
    px(g, x + i, y + 3, 2, 1, border); px(g, x + i, y + h - 4, 2, 1, border);
  }
  for (let xx = x + 4; xx < x + w - 4; xx += 4) { px(g, xx, y - 1, 1, 1, border); px(g, xx, y + h, 1, 1, border); }
}

/** The thick top of a wall running left to right. */
export function wallCapH(g, x, y, w) {
  px(g, x, y, w, 5, LINE);
  px(g, x, y + 1, w, 3, "#f6f6f8");
  px(g, x, y + 3, w, 1, "#dcdde3");
}
/** The thick top of a wall running up and down. */
export function wallCapV(g, x, y, h) {
  px(g, x, y, 6, h, LINE);
  px(g, x + 1, y, 4, h, "#f6f6f8");
  px(g, x + 4, y, 1, h, "#dcdde3");
}
/** The visible front of a wall: warm white with a darker band and a baseboard. */
export function wallFace(g, x, y, w, h) {
  px(g, x, y, w, h, "#e3d9d7");
  px(g, x, y, w, 2, "#b9afb9");
  px(g, x, y + h - 6, w, 1, "#cec0c7");
  px(g, x, y + h - 3, w, 2, "#9f909e");
  px(g, x, y + h - 1, w, 1, "#797187");
  px(g, x, y + h, w, 2, "rgba(75,55,76,.19)");
}
/** An open wooden door set into a wall face. `y` is the top of the face, `h` its height. */
export function doorway(g, cx, y, h) {
  const x = cx - 8;
  px(g, x - 1, y - 1, 18, h + 1, "#7a3f1c");
  px(g, x, y, 16, h, "#5a4a44");
  px(g, x, y + h - 1, 16, 1, "#c9ccd3");
  // The door leaf, swung open against the frame.
  px(g, x + 13, y, 3, h, "#c8662e"); px(g, x + 13, y, 1, h, "#e08a4c");
}
export function signPlate(g, text, x, y) {
  const w = textWidth(text) + 4;
  obox(g, x - 1, y - 1, w + 2, 10, "#444157");
  px(g,x,y,w,1,"#777588");
  pixelText(g, text, x + 2, y + 2, "#fff1cf");
}

/** Sky colour through the windows, from the local hour. */
export function skyAt(hour) {
  if (hour >= 7 && hour < 17) return { sky: "#a9d4f0", hi: "#d8eefc", night: false };
  if ((hour >= 17 && hour < 20) || (hour >= 5 && hour < 7)) return { sky: "#f2b27a", hi: "#ffd9ab", night: false };
  return { sky: "#24305a", hi: "#34447a", night: true };
}
export function drawWindow(g, x, y, w, h, t, hour) {
  const s = skyAt(hour);
  obox(g, x, y, w, h, "#a6b7c5");
  px(g, x + 2, y + 2, w - 4, h - 4, s.sky);
  px(g, x + 2, y + Math.floor(h/2), w - 4, Math.ceil(h/2)-2, s.night ? "#344767" : s.hi);
  px(g, x + 2, y + 2, w - 4, 1, s.hi);
  for (let i = 2; i < w - 5; i += 6) {
    const bh = 3 + ((i * 7) % 8), top = y + h - 2 - bh;
    px(g,x+i,top,4,bh,s.night ? "#34435b" : "#8ba6b1");
    px(g,x+i+3,top+1,2,bh-1,s.night ? "#28384c" : "#718d9b");
    for (let floor=1;floor<bh-1;floor+=2) {
      detail(g,x+i+.5,top+floor,.5,1,s.night ? "#ecc782" : "#c7d7d7");
      detail(g,x+i+2,top+floor,1,.5,s.night ? "#b6b0a4" : "#c7d7d7");
    }
  }
  px(g,x + 4,y + 4,5,1,s.hi); px(g,x+6,y+3,2,1,s.hi);
  for (let i = 0; i < 4; i++) px(g,x+w-8-i,y+2+i,2,1,"rgba(255,255,255,.4)");
  px(g, x + Math.floor(w / 2), y + 1, 1, h - 2, "#f6f6f8");
  px(g, x - 1, y + h - 1, w + 2, 2, "#f2e4cd");
  px(g, x, y + h + 1, w, 1, "#998497");
}
export function drawSunlight(g, x, y, w, night) {
  const light = `rgba(255,235,172,${.28 * (1 - night)})`;
  for (let i = 0; i < 22; i++) {
    const dx = Math.floor(i / 2);
    for (let pane = 0; pane < 2; pane++)
      px(g, x + dx + pane * Math.floor(w/2), y + i, Math.floor(w/2)-2, 1, light);
  }
}
export function drawClock(g, x, y) {
  const now = new Date();
  obox(g, x - 4, y - 4, 9, 9, "#ffffff");
  const hand = (len, a, c) => line(g, x, y, x + Math.round(Math.sin(a) * len), y - Math.round(Math.cos(a) * len), c);
  hand(3, (now.getMinutes() / 60) * Math.PI * 2, LINE);
  hand(2, ((now.getHours() % 12) / 12 + now.getMinutes() / 720) * Math.PI * 2, "#c8462e");
}
export function drawAC(g, x, y) {
  obox(g, x, y, 22, 7, "#f6f6f8");
  px(g, x + 2, y + 4, 18, 1, "#c9ccd3"); px(g, x + 17, y + 2, 2, 1, "#46e07a");
}
export function drawPoster(g, x, y, kind) {
  obox(g, x, y, 10, 12, "#ffffff");
  const c = ["#5aa8e8", "#f2b27a", "#7cc576"][kind % 3];
  px(g, x + 2, y + 2, 6, 5, c);
  px(g, x + 2, y + 8, 6, 1, "#c9ccd3"); px(g, x + 2, y + 10, 4, 1, "#c9ccd3");
}
export function drawBoard(g, x, y, w, h, t, busy) {
  px(g,x+1,y+1,w,h,"#b1a5a8"); obox(g,x,y,w,h,"#e8eee3");
  px(g,x+1,y+1,w-2,1,"#fff9e7");
  for (let i=0;i<3;i++) {
    px(g,x+4,y+3+i*3,2,2,i===2 ? "#d6ad73" : "#82ad9b");
    detail(g,x+8,y+3.5+i*3,10-i*2,1,"#7c9494");
  }
  // A sketched decision tree and a magnetic marker tray.
  px(g,x+w-24,y+5,13,1,"#839da0"); px(g,x+w-12,y+4,1,6,"#839da0");
  obox(g,x+w-29,y+3,7,5,"#a9cdc4","#638b86");
  obox(g,x+w-10,y+2,6,4,"#d6c3de","#9383a2");
  obox(g,x+w-10,y+8,6,4,"#efd2a7","#b59874");
  if (busy) detail(g,x+w-20+Math.floor(t)%3,y+4,1.5,1.5,"#a65e63");
  px(g,x+2,y+h-2,w-4,1,"#a2b2b0"); px(g,x+7,y+h-2,5,1,"#9f5f72");
}

// ---------------------------------------------------------------- cubicles

export function drawChair(g, x, y, facing) {
  px(g,x-5,y+2,13,2,"rgba(56,51,66,.22)");
  px(g,x-1,y-2,3,5,CHAIR);
  px(g,x-6,y+1,13,1,CHAIR_HI);
  for (const foot of [-5,1,5]) px(g,x+foot,y+2,2,2,LINE);
  obox(g,x-6,y-6,13,6,CHAIR_HI);
  px(g,x-5,y-5,11,2,"#9096a8"); px(g,x-5,y-2,11,1,"#697289");
  px(g,x-6,y-6,2,2,CHAIR); px(g,x+5,y-6,2,2,CHAIR);
  if (facing !== "north") drawChairBack(g,x,y,facing);
}

export function drawChairBack(g,x,y,facing) {
  const side = facing === "east" || facing === "west";
  const w = side ? 4 : 12, bx = x + (facing === "east" ? -8 : facing === "west" ? 4 : -6);
  const by = y - (facing === "north" ? 7 : 13);
  px(g,bx+1,by,w-2,10,LINE); px(g,bx,by+1,w,8,LINE);
  px(g,bx+1,by+1,w-2,7,CHAIR); px(g,bx+1,by+1,w-2,1,CHAIR_HI);
  for (let j=0;j<3;j++) detail(g,bx+1,by+3+j*1.5,w-2,.5,"#6f778c");
  detail(g,bx+1,by+.5,w-2,.5,"#a4aaba");
  if (!side) {
    detail(g,bx+2,by+2,.5,5,"#888fa1"); detail(g,bx+w-3,by+2,.5,5,"#303448");
    detail(g,bx+3,by+7,w-6,1,"#687080");
  }
}

function blotter(g,x,y,w,h) {
  obox(g,x,y,w,h,"#aebab8","#7f8f90");
  detail(g,x+1,y+1,w-2,.5,"#c8d3c8");
}

function papers(g,x,y) {
  px(g,x+1,y+1,7,5,"#8b8484"); px(g,x+1,y,7,5,"#d1d0c6");
  px(g,x,y-1,7,5,"#faf4dc"); detail(g,x+1,y,4,1,"#8eacb6");
  detail(g,x+1,y+2,4,.5,"#b5aba1");
}

function cup(g,x,y) {
  px(g,x,y,5,4,"#a28e80"); px(g,x+1,y-1,4,4,"#f8eccc");
  detail(g,x+1.5,y-.5,3,1,"#86634f"); detail(g,x+5,y,1.5,2,"#efdbb6");
}

function keyboard(g,x,y,side) {
  const w = side ? 4 : 10, h = side ? 8 : 4;
  px(g,x,y,w,h,"#59616f"); detail(g,x+.5,y+.5,w-1,h-1,"#c2cad0");
  for (let i=1;i<w-1;i+=1.5) for (let j=1;j<h-1;j+=1.5)
    detail(g,x+i,y+j,1,1,"#83909a");
}

const deskFrames = new Map();
// Origins are desktop centres. Cache the static pixel layers together with the two cursor frames.
export function drawDesk(g,x,y,facing,t,mode,seed) {
  const frame = mode === "code" ? Math.floor(t*2)%2 : 0;
  const style = seed % 3, key = `${facing}:${mode}:${style}:${frame}`;
  let c = deskFrames.get(key);
  if (!c) {
    c = document.createElement("canvas"); c.width = 76; c.height = 68;
    const ctx = c.getContext("2d");
    ctx.setTransform(facing === "west" ? -2 : 2,0,0,2,38,40);
    paintDesk(ctx,facing,frame,mode,style);
    deskFrames.set(key,c);
  }
  g.drawImage(c,x-19,y-20,38,34);
}

function paintDesk(g,facing,frame,mode,style) {
  const side = facing === "west" || facing === "east";
  const half = side ? 11 : 16;
  px(g,-half+2,5,half*2,6,"rgba(62,54,68,.20)");
  for (const lx of [-half+1,half-4]) {
    obox(g,lx,1,4,10,"#9da4a9"); px(g,lx+1,9,2,2,"#555361");
  }
  obox(g,-half+2,2,8,7,"#a6a8b2"); px(g,-half+3,4,6,1,"#d2cfd0");
  px(g,-half+5,5,3,1,CHAIR);
  obox(g,-half,-8,half*2,15,"#c79e77");
  px(g,-half+1,-7,half*2-2,11,"#dec099");
  px(g,-half+1,-7,half*2-2,1,"#f5d9ab"); px(g,-half+1,4,half*2-2,1,"#f1cd9f");
  for (let k=-half+2;k<half-3;k+=5) detail(g,k,-5+(k+half)%6,2,.5,"#c8a882");

  const mx = side ? 2 : -8, my = facing === "south" ? -9 : -15;
  blotter(g,-half+1,-5,side ? 12 : 21,9);
  detail(g,mx+6,my+11,4,.5,"#7f7c78");
  detail(g,mx+9.5,my+9,.5,2.5,"#7f7c78");
  px(g,mx+2,my+11,7,1,"#61717a"); px(g,mx+4,my+8,3,3,"#77858e");
  if (side) {
    for (let i=0;i<8;i++) {
      const dy = Math.floor(i/3);
      px(g,mx+i,my+dy,1,10,LINE);
      px(g,mx+i,my+dy+1,1,1,"#afbac5");
      if (i>0 && i<7) px(g,mx+i,my+dy+2,1,6,mode === "off" ? "#485a6a" : "#49779a");
    if (mode === "code" && i>1 && i<6) {
      detail(g,mx+i,my+dy+3,1,.5,"#d6e6de");
      if (i<5) detail(g,mx+i,my+dy+5,1,1,"#e4ba8c");
      if (frame && i===3) detail(g,mx+i,my+dy+7,1,.5,"#94d4dd");
    }
    }
  keyboard(g,-9,-5,true);
  } else if (facing === "south") {
    keyboard(g,-2,-6,false);
    obox(g,mx,my,14,10,"#7b8493"); px(g,mx+1,my+1,12,2,"#a4aeb6");
    for (let i=0;i<4;i++) detail(g,mx+2+i*2,my+4,1,2,"#565967");
    px(g,mx+8,my+7,3,1,"#c6c9bf");
    detail(g,mx+2,my+8,5,.5,"#a7aeb5");
  } else {
    obox(g,mx,my,15,10,"#a3adb8");
    if (mode === "code") editorScreen(g,mx+1,my+1,13,8,frame/2,style);
    else {
      px(g,mx+1,my+1,13,8,mode === "off" ? "#485a6b" : "#527e9f");
      px(g,mx+2,my+2,9,1,"#7397ac");
      if (mode === "done") pixelText(g,"V",mx+6,my+3,"#e7f1ca");
    }
    keyboard(g,-6,0,false);
  }
  const ax = side ? -2 : 8;
  if (style === 0) cup(g,ax,0);
  if (style === 1) papers(g,ax,-1);
  if (style === 2) {
    px(g,ax,-2,6,5,"#a07058"); px(g,ax+1,-1,2,3,"#c39275");
    for (const [dx,dy,dir] of [[2,-5,-1],[3,-8,1],[3,-4,1]]) {
      px(g,ax+dx,dy,2,-2-dy,"#48725c"); px(g,ax+dx+dir,dy-1,2,2,"#64936b");
      detail(g,ax+dx+2*dir,dy-2,1.5,1.5,"#8caf7f");
    }
    px(g,ax-1,-3,8,2,"#d5a385");
  }
}

// ---------------------------------------------------------------- rooms

const END_INSETS = [7,4,2,1];
export function drawMeetingTable(g, cx, y, w, busy) {
  const x = Math.round(cx - w / 2);
  const top = y-22;
  px(g,x+4,y-7,w-4,8,"rgba(60,52,66,.18)");
  for (const leg of [x+8,x+w-13]) {
    obox(g,leg,y-6,5,8,"#9295a0"); px(g,leg-2,y+1,9,2,CHAIR);
  }
  // Stepped ends keep the oval silhouette sharp even at maximum magnification.
  for (let j=0;j<18;j++) {
    const inset = END_INSETS[Math.min(j,17-j)] ?? 0;
    px(g,x+inset,top+j,w-2*inset,5,LINE);
    px(g,x+inset+1,top+j,w-2*inset-2,4,"#a77f69");
  }
  for (let j=0;j<18;j++) {
    const inset = END_INSETS[Math.min(j,17-j)] ?? 0;
    px(g,x+inset+1,top+j,w-2*inset-2,1,
      j===0 || j===16 ? "#f3d9b0" : j===17 ? "#a7816a" : "#dcc39f");
  }
  const mid = Math.round(cx);
  detail(g,mid,top+1,.5,15,"#c29f82");
  for (let i=0;i<3;i++) {
    const gx = x+5+i*Math.floor(w/3), gy = top+5+i*4;
    detail(g,gx,gy,7,.5,"#caae8e"); detail(g,gx+7,gy-.5,4,.5,"#caae8e");
  }
  if (w>52) {
    // The laptop opens toward the far seat; the near seat gets the lit screen.
    const left = Math.round(cx-w*.25), right = Math.round(cx+w*.25);
    obox(g,left-6,top+2,12,7,"#929ba4"); detail(g,left-1,top+4,3,1.5,"#c6cfd0");
    px(g,left-7,top+9,14,2,"#697886"); papers(g,left+3,top+12);
    cup(g,right+7,top+3); blotter(g,right-9,top+10,14,6);
    obox(g,right-8,top+6,11,7,"#416581");
    detail(g,right-6,top+8,5,.5,"#c0dde1"); detail(g,right-6,top+10,3,1,"#85bdca");
    px(g,right-9,top+13,13,2,"#a1abb0");
  } else {
    papers(g,x+6,top+6); cup(g,x+w-10,top+8);
  }
  px(g,mid-4,top+7,9,5,"#7a726f"); obox(g,mid-5,top+6,10,5,CHAIR);
  for (let i=0;i<3;i++) detail(g,mid-3+i*2,top+7,1,1.5,"#929da3");
  px(g,mid,top+9,2,1,busy ? "#9be0b4" : "#728c93");
}

export function drawShelf(g, x, y, w, seed) {
  obox(g, x, y - 30, w, 30, "#b98e5c");
  px(g, x + 1, y - 29, w - 2, 1, "#d6a96f");
  const colors = ["#bb6d65", "#698da6", "#dab67f", "#6f9885", "#9584a7", "#e9d5b4", "#cc9278"];
  for (let row = 0; row < 3; row++) {
    px(g, x + 2, y - 20 + row * 9, w - 4, 1, "#8a6440");
    let bx = x + 2;
    while (bx < x + w - 3) {
      const bw = 2 + ((bx * 7 + row * 3 + seed) % 2);
      const bh = 5 + ((bx + row + seed) % 3);
      px(g, bx, y - 20 + row * 9 - bh, bw, bh, colors[(bx * 3 + row + seed) % colors.length]);
      px(g,bx,y-19+row*9-bh,bw,1,"rgba(255,248,225,.56)");
      bx += bw + ((bx + seed) % 6 === 0 ? 3 : 0);
    }
  }
}
export function drawStorage(g, x, y, w, seed) {
  // Metal shelving with cardboard boxes.
  obox(g, x, y - 26, w, 26, METAL_HI);
  for (let row = 0; row < 3; row++) {
    px(g, x + 1, y - 18 + row * 8, w - 2, 1, METAL);
    for (let bx = x + 2; bx < x + w - 7; bx += 8) {
      if ((bx + row + seed) % 3 === 0) continue;
      obox(g, bx, y - 24 + row * 8, 7, 6, "#d6ab72");
      px(g, bx + 3, y - 23 + row * 8, 1, 4, "#b98e5c");
    }
  }
}
export function drawBoxes(g, x, y) {
  obox(g, x, y - 7, 9, 7, "#d6ab72"); px(g, x + 4, y - 6, 1, 5, "#b98e5c");
  obox(g, x + 2, y - 13, 8, 7, "#e0b97e"); px(g, x + 5, y - 12, 1, 5, "#b98e5c");
}
export function drawArmchair(g, x, y, color = "#e8e8ee") {
  obox(g, x - 7, y - 14, 15, 8, color);
  px(g, x - 6, y - 13, 13, 1, "#ffffff");
  obox(g, x - 8, y - 7, 17, 7, color);
  obox(g, x - 9, y - 10, 4, 10, color); obox(g, x + 6, y - 10, 4, 10, color);
}
export function drawSideTable(g, x, y) {
  obox(g, x - 6, y - 8, 12, 5, WOOD);
  px(g, x - 1, y - 3, 2, 3, WOOD_LO);
  obox(g, x - 2, y - 11, 4, 4, "#ffffff");
}

export function drawRack(g, x, y, t, busy, seed) {
  obox(g, x, y - 34, 18, 34, "#3b3f4e");
  px(g,x+1,y-33,1,31,"#747f91"); px(g,x+16,y-33,1,31,"#242e3d");
  for (let u = 0; u < 7; u++) {
    px(g, x + 2, y - 31 + u * 4, 14, 3, "#4f5466");
    for (let v=0;v<4;v++) detail(g,x+3+v*1.5,y-30+u*4,.5,1.5,"#283643");
    for (let l = 0; l < 3; l++) {
      const on = busy ? (Math.floor(t * 8) + u * 3 + l * 5 + seed) % 4 !== 0 : (u + l + seed) % 3 === 0;
      px(g, x + 10 + l * 2, y - 30 + u * 4, 1, 1, on ? (l === 2 ? "#ffb347" : "#46e07a") : "#2e3140");
    }
  }
}
export function drawConsole(g, x, y, t, busy) {
  obox(g, x - 14, y - 7, 28, 7, "#e8eaef");
  obox(g, x - 9, y - 18, 18, 12, "#2e3140");
  px(g, x - 8, y - 17, 16, 10, "#10202a");
  if (busy) for (let r = 0; r < 4; r++) px(g, x - 7, y - 16 + r * 2, ((Math.floor(t * 6) + r * 5) % 11) + 3, 1, "#46e07a");
  else px(g, x - 7, y - 16, 2, 1, Math.floor(t * 2) % 2 ? "#46e07a" : "#10202a");
}

export function drawBooth(g, x, y, w, h, t, busy) {
  // Phone booth: white frame, felt back wall, a wall phone.
  obox(g, x, y, w, h, "#f6f6f8");
  px(g, x + 2, y + 2, w - 4, 10, "#7d93b0");
  px(g, x + 2, y + 12, w - 4, h - 14, "#d8dce4");
  obox(g, x + 5, y + 3, 5, 7, "#2e3140");
  px(g, x + 6, y + 4, 3, 1, busy ? "#46e07a" : "#6a7080");
  if (busy) for (let k = 0; k < 2; k++) {
    const p = (t * 1.2 + k / 2) % 1;
    g.globalAlpha = 1 - p;
    px(g, x + w - 9 + Math.round(p * 5), y + 4 - Math.round(p * 3), 1, 3, "#9b6df2");
    g.globalAlpha = 1;
  }
}
export function drawBoothFront(g, x, y, w) {
  g.globalAlpha = 0.25;
  px(g, x + 1, y - 10, w - 2, 10, "#d8eefc");
  g.globalAlpha = 1;
  px(g, x, y - 1, w, 1, LINE);
  px(g, x, y - 11, 2, 11, "#f6f6f8"); px(g, x + w - 2, y - 11, 2, 11, "#f6f6f8");
  px(g, x + 3, y - 9, 1, 6, "rgba(255,255,255,0.8)");
}

export function drawWhiteboard(g, x, y, w, t, busy) {
  // Kanban board on legs: three columns of sticky notes that move along while planning.
  obox(g, x, y - 40, w, 32, "#ffffff");
  px(g, x + 3, y - 8, 2, 8, METAL); px(g, x + w - 5, y - 8, 2, 8, METAL);
  const col = Math.floor((w - 4) / 3);
  for (let c = 1; c < 3; c++) px(g, x + 2 + c * col, y - 38, 1, 28, "#d8dce4");
  pixelText(g, "TODO", x + 3, y - 38, "#9aa0ad");
  const notes = ["#ffe066", "#ffa8d8", "#a8dcff", "#b8f0c0"];
  const shift = busy ? Math.floor(t / 2) % 3 : 0;
  for (let i = 0; i < 7; i++) {
    const c = (i + (i === 2 ? shift : 0)) % 3;
    const r = Math.floor(i / 3) + (i % 3 === 0 ? 0 : 1);
    px(g, x + 4 + c * col + (i % 2) * 6, y - 31 + r * 7, 5, 5, notes[i % 4]);
  }
}

export function drawBossDesk(g, x, y, t, waiting) {
  // An empty executive chair: the manager (you) is out, and the queue is waiting for you.
  obox(g, x - 7, y - 27, 15, 14, "#5a3b2b");
  px(g, x - 6, y - 26, 13, 2, "#7a5534");
  obox(g, x - 24, y - 13, 48, 13, "#8a5a36");
  px(g, x - 23, y - 12, 46, 1, "#a8743f");
  obox(g, x - 6, y - 18, 12, 6, "#2e3140");
  px(g, x - 5, y - 17, 10, 4, waiting && Math.floor(t * 2) % 2 ? "#ff6a78" : "#5aa8e8");
  obox(g, x + 9, y - 17, 14, 6, "#f2c14e");
  pixelText(g, "YOU", x + 11, y - 16, LINE);
}
export function drawDoorLight(g, x, y, t, waiting) {
  obox(g, x - 2, y - 3, 5, 4, waiting ? (Math.floor(t * 4) % 2 ? "#ff3a4a" : "#7a2a30") : "#46e07a");
}

// ---------------------------------------------------------------- kitchen, lounge, restroom, lobby

export function drawCounter(g, x, y, w) {
  obox(g, x, y - 14, w, 14, "#b3b9c6");
  obox(g, x, y - 14, w, 5, "#eef0f4");
  for (let i = 4; i < w - 4; i += 9) px(g, x + i, y - 13, 3, 1, "#d6dae2");
  for (let i = 14; i < w - 4; i += 16) { px(g, x + i, y - 8, 1, 7, "#9aa0ad"); px(g, x + i - 3, y - 6, 2, 1, "#7d8494"); }
}
export function drawSink(g, x, y) {
  obox(g, x - 5, y - 13, 10, 4, "#c9ced8");
  px(g, x - 1, y - 16, 2, 3, METAL);
}
export function drawMicrowave(g, x, y) {
  obox(g, x - 7, y - 21, 14, 9, "#e8eaef");
  px(g, x - 5, y - 19, 8, 5, "#3b4256"); px(g, x + 4, y - 19, 1, 1, "#46e07a");
}
export function drawCoffee(g, x, y, t, busy) {
  obox(g, x - 5, y - 24, 10, 12, "#3b3f4e");
  px(g, x - 4, y - 23, 8, 2, "#c8462e");
  px(g, x - 2, y - 17, 4, 3, "#ffffff");
  if (busy) for (let k = 0; k < 3; k++) {
    const p = (t * 0.8 + k / 3) % 1;
    g.globalAlpha = 1 - p;
    px(g, x - 1 + Math.round(Math.sin(t * 3 + k) * 1.5), y - 26 - Math.round(p * 10), 1, 2, "#ffffff");
  }
  g.globalAlpha = 1;
}
export function drawFridge(g, x, y) {
  obox(g, x - 8, y - 36, 16, 36, "#d6dbe4");
  px(g, x - 7, y - 35, 14, 1, "#eef0f4");
  px(g, x - 7, y - 22, 14, 1, "#9aa0ad");
  px(g, x + 4, y - 32, 1, 6, "#7d8494"); px(g, x + 4, y - 18, 1, 8, "#7d8494");
  px(g, x - 5, y - 32, 3, 3, "#f2c14e"); px(g, x - 1, y - 30, 3, 3, "#ffa8d8");
}
export function drawCooler(g, x, y, t) {
  obox(g, x - 5, y - 15, 10, 15, "#eef0f4");
  obox(g, x - 4, y - 26, 8, 12, "#8cc8f0");
  px(g, x - 3, y - 25, 2, 9, "#d8eefc");
  px(g, x - 3, y - 11, 2, 2, "#5aa8e8"); px(g, x + 1, y - 11, 2, 2, "#e0604a");
  if (Math.floor(t * 0.5) % 4 === 0) px(g, x - 1, y - 20 + Math.floor(t * 6) % 4, 1, 1, "#ffffff");
}
export function drawVending(g, x, y, t) {
  obox(g, x - 9, y - 34, 18, 34, "#3b3f4e");
  obox(g, x - 7, y - 31, 11, 22, "#d8eefc");
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) px(g, x - 6 + c * 3, y - 30 + r * 5, 2, 3, ["#f2c14e", "#3fa060", "#5a8ee0", "#e0604a"][(r + c) % 4]);
  px(g, x + 5, y - 28, 2, 4, Math.floor(t * 2) % 2 ? "#46e07a" : "#2a5a3a");
  px(g, x - 6, y - 6, 10, 3, "#2e3140");
}
export function drawCouch(g, x, y, w, color = "#8e9ab0") {
  px(g,x-1,y,w+5,3,"rgba(63,54,64,.22)");
  obox(g, x, y - 16, w, 9, color);
  px(g, x + 1, y - 15, w - 2, 1, "rgba(255,255,255,0.3)");
  obox(g, x, y - 8, w, 8, color);
  for (let k = Math.floor(w / 3); k < w - 2; k += Math.floor(w / 3)) px(g, x + k, y - 7, 1, 6, "rgba(0,0,0,0.15)");
  obox(g, x - 3, y - 12, 5, 12, color); obox(g, x + w - 2, y - 12, 5, 12, color);
  px(g,x+2,y-3,w-4,2,"rgba(32,45,51,.24)");
  const throwX = x + Math.floor(w*.61);
  px(g,throwX,y-15,8,9,"#cf9c6e"); px(g,throwX,y-7,8,2,"#e5bd8c");
  for (let i=1;i<8;i+=2) {
    detail(g,throwX+i,y-14,.5,8,"#eac99e"); detail(g,throwX+i,y-5,1,1.5,"#efcf9b");
  }
}
export function drawPingPong(g, x, y, w, t, rally) {
  const h = 22, x0 = Math.round(x - w / 2);
  obox(g, x0, y - h, w, h, "#3d8a6a");
  px(g, x0 + 1, y - h + Math.floor(h / 2), w - 2, 1, "#ffffff");
  px(g, x0 + 1, y - h + 1, w - 2, 1, "#5aa888");
  px(g, x0 + Math.floor(w / 2), y - h - 3, 1, h + 3, "#ffffff");
  px(g, x0 + 2, y, 2, 3, METAL); px(g, x0 + w - 4, y, 2, 3, METAL);
  if (!rally) return;
  const p = (Math.sin(t * 3.2) + 1) / 2;
  px(g, x0 - 4 + p * (w + 8), y - h / 2 - Math.abs(Math.sin(t * 6.4)) * 8, 2, 2, "#ffffff");
}
export function drawPlant(g, x, y, big) {
  px(g,x-4,y-1,11,2,"rgba(57,44,63,.19)");
  obox(g,x-4,y-8,9,8,"#bc8074"); obox(g,x-5,y-9,11,3,"#edbb97");
  px(g,x-2,y-6,2,4,"#d49c81");
  const h = big ? 15 : 9;
  px(g,x,y-9-h,2,h,"#686b50");
  for (const [dx,dy,len,dir] of [[0,1,6,-1],[0,3,5,1],[-1,6,8,-1],[1,8,7,1],[0,11,6,-1]]) {
    const sy=y-10-h+dy*.7;
    for (let j=0;j<len;j++) {
      const ly=sy-Math.min(j,3)+Math.max(0,j-5);
      px(g,x+dx+j*dir,ly,2,j===len-1?2:4,"#416955");
      if (j<len-1) px(g,x+dx+j*dir,ly,2,1,j<3?"#74a373":"#98bc7f");
    }
  }
}
export function drawToilet(g, x, y) {
  obox(g, x - 5, y - 16, 10, 6, "#ffffff");
  obox(g, x - 4, y - 11, 8, 9, "#ffffff");
  px(g, x - 2, y - 9, 4, 4, "#d8dce4");
}
export function drawStall(g, x, y, w) {
  // Partition side walls of a restroom stall.
  px(g, x, y - 30, 3, 30, LINE); px(g, x + 1, y - 30, 1, 30, "#d6dae2");
  px(g, x + w, y - 30, 3, 30, LINE); px(g, x + w + 1, y - 30, 1, 30, "#d6dae2");
}
export function drawWashbasin(g, x, y) {
  obox(g, x - 6, y - 12, 12, 6, "#ffffff");
  px(g, x - 3, y - 10, 6, 2, "#d8dce4");
  px(g, x - 1, y - 14, 2, 2, METAL);
  obox(g, x - 5, y - 22, 10, 8, "#d8eefc");
}
/** Elevator set into the back wall; `y` is the floor line in front of it. */
export function drawElevator(g, x, y, t, open) {
  obox(g, x - 17, y - 32, 34, 32, "#b3b9c6");
  const gap = open ? 7 : 0;
  obox(g, x - 14 - gap, y - 28, 14, 28, "#d6dbe4"); obox(g, x + gap, y - 28, 14, 28, "#d6dbe4");
  if (gap) px(g, x - gap + 1, y - 27, gap * 2 - 2, 27, "#4a5068");
  obox(g, x - 7, y - 39, 14, 7, "#2e3140");
  pixelText(g, String(1 + (Math.floor(t / 4) % 9)), x - 1, y - 38, "#ffb347");
}
export function drawReception(g, x, y) {
  obox(g, x - 33, y - 14, 66, 14, "#f6f6f8");
  obox(g, x - 33, y - 14, 66, 4, WOOD);
  pixelText(g, "AGENTTALLY INC", x - 28, y - 8, "#5a6f9a");
  obox(g, x + 18, y - 21, 9, 7, "#2e3140"); px(g, x + 19, y - 20, 7, 4, "#5aa8e8");
}
export function drawPrinter(g, x, y, t, busy) {
  obox(g, x - 8, y - 14, 16, 14, "#e8eaef");
  obox(g, x - 7, y - 18, 14, 5, "#c9ced8");
  px(g, x - 4, y - 9, 8, 2, "#ffffff");
  px(g, x + 4, y - 12, 2, 1, busy && Math.floor(t * 4) % 2 ? "#46e07a" : "#9aa0ad");
}
export function drawRoomba(g, x, y, t) {
  px(g, x - 5, y - 3, 11, 4, LINE); px(g, x - 4, y - 4, 9, 1, LINE);
  px(g, x - 4, y - 3, 9, 3, "#e8eaef"); px(g, x - 2, y - 3, 5, 1, "#ffffff");
  px(g, x, y - 4, 1, 1, Math.floor(t * 3) % 2 ? "#46e07a" : "#2a5a3a");
}

// The guide uses the same props as the corresponding room in the cutaway.
export function drawRoomIcon(g, room) {
  g.imageSmoothingEnabled = false;
  const person = (provider,x,y,facing) => g.drawImage(crewSprite({provider,legs:"sit",facing}),x,y,16,18);
  switch (room) {
    case "meeting":
      person("copilot",8,3,"south"); drawMeetingTable(g,22,36,40,true);
      person("codex",21,24,"north"); return;
    case "desk":
      drawChair(g,10,29,"east"); person("claude",2,11,"east");
      return drawDesk(g,27,29,"east",0,"code",0);
    case "library": return drawShelf(g,9,39,26,2);
    case "terminal": return drawRack(g,13,40,0,true,2);
    case "radar": return drawBooth(g,6,13,32,23,0,false);
    case "tasks": return drawWhiteboard(g,4,44,36,0,false);
    case "queue": g.save(); g.scale(.8,.8); drawBossDesk(g,27,44,0,true); g.restore(); break;
    case "break": drawPlant(g,33,27,false); return drawCouch(g,5,37,29,"#849e9e");
  }
}
