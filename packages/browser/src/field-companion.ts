import { randomUUID } from 'node:crypto';
import type { WebContents } from 'electron';
import type { BrowserBounds } from '../../shared/src/contracts.js';

export const FIELD_COMPANION_WORLD_ID = 9467;
export type FieldCompanionPhase = 'approach' | 'typing' | 'verified' | 'attention';
export interface FieldCompanionTarget { phase: FieldCompanionPhase; bounds: BrowserBounds; }

/** Coordinate-only energy plume: tapered ribbons, forked bolts, embers and running echoes. */
export function fieldCompanionTrail(from: {x:number;y:number}|undefined, to: {x:number;y:number}|undefined,
  width:number,height:number):{path:string;length:number;arcs:Array<{path:string;length:number}>;ribbon:string;streamers:Array<{path:string;opacity:number}>;echoes:Array<{x:number;y:number;opacity:number}>;sparks:Array<{x:number;y:number;size:number;driftX:number;driftY:number}>}|undefined {
  if(!from||!to||[from.x,from.y,to.x,to.y,width,height].some(value=>!Number.isFinite(value)||Math.abs(value)>100_000)
    ||width<60||height<40)return;
  const dx=to.x-from.x,dy=to.y-from.y,distance=Math.hypot(dx,dy);
  if(distance<8||to.x<0||to.y<0||to.x>width||to.y>height)return;
  const length=Math.min(distance,280),ux=dx/distance,uy=dy/distance;
  const startX=to.x-ux*length,startY=to.y-uy*length;
  let path='',measured=0,lastX=0,lastY=0;
  for(let index=0;index<=8;index++){
    const progress=index/8,offset=index===0||index===8?0:(index%2?1:-1)*Math.min(7,length/24)*(1-progress*.6);
    const x=Math.round(Math.max(0,Math.min(width,startX+ux*length*progress-uy*offset))*10)/10;
    const y=Math.round(Math.max(0,Math.min(height,startY+uy*length*progress+ux*offset))*10)/10;
    if(index)measured+=Math.hypot(x-lastX,y-lastY);
    path+=`${index?' L':'M'}${x} ${y}`;lastX=x;lastY=y;
  }
  const arcs:Array<{path:string;length:number}>=[],echoes:Array<{x:number;y:number;opacity:number}>=[],sparks:Array<{x:number;y:number;size:number;driftX:number;driftY:number}>=[];
  const spread=Math.min(48,length*.23);
  // All shapes use the travel vector, including vertical and diagonal field hops.
  // Keep a method here: the function is serialized into a separate world.
  const projection={ point(progress:number,offset:number):[number,number] { return [
    Math.round(Math.max(0,Math.min(width,startX+ux*length*progress-uy*offset))*10)/10,
    Math.round(Math.max(0,Math.min(height,startY+uy*length*progress+ux*offset))*10)/10,
  ]; } };
  const streamers:Array<{path:string;opacity:number}>=[];
  for(let lane=0;lane<7;lane++){
    const centers:Array<{progress:number;offset:number;half:number}>=[];
    for(let index=0;index<=14;index++){
      const start=.025+(lane%4)*.048;
      const progress=start+index/14*(.975-start-(lane%3)*.014);
      const envelope=Math.pow(Math.sin(progress*Math.PI),.7);
      const jag=(Math.sin(index*2.23+lane*1.73)*9+Math.cos(index*4.1+lane)*4)*envelope;
      centers.push({progress,offset:((lane-3)*spread*.29+jag)*envelope,
        half:(index===0||index===14)?0:(3.5+(lane%3)*1.4)*envelope});
    }
    const upper=centers.map(c=>projection.point(c.progress,c.offset+c.half));
    const lower=centers.toReversed().map(c=>projection.point(c.progress,c.offset-c.half));
    streamers.push({path:[...upper,...lower].map(([x,y],index)=>`${index?'L':'M'}${x} ${y}`).join(' ')+' Z',opacity:.54+(lane%3)*.16});
  }
  for(let lane=0;lane<5;lane++){
    let data='',arcLength=0,previousX=0,previousY=0;
    const side=lane-2;
    for(let index=0;index<=12;index++){
      const progress=index/12,envelope=Math.sin(progress*Math.PI);
      const offset=(side*spread*.43+Math.sin(index*2.7+lane*1.9)*12)*envelope;
      const x=Math.round(Math.max(0,Math.min(width,startX+ux*length*progress-uy*offset))*10)/10;
      const y=Math.round(Math.max(0,Math.min(height,startY+uy*length*progress+ux*offset))*10)/10;
      data+=`${index?' L':'M'}${x} ${y}`;if(index)arcLength+=Math.hypot(x-previousX,y-previousY);previousX=x;previousY=y;
    }
    // Forks grow from the filament, rather than being parallel copies of its spine.
    for(const step of [4,8]){
      const progress=step/12,envelope=Math.sin(progress*Math.PI);
      const offset=(side*spread*.43+Math.sin(step*2.7+lane*1.9)*12)*envelope;
      const sign=lane%2?1:-1,reach=14+(lane%3)*7;
      const points=[projection.point(progress,offset),projection.point(progress-.045,offset+sign*reach*.4),
        projection.point(progress-.10,offset+sign*reach*.3),projection.point(progress-.16,offset+sign*reach)];
      data+=' '+points.map(([x,y],index)=>`${index?'L':'M'}${x} ${y}`).join(' ');
      for(let index=1;index<points.length;index++)arcLength+=Math.hypot(points[index]![0]-points[index-1]![0],points[index]![1]-points[index-1]![1]);
    }
    arcs.push({path:data,length:Math.ceil(arcLength)});
  }
  let ribbon='';
  for(let side=0;side<2;side++)for(let step=0;step<=8;step++){
    const progress=(side?8-step:step)/8,offset=(side?-1:1)*Math.sin(progress*Math.PI)*spread;
    const x=Math.round(Math.max(0,Math.min(width,startX+ux*length*progress-uy*offset))*10)/10;
    const y=Math.round(Math.max(0,Math.min(height,startY+uy*length*progress+ux*offset))*10)/10;
    ribbon+=`${side===0&&step===0?'M':' L'}${x} ${y}`;
  }
  for(let index=0;index<3;index++){
    const progress=.23+index*.24;
    echoes.push({x:Math.max(0,Math.min(width-48,startX+ux*length*progress-24)),y:Math.max(0,Math.min(height-36,startY+uy*length*progress-18)),opacity:.12+index*.1});
  }
  for(let index=0;index<20;index++){
    const progress=.06+index*.044,offset=(index%2?1:-1)*(spread+9+(index%4)*4)*Math.sin(progress*Math.PI),size=index%3===0?4:2.5;
    sparks.push({x:Math.max(0,Math.min(width-size,startX+ux*length*progress-uy*offset)),y:Math.max(0,Math.min(height-size,startY+uy*length*progress+ux*offset)),size,driftX:-ux*14-uy*(index%2?1:-1)*18,driftY:-uy*14+ux*(index%2?1:-1)*18});
  }
  return {path,length:Math.ceil(measured),arcs,ribbon:ribbon+' Z',streamers,echoes,sparks};
}

/** A transparent attention outline can still fit when neither side has room for the sprite. */
export function fieldCompanionAttentionRect(bounds: BrowserBounds, width: number, height: number): BrowserBounds | undefined {
  if ([bounds.x, bounds.y, bounds.width, bounds.height, width, height].some(value => !Number.isFinite(value) || Math.abs(value) > 100_000)
    || width <= 0 || height <= 0 || bounds.width <= 0 || bounds.height <= 0 || bounds.x < 0 || bounds.y < 0
    || bounds.x + bounds.width > width || bounds.y + bounds.height > height) return;
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
}

/** Coordinates are already observed by the host. This does not discover or authorize a field. */
export function placeFieldCompanion(bounds: BrowserBounds, width: number, height: number): { x: number; y: number; facing: 'left' | 'right' } | undefined {
  const values = [bounds.x, bounds.y, bounds.width, bounds.height, width, height];
  if (values.some(value => !Number.isFinite(value) || Math.abs(value) > 100_000) || bounds.width <= 0 || bounds.height <= 0 || width < 60 || height < 40) return;
  if (bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.width > width || bounds.y + bounds.height > height) return;
  const y = Math.min(height - 36, Math.max(0, bounds.y + (bounds.height - 36) / 2));
  if (bounds.x + bounds.width + 54 <= width) return { x: bounds.x + bounds.width + 6, y, facing: 'right' };
  if (bounds.x >= 54) return { x: bounds.x - 54, y, facing: 'left' };
  // A narrow field has no safe neighbouring margin. Do not paint over its text or label.
  return;
}

// Original artwork adopted from apps/desktop/renderer/SpeedsterSprite.tsx (v0.10.1).
// Only fixed path/color data enters the remote document; no remote SVG, scripts or image requests.
const drawing = [
  ['trail', '#ef56524d', 'M2 13h16v2H2zM7 19h15v2H7zM1 26h20v2H1zM10 32h12v2H10z'],
  ['trail', '#ffd56a99', 'M6 16h16v2H6zM0 23h17v2H0zM5 30h17v2H5z'],
  ['trail', '#ffe39e', 'M19 9h6l-3 7h5l-9 11 3-9h-5z'],
  ['standing', '#251928', 'M29 28h14v10h2v5h-9v-9h-2v9h-9v-5h4z'],
  ['standing', '#e54142', 'M31 29h5v8h-2v3h-5v-2h2zM37 29h4v10h2v2h-5z'],
  ['standing', '#ffd56a', 'M29 37h5v4h-7v-2h2zM38 37h5v2h2v2h-7z'],
  ['run-a', '#251928', 'M31 28h12v5h-4v4h-9v3h-9v-6h10zM38 29h7v5h5v9h-8v-6h-6z'],
  ['run-a', '#e54142', 'M32 29h6v5h-9v3h-6v-2h9zM39 30h4v5h5v6h-4v-6h-7z'],
  ['run-a', '#ffd56a', 'M22 34h5v4h-6v-2h1zM44 38h4v2h3v2h-7z'],
  ['run-b', '#251928', 'M31 28h9v7h-7v8h-9v-6h4v-5h3zM38 29h7v4h9v7h-7v-4h-9z'],
  ['run-b', '#e54142', 'M32 30h5v3h-6v6h-5v-1h4v-5h2zM40 30h3v5h9v3h-4v-3h-8z'],
  ['run-b', '#ffd56a', 'M25 38h5v3h-6v-2h1zM49 34h3v3h3v2h-6z'],
  ['body', '#251928', 'M30 18h13v3h3v10H28V20h2zM27 21h4v11h-5v-8h1zM43 22h4v10h-4z'],
  ['body', '#e54142', 'M31 19h11v3h2v7H30v-8h1zM28 22h2v7h-2zM44 23h2v6h-2z'],
  ['body', '#a62438', 'M30 21h4v8h-4zM40 27h4v2h-4z'],
  ['body', '#ffd56a', 'M30 29h14v2H30zM29 28h3v2h-3zM27 29h3v2h-3zM44 29h2v2h-2z'],
  ['body', '#fff1cf', 'M35 21h6v6h-6z'],
  ['body', '#ffd56a', 'M38 20h3l-2 4h2l-5 5 1-4h-2z'],
  ['body', '#251928', 'M33 5h10v2h4v4h2v7h-4v3H32v-3h-3V9h2V7h2z'],
  ['body', '#e54142', 'M34 7h8v2h3v4h2v3h-3v3H33v-3h-2v-6h3z'],
  ['body', '#ff6b60', 'M34 7h8v2h-7v5h-3v-4h2z'],
  ['body', '#f2bd97', 'M38 15h8v2h-3v2h-6v-3h1z'],
  ['body', '#fff9e9', 'M39 11h6v2h-5v1h-1z'],
  ['body', '#251928', 'M42 16h3v1h-3z'],
  ['body', '#ffd56a', 'M29 9h3l-1 4h3l-6 7 1-5h-3zM44 6h2v3h-2z'],
  ['notice', '#251928', 'M50 1h10v11H50z'],
  ['notice', '#ffd56a', 'M51 2h8v9h-8zM52 11h3v3h-3z'],
  ['notice', '#251928', 'M54 3h2v4h-2zM54 8h2v2h-2z'],
] as const;

const style = `
:host{all:initial!important;display:block!important;position:fixed!important;left:0!important;top:0!important;width:0!important;height:0!important;margin:0!important;padding:0!important;border:0!important;overflow:visible!important;pointer-events:none!important;z-index:2147483647!important;opacity:1!important;visibility:visible!important;transform:none!important;user-select:none!important;contain:layout style!important}
*{box-sizing:border-box;pointer-events:none!important;user-select:none!important}
.runner{position:absolute;left:0;top:0;width:48px;height:36px;visibility:hidden;opacity:0;transform:translate3d(0,0,0);transition:transform 240ms cubic-bezier(.2,.8,.2,1),opacity 100ms linear;will-change:transform;}
.runner[data-visible=true]{visibility:visible;opacity:1}.runner svg{display:block;width:48px;height:36px;overflow:visible;image-rendering:pixelated;pointer-events:none}
.direction{transform-origin:32px 24px}.runner[data-facing=left] .direction{transform:scaleX(-1)}
.run-a,.run-b,.trail,.notice{display:none}.runner:is([data-phase=approach],[data-phase=typing]) .standing{display:none}.runner:is([data-phase=approach],[data-phase=typing]) :is(.run-a,.run-b,.trail){display:inline}
.runner:is([data-phase=approach],[data-phase=typing]) .run-a{animation:step-a 180ms steps(1,end) infinite}.runner:is([data-phase=approach],[data-phase=typing]) .run-b{animation:step-b 180ms steps(1,end) infinite}.runner:is([data-phase=approach],[data-phase=typing]) .trail{animation:trail 260ms steps(3,end) infinite}.runner[data-phase=verified] svg{animation:verified 500ms steps(3,end) 1}.runner[data-phase=attention] .notice{display:inline}
@keyframes step-a{0%,49.99%{opacity:1}50%,100%{opacity:0}}@keyframes step-b{0%,49.99%{opacity:0}50%,100%{opacity:1}}@keyframes trail{0%{opacity:.3;transform:translateX(-3px)}60%{opacity:.85;transform:translateX(1px)}100%{opacity:.3;transform:translateX(-3px)}}@keyframes verified{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
.runner[data-reduced=true],.runner[data-reduced=true] *{animation:none!important;transition:none!important;will-change:auto!important}.runner[data-reduced=true] :is(.run-a,.run-b,.trail){display:none!important}.runner[data-reduced=true] .standing{display:inline!important}
.attention{position:absolute;left:0;top:0;width:0;height:0;background:transparent;outline:2px solid #e9ae30;outline-offset:3px;border-radius:4px;box-shadow:0 0 0 1px #25192866;pointer-events:none!important;visibility:hidden;opacity:0;transition:opacity 350ms linear,visibility 0s linear 350ms}
.attention[data-visible=true]{visibility:visible;opacity:1;transition:opacity 100ms linear}.attention[data-reduced=true]{transition:none!important}
.electric-wake{position:fixed;left:0;top:0;width:100vw;height:100vh;overflow:hidden;pointer-events:none!important;visibility:hidden}
.electric-wake path{fill:none;stroke-linecap:round;stroke-linejoin:bevel;pointer-events:none!important}
.electric-wake .wake-haze{stroke:#ff711c;stroke-width:48;opacity:.3;filter:blur(12px)}
.electric-wake .wake-gold{stroke:#ffc446;stroke-width:13;filter:drop-shadow(0 0 8px #ff7629)}
.electric-wake .wake-core{stroke:#fff8dc;stroke-width:3.5}
.electric-wake .wake-arc{stroke:#ffdd79;stroke-width:3.5;filter:drop-shadow(0 0 2px #ff8025)}
.electric-wake .wake-arc:nth-of-type(even){stroke:#ff9341;stroke-width:4.5}
.electric-wake .wake-ribbon{fill:#ff872a;stroke:none;filter:blur(8px)}
.electric-wake .wake-streamer{fill:#ffc34d;stroke:none;filter:drop-shadow(0 0 5px #ff751e)}
.electric-wake .wake-streamer:nth-of-type(3n){fill:#fff4d2}
.electric-wake .wake-streamer:nth-of-type(3n + 1){fill:#ff8b2f}
.electric-wake .wake-spark{fill:#ffbd45;stroke:none;shape-rendering:crispEdges}
.electric-wake .wake-echo{filter:drop-shadow(0 0 3px #ff8c2d)}
@media(prefers-reduced-motion:reduce){.runner,.runner *,.attention{animation:none!important;transition:none!important;will-change:auto!important}.runner :is(.run-a,.run-b,.trail){display:none!important}.runner .standing{display:inline!important}}
@media(prefers-reduced-motion:reduce){.electric-wake{display:none!important}}
`;

interface DecorationCommand {
  key: string; token: string; sequence: number; operation: 'bootstrap' | 'show' | 'clear';
  target?: FieldCompanionTarget; reducedMotion?: boolean; css?: string; drawing?: typeof drawing;
}

/** Executed in an isolated world. It has DOM access, no preload, Node, IPC, selectors or field values. */
function decorate(command: DecorationCommand, place: typeof placeFieldCompanion, attentionRect: typeof fieldCompanionAttentionRect, wake:typeof fieldCompanionTrail): boolean {
  const globals = globalThis as unknown as Record<string, any>;
  const previous = globals[command.key];
  if (previous && previous.sequence > command.sequence) return false;
  if (command.operation === 'bootstrap') {
    if (previous?.attentionTimer) clearTimeout(previous.attentionTimer);
    previous?.host?.remove();
    globals[command.key] = { token: command.token, sequence: command.sequence };
    return true;
  }
  if (previous && previous.token !== command.token) return false;
  if (command.operation === 'clear') {
    if (previous) { previous.sequence = command.sequence; if (previous.attentionTimer) clearTimeout(previous.attentionTimer);
      previous.attentionTimer = undefined; previous.host?.remove(); previous.host = undefined; previous.runner = undefined; previous.root = undefined; previous.attention = undefined; previous.wake=undefined;previous.wakePaths=undefined;previous.wakeNodes=undefined;previous.wakeRibbon=undefined;previous.wakeStreamers=undefined;previous.wakeEchoes=undefined;previous.wakeSparks=undefined;previous.position=undefined; }
    return true;
  }
  if (!previous || previous.token !== command.token || !command.target) return false;
  previous.sequence = command.sequence;
  const position = place(command.target.bounds, innerWidth, innerHeight);
  const highlight = command.target.phase === 'attention' ? attentionRect(command.target.bounds, innerWidth, innerHeight) : undefined;
  if (previous.attentionTimer) { clearTimeout(previous.attentionTimer); previous.attentionTimer = undefined; }
  if ((!position && !highlight) || !document.body) {
    if (previous.runner) previous.runner.dataset.visible = 'false';
    if (previous.attention) previous.attention.dataset.visible = 'false';
    for(const node of previous.wakeNodes??[])for(const animation of node.getAnimations())animation.cancel();
    if(previous.wake)previous.wake.style.visibility='hidden';
    return false;
  }
  if (!previous.host?.isConnected || previous.host.parentNode !== document.body) {
    previous.host?.remove();
    const host = document.createElement('offeragent-field-companion');
    host.setAttribute('aria-hidden', 'true'); host.setAttribute('inert', '');
    host.style.cssText = 'all:initial!important;display:block!important;position:fixed!important;left:0!important;top:0!important;width:0!important;height:0!important;margin:0!important;padding:0!important;border:0!important;overflow:visible!important;pointer-events:none!important;z-index:2147483647!important;opacity:1!important;visibility:visible!important;transform:none!important;user-select:none!important;contain:layout style!important';
    const root = host.attachShadow({ mode: 'closed' });
    const css = document.createElement('style'); css.textContent = command.css ?? ''; root.append(css);
    const runner = document.createElement('div'); runner.className = 'runner'; runner.setAttribute('aria-hidden', 'true'); runner.setAttribute('inert', '');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 64 48'); svg.setAttribute('shape-rendering', 'crispEdges'); svg.setAttribute('focusable', 'false'); svg.setAttribute('aria-hidden', 'true');
    const direction = document.createElementNS('http://www.w3.org/2000/svg', 'g'); direction.setAttribute('class', 'direction');
    for (const [name, color, data] of command.drawing ?? []) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', name); path.setAttribute('fill', color); path.setAttribute('d', data); direction.append(path);
    }
    svg.append(direction); runner.append(svg);
    const attention = document.createElement('div'); attention.className = 'attention'; attention.setAttribute('aria-hidden', 'true'); attention.setAttribute('inert', '');
    const electric=document.createElementNS('http://www.w3.org/2000/svg','svg');electric.setAttribute('class','electric-wake');electric.setAttribute('aria-hidden','true');electric.setAttribute('focusable','false');
    const ribbon=document.createElementNS('http://www.w3.org/2000/svg','path');ribbon.setAttribute('class','wake-ribbon');electric.append(ribbon);
    const streamers=[];for(let index=0;index<7;index++){const strip=document.createElementNS('http://www.w3.org/2000/svg','path');strip.setAttribute('class','wake-streamer');electric.append(strip);streamers.push(strip);}
    const wakePaths=['wake-haze','wake-gold','wake-core',...Array(5).fill('wake-arc')].map(name=>{const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('class',name);electric.append(path);return path;});
    const echoes=[];
    for(let index=0;index<3;index++){
      const echo=document.createElementNS('http://www.w3.org/2000/svg','g');echo.setAttribute('class','wake-echo');
      for(const [name,color,data] of command.drawing??[]){if(['standing','run-b','notice','trail'].includes(name))continue;
        const part=document.createElementNS('http://www.w3.org/2000/svg','path');part.style.fill=color;part.setAttribute('d',data);echo.append(part);}
      electric.append(echo);echoes.push(echo);
    }
    const sparks=[];for(let index=0;index<20;index++){const spark=document.createElementNS('http://www.w3.org/2000/svg','path');spark.setAttribute('class','wake-spark');electric.append(spark);sparks.push(spark);}
    root.append(electric,attention, runner); document.body.append(host);
    previous.host = host; previous.root = root; previous.runner = runner; previous.attention = attention;
    previous.wake=electric;previous.wakePaths=wakePaths;previous.wakeRibbon=ribbon;previous.wakeStreamers=streamers;previous.wakeEchoes=echoes;previous.wakeSparks=sparks;previous.wakeNodes=[...wakePaths,ribbon,...streamers,...echoes,...sparks];previous.position=undefined;
  }
  const reduced=command.reducedMotion||matchMedia('(prefers-reduced-motion:reduce)').matches;
  const moving=['approach','typing'].includes(command.target.phase);
  const shape=moving&&!reduced&&position&&previous.position?wake({x:previous.position.x+24,y:previous.position.y+18},{x:position.x+24,y:position.y+18},innerWidth,innerHeight):undefined;
  if(previous.wake&&(reduced||!moving)){for(const path of previous.wakeNodes??[])for(const animation of path.getAnimations())animation.cancel();previous.wake.style.visibility='hidden';}
  if(shape&&previous.wake){
    previous.wake.setAttribute('viewBox',`0 0 ${innerWidth} ${innerHeight}`);previous.wake.style.visibility='visible';
    for(const node of previous.wakeNodes)for(const animation of node.getAnimations())animation.cancel();
    for(let index=0;index<previous.wakePaths.length;index++){
      const path=previous.wakePaths[index],arc=index<3?shape:shape.arcs[index-3];if(!arc)continue;
      path.setAttribute('d',arc.path);path.style.strokeDasharray=String(arc.length);path.style.strokeDashoffset=String(arc.length);
      const peak=index===0?.3:index===1?.85:.95;
      path.animate([{strokeDashoffset:String(arc.length),opacity:0},{strokeDashoffset:String(arc.length*.2),opacity:peak,offset:.18},{strokeDashoffset:'0',opacity:peak*.8,offset:.46},{strokeDashoffset:'0',opacity:0}],{duration:720,easing:'linear',fill:'forwards'});
    }
    previous.wakeRibbon.setAttribute('d',shape.ribbon);
    previous.wakeRibbon.animate([{opacity:0},{opacity:.22,offset:.2},{opacity:0}],{duration:720,fill:'forwards'});
    for(let index=0;index<previous.wakeStreamers.length;index++){
      const node=previous.wakeStreamers[index],strip=shape.streamers[index];if(!strip)continue;node.setAttribute('d',strip.path);
      node.animate([{opacity:0},{opacity:strip.opacity,offset:.16},{opacity:strip.opacity*.75,offset:.38},
        {opacity:strip.opacity*.84,offset:.46},{opacity:0,offset:.9},{opacity:0}],{duration:720,fill:'forwards'});
    }
    for(let index=0;index<previous.wakeEchoes.length;index++){
      const node=previous.wakeEchoes[index],echo=shape.echoes[index];if(!echo)continue;node.setAttribute('transform',`translate(${echo.x} ${echo.y}) scale(.75)`);
      node.animate([{opacity:0},{opacity:echo.opacity,offset:.12},{opacity:echo.opacity*.6,offset:.45},{opacity:0}],{duration:720,fill:'forwards'});
    }
    for(let index=0;index<previous.wakeSparks.length;index++){
      const node=previous.wakeSparks[index],spark=shape.sparks[index];if(!spark)continue;node.setAttribute('d',`M${spark.x} ${spark.y}h${spark.size}v${spark.size}h-${spark.size}Z`);
      node.animate([{opacity:0,transform:'translate(0,0)'},{opacity:.9,offset:.22},{opacity:0,transform:`translate(${spark.driftX}px,${spark.driftY}px)`}],{duration:720,fill:'forwards'});
    }
  }
  const runner = previous.runner as HTMLDivElement;
  runner.dataset.phase = command.target.phase;
  runner.dataset.facing = position?.facing ?? 'right';
  runner.dataset.reduced = command.reducedMotion ? 'true' : 'false';
  runner.dataset.visible = position ? 'true' : 'false';
  if (position) runner.style.transform = `translate3d(${position.x}px,${position.y}px,0)`;
  const attention = previous.attention as HTMLDivElement;
  attention.dataset.visible = highlight ? 'true' : 'false'; attention.dataset.reduced = command.reducedMotion ? 'true' : 'false';
  if (highlight) {
    attention.style.transform = `translate3d(${highlight.x}px,${highlight.y}px,0)`;
    attention.style.width = `${highlight.width}px`; attention.style.height = `${highlight.height}px`;
    // Fixed host-owned decoration timer; no page handlers, input events or field changes.
    previous.attentionTimer = setTimeout(() => {
      if (previous.attention === attention) attention.dataset.visible = 'false';
      previous.attentionTimer = undefined;
    }, 2200);
  }
  // Useful only to a host-owned isolated test; no DOM markers contain user data or capabilities.
  previous.position = position;
  return true;
}

/** Optional, fail-closed decoration. None of these operations focus, scroll, click or write a form. */
export class FieldCompanion {
  private readonly key = `__offeragentFieldCompanion_${randomUUID().replaceAll('-', '')}`;
  private token = randomUUID();
  private sequence = 0;
  private revision = 0;
  private bootstrapped = false;
  private enabled = true;
  private reducedMotion = false;
  private disposed = false;
  private pending: Promise<void> = Promise.resolve();
  private readonly navigating = (_event: unknown, _url: string, _inPlace: boolean, mainFrame: boolean) => {
    if (!mainFrame) return;
    this.revision++; this.bootstrapped = false;
    void this.clear();
  };
  private readonly destroyed = () => { this.disposed = true; this.revision++; };

  constructor(private readonly contents: Pick<WebContents, 'isDestroyed' | 'executeJavaScriptInIsolatedWorld' | 'on' | 'removeListener'>) {
    contents.on('did-start-navigation', this.navigating);
    contents.on('destroyed', this.destroyed);
  }

  setEnabled(enabled: boolean, reducedMotion = this.reducedMotion): Promise<void> {
    const changed=this.reducedMotion!==(reducedMotion===true);
    this.enabled = enabled === true; this.reducedMotion = reducedMotion === true;
    return this.enabled&&!changed ? Promise.resolve() : this.clear();
  }

  show(target: FieldCompanionTarget): Promise<void> {
    if (!this.enabled || this.disposed || !['approach', 'typing', 'verified', 'attention'].includes(target.phase)
      || !target.bounds || Object.values(target.bounds).some(value => !Number.isFinite(value))) return Promise.resolve();
    const snapshot = { phase: target.phase, bounds: { x: target.bounds.x, y: target.bounds.y, width: target.bounds.width, height: target.bounds.height } };
    const revision = this.revision;
    return this.enqueue(async () => {
      if (!this.enabled || this.disposed || revision !== this.revision || this.contents.isDestroyed()) return;
      if (!this.bootstrapped) {
        this.token = randomUUID();
        if (!await this.execute({ operation: 'bootstrap' })) return;
        if (this.disposed || revision !== this.revision || !this.enabled) return;
        this.bootstrapped = true;
      }
      await this.execute({ operation: 'show', target: snapshot, reducedMotion: this.reducedMotion, css: style, drawing });
    });
  }

  clear(): Promise<void> {
    this.revision++;
    return this.enqueue(async () => { if (!this.contents.isDestroyed()) await this.execute({ operation: 'clear' }); });
  }

  dispose(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.disposed = true; this.revision++;
    this.contents.removeListener('did-start-navigation', this.navigating);
    this.contents.removeListener('destroyed', this.destroyed);
    return this.clear();
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    this.pending = this.pending.then(operation).catch(() => { this.bootstrapped = false; });
    return this.pending;
  }

  private async execute(command: Omit<DecorationCommand, 'key' | 'token' | 'sequence'>): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const execution = this.contents.executeJavaScriptInIsolatedWorld(FIELD_COMPANION_WORLD_ID, [{ code:
        `/* offeragent-field-companion */ (${decorate.toString()})(${JSON.stringify({ ...command, key: this.key, token: this.token, sequence: ++this.sequence })},${placeFieldCompanion.toString()},${fieldCompanionAttentionRect.toString()},${fieldCompanionTrail.toString()})` }], false);
      // A busy/unresponsive renderer must not hold a form operation for an optional animation.
      return await Promise.race([execution.then(value => value === true, () => false), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 200); })]);
    } finally { if (timer) clearTimeout(timer); }
  }
}
