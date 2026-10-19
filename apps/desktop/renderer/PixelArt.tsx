/** Original vector sprites stay crisp at desktop scale; no external image request. */
export function PixelMark({ className = '' }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true" shapeRendering="crispEdges"><path fill="currentColor" d="M4 2h16v4h4v14h-4v4H4v-4H0V6h4V2Zm2 4v12h12V6H6Z" /><path fill="currentColor" d="M10 9h7v7h-3v-3l-5 5-3-3 5-5h-1V9Z" /></svg>;
}

export function MissionSprite() {
  return <div className="mission-sprite" aria-hidden="true"><div className="sprite-topline"><span>OA / FLIGHT SYSTEM</span><span>01</span></div>
    <svg viewBox="0 0 280 190" fill="none" shapeRendering="crispEdges">
      <defs><pattern id="mission-grid" width="14" height="14" patternUnits="userSpaceOnUse"><path d="M14 0H0V14" stroke="currentColor" strokeOpacity=".08" /></pattern></defs>
      <path fill="url(#mission-grid)" d="M0 0h280v190H0z" />
      <g stroke="currentColor" strokeOpacity=".2"><path d="M14 36V14h28M238 14h28v22M266 154v22h-28M42 176H14v-22M0 95h280M140 0v190" /><path d="M84 39h112v14h14v84h-14v14H84v-14H70V53h14V39Z" /></g>
      <g fill="currentColor"><path opacity=".12" d="M105 49h70v14h14v70h-14v14h-70v-14H91V63h14V49Z" />
        <path d="M119 49h56v14h14v56h-14V77h-14v14h-14v14h-14v14h-14v14h-14v-14H91v-14h14V91h14V77h14V63h-14V49Z" />
        <path opacity=".4" d="M77 133h14v14H77zM63 147h14v14H63zM49 161h14v14H49z" />
        <path d="M231 67h7V53h7v14h7v7h-7v14h-7V74h-7zM42 49h7v7h7v7h-7v7h-7v-7h-7v-7h7z" />
        <path opacity=".4" d="M224 140h7v7h-7zM203 154h7v7h-7zM63 28h7v7h-7z" />
      </g>
    </svg><div className="sprite-bottomline"><span><i />READY FOR YOUR NEXT MOVE</span><span>↗</span></div>
  </div>;
}
