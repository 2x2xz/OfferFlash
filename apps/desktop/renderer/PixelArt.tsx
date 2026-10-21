/** Original vector sprites stay crisp at desktop scale; no external image request. */
export function PixelMark({ className = '' }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true" shapeRendering="crispEdges"><path fill="currentColor" d="M4 2h16v4h4v14h-4v4H4v-4H0V6h4V2Zm2 4v12h12V6H6Z" /><path fill="currentColor" d="M10 9h7v7h-3v-3l-5 5-3-3 5-5h-1V9Z" /></svg>;
}

export function MissionSprite() {
  return <div className="mission-sprite" aria-hidden="true">
    <svg className="mission-lightning" viewBox="0 0 280 190" fill="none" shapeRendering="crispEdges">
      <defs><pattern id="mission-grid" width="14" height="14" patternUnits="userSpaceOnUse"><path d="M14 0H0V14" stroke="#7765df" strokeOpacity=".07" /></pattern></defs>
      <path fill="url(#mission-grid)" d="M0 0h280v190H0z" />
      <path fill="#e2ddff" d="M100 22h84v14h14v14h14v84h-14v14h-14v14h-84v-14H86v-14H72V50h14V36h14z" />
      <path fill="#eeeaff" d="M108 30h68v14h14v14h14v68h-14v14h-14v14h-68v-14H94v-14H80V58h14V44h14z" />
      <g className="mission-bolt">
        <path fill="#c6b9f3" d="M144 25h56v16h-16v16h-16v16h-8v8h32v16h-16v16h-16v16h-16v16h-16v16h-16v16H88v-24h8v-16h8v-16H80V97h16V81h16V65h8V49h8V33h16z" transform="translate(5 6)" />
        <path fill="#5145c7" d="M144 20h56v16h-16v16h-16v16h-8v8h32v16h-16v16h-16v16h-16v16h-16v16h-16v16H88v-24h8v-16h8v-16H80V92h16V76h16V60h8V44h8V28h16z" />
        <path fill="#ffd56b" d="M144 28h40v8h-16v16h-16v16h-8v16h32v8h-16v16h-16v16h-16v16h-16v16h-8v-8h8v-16h8v-24H96v-8h8V84h16V68h8V52h8V36h8z" />
        <path fill="#fff9df" d="M144 28h16v8h-16v16h-8v16h-8v16h-8v16h-16v-8h8V76h8V60h8V44h8V28zM128 108h16v8h-16v16h-8v8h-8v-8h8v-16h8z" />
      </g>
      <g fill="#8e7de2"><path d="M42 54h8v8h8v8h-8v8h-8v-8h-8v-8h8zM226 114h8v8h8v8h-8v8h-8v-8h-8v-8h8z" /><path opacity=".5" d="M66 136h8v8h-8zM54 148h8v8h-8zM210 38h8v8h-8z" /></g>
      <g fill="#eab44f"><path d="M214 61h8v-8h8v8h8v8h-8v8h-8v-8h-8zM50 110h8v8h-8z" /></g>
    </svg>
  </div>;
}
