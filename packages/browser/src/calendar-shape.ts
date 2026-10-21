/** Numeric div grids used by modern component libraries. Recognition needs a
 * complete, unique month set or year grid and a calendar/picker owner. A random
 * page list of numbers never becomes a calendar. */
export const DIV_CALENDAR_HELPERS=String.raw`
 const numericCalendarCells=root=>Array.from(root.querySelectorAll('div,span,td,[role="gridcell"]')).filter(selectVisible).filter(n=>/^(?:\d{4}年?|(?:0?[1-9]|1[0-2])月)$/.test(selectText(n))&&!Array.from(n.children).some(child=>selectVisible(child)&&selectText(child)===selectText(n))&&!n.closest('[disabled],[aria-disabled="true"],[class*="disabled" i]'));
 const divCalendarGrid=root=>{
  const cells=numericCalendarCells(root),months=cells.filter(n=>/^(?:0?[1-9]|1[0-2])月$/.test(selectText(n))),years=cells.filter(n=>/^\d{4}年?$/.test(selectText(n)));
  const unique=nodes=>new Set(nodes.map(n=>Number(selectText(n).replace(/[年月]/g,'')))).size===nodes.length;
  if(months.length===12&&unique(months)&&years.length===1)return {mode:'month',cells:months,header:years[0]};
  if(months.length===0&&years.length>=4&&years.length<=25){
   // A visible year heading can repeat one year inside the choice grid. Find
   // the actual common grid rather than counting the heading as a second cell.
   const grids=[];
   for(const cell of years)for(let p=cell.parentElement;p&&root.contains(p);p=p.parentElement){
    const contained=years.filter(node=>p.contains(node));if(contained.length>=4&&contained.length<=24&&unique(contained))grids.push(contained);
    if(p===root)break;
   }
   const size=Math.max(0,...grids.map(grid=>grid.length)),best=grids.filter(grid=>grid.length===size);
   if(best.length&&best.every(grid=>grid.every(node=>best[0].includes(node))))return {mode:'year',cells:best[0]};
  }
  return null;
 };
 const divCalendarRoots=root=>{
  const roots=[];
  for(const node of Array.from(root.querySelectorAll('[class*="calendar" i],[class*="picker" i]')).filter(selectVisible)){
   for(let p=node;p&&!['BODY','HTML','FORM','MAIN'].includes(p.tagName);p=p.parentElement){
    if(!['absolute','fixed'].includes(getComputedStyle(p).position)||p.querySelector('input[type="password"],input[type="file"],button[type="submit"]'))continue;
    if(divCalendarGrid(p))roots.push(p);
   }
  }
  return Array.from(new Set(roots)).filter(n=>!roots.some(parent=>parent!==n&&parent.contains(n)));
 };
`;
