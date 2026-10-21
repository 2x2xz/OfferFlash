import './PixelGuide.css';

/** Fixed decorative artwork. It never owns a click target, focus, or page input. */
export function PixelArrow({direction='right',className=''}:{direction?:'right'|'down'|'left';className?:string}) {
 return <span className={`pixel-guide-arrow ${className}`} data-direction={direction} aria-hidden="true"><svg viewBox="0 0 32 32" fill="none" shapeRendering="crispEdges" focusable="false"><path className="pixel-arrow-shadow" d="M2 14h14V6h4v4h4v4h4v4h-4v4h-4v4h-4v-8H2z"/><path d="M0 12h16V4h4v4h4v4h4v4h-4v4h-4v4h-4v-8H0z" fill="currentColor"/><path d="M3 12h9v2H3zM17 7h2v5h-2z" fill="#ffffff" fillOpacity=".65"/></svg></span>;
}
