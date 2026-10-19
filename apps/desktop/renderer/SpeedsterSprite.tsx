import './SpeedsterSprite.css';

export type SpeedsterState = 'idle' | 'sprint' | 'brake' | 'return' | 'attention' | 'celebrate';

export interface SpeedsterSpriteProps {
  state: SpeedsterState;
  facing?: 'left' | 'right';
  className?: string;
}

/** Original pixel drawing. Its animation reflects activity, never a measured speed or a submission. */
export function SpeedsterSprite({ state, facing = 'right', className = '' }: SpeedsterSpriteProps) {
  return <svg viewBox="0 0 64 48" className={`speedster-sprite ${className}`.trim()}
    data-speedster-state={state} data-facing={facing} shapeRendering="crispEdges" aria-hidden="true" focusable="false">
    <g className="speedster-direction">
      <g className="speedster-trail">
        <path className="speedster-trail-ember" d="M2 13h16v2H2zM7 19h15v2H7zM1 26h20v2H1zM10 32h12v2H10z" />
        <path className="speedster-trail-gold" d="M6 16h16v2H6zM0 23h17v2H0zM5 30h17v2H5z" />
        <path className="speedster-trail-bolt" d="M19 9h6l-3 7h5l-9 11 3-9h-5zM10 34h6l-2 4h4l-7 6 1-6H8z" />
      </g>
      <path className="speedster-shadow" d="M21 44h30v2H21zM18 43h36v1H18z" />
      <g className="speedster-hero">
        <g className="speedster-standing-legs">
          <path className="speedster-outline" d="M29 28h14v10h2v5h-9v-9h-2v9h-9v-5h4z" />
          <path className="speedster-red-dark" d="M31 29h5v8h-2v3h-5v-2h2z" />
          <path className="speedster-red" d="M37 29h4v10h2v2h-5z" />
          <path className="speedster-gold" d="M29 37h5v4h-7v-2h2zM38 37h5v2h2v2h-7z" />
        </g>
        <g className="speedster-running-legs speedster-frame-a">
          <path className="speedster-outline" d="M31 28h12v5h-4v4h-9v3h-9v-6h10zM38 29h7v5h5v9h-8v-6h-6z" />
          <path className="speedster-red-dark" d="M32 29h6v5h-9v3h-6v-2h9z" />
          <path className="speedster-red" d="M39 30h4v5h5v6h-4v-6h-7z" />
          <path className="speedster-gold" d="M22 34h5v4h-6v-2h1zM44 38h4v2h3v2h-7z" />
        </g>
        <g className="speedster-running-legs speedster-frame-b">
          <path className="speedster-outline" d="M31 28h9v7h-7v8h-9v-6h4v-5h3zM38 29h7v4h9v7h-7v-4h-9z" />
          <path className="speedster-red-dark" d="M32 30h5v3h-6v6h-5v-1h4v-5h2z" />
          <path className="speedster-red" d="M40 30h3v5h9v3h-4v-3h-8z" />
          <path className="speedster-gold" d="M25 38h5v3h-6v-2h1zM49 34h3v3h3v2h-6z" />
        </g>
        <g className="speedster-upper">
          <path className="speedster-outline" d="M30 18h13v3h3v10H28V20h2z" />
          <path className="speedster-red" d="M31 19h11v3h2v7H30v-8h1z" />
          <path className="speedster-red-dark" d="M30 21h4v8h-4zM40 27h4v2h-4z" />
          <path className="speedster-gold" d="M30 29h14v2H30zM29 28h3v2h-3z" />
          <path className="speedster-cream" d="M35 21h6v6h-6z" />
          <path className="speedster-gold" d="M38 20h3l-2 4h2l-5 5 1-4h-2z" />
          <g className="speedster-resting-arms">
            <path className="speedster-outline" d="M27 21h4v11h-5v-8h1zM43 22h4v10h-4z" />
            <path className="speedster-red-dark" d="M28 22h2v7h-2z" />
            <path className="speedster-red" d="M44 23h2v6h-2z" />
            <path className="speedster-gold" d="M27 29h3v2h-3zM44 29h2v2h-2z" />
          </g>
          <g className="speedster-running-arms speedster-frame-a">
            <path className="speedster-outline" d="M29 20h5v6h-9v-7h4zM42 21h5v7h6v5h-11z" />
            <path className="speedster-red-dark" d="M29 21h3v3h-5v-4h2z" />
            <path className="speedster-red" d="M44 22h2v7h6v2h-8z" />
            <path className="speedster-gold" d="M25 19h3v4h-3zM49 29h3v2h-3z" />
          </g>
          <g className="speedster-running-arms speedster-frame-b">
            <path className="speedster-outline" d="M28 21h6v11h-9v-5h3zM42 20h6v-5h5v10H42z" />
            <path className="speedster-red-dark" d="M29 22h3v8h-6v-2h3z" />
            <path className="speedster-red" d="M43 21h7v-5h2v7h-9z" />
            <path className="speedster-gold" d="M26 28h3v2h-3zM49 16h3v3h-3z" />
          </g>
          <g className="speedster-celebration-arms">
            <path className="speedster-outline" d="M29 19h4v7h-7v-7h-4v-6h5v5h2zM42 20h5v-5h4v-6h5v8h-5v8h-9z" />
            <path className="speedster-red" d="M30 20h2v4h-5v-6h-3v-3h2v5h4zM44 21h4v-5h4v-6h2v6h-4v7h-6z" />
            <path className="speedster-gold" d="M23 14h3v3h-3zM52 10h2v3h-2z" />
          </g>
          <g className="speedster-head">
            <path className="speedster-outline" d="M33 5h10v2h4v4h2v7h-4v3H32v-3h-3V9h2V7h2z" />
            <path className="speedster-red" d="M34 7h8v2h3v4h2v3h-3v3H33v-3h-2v-6h3z" />
            <path className="speedster-red-light" d="M34 7h8v2h-7v5h-3v-4h2z" />
            <path className="speedster-skin" d="M38 15h8v2h-3v2h-6v-3h1z" />
            <path className="speedster-eye" d="M39 11h6v2h-5v1h-1z" />
            <path className="speedster-outline" d="M42 16h3v1h-3z" />
            <path className="speedster-gold" d="M29 9h3l-1 4h3l-6 7 1-5h-3zM44 6h2v3h-2z" />
          </g>
        </g>
      </g>
      <g className="speedster-skid"><path className="speedster-dust" d="M14 40h5v2h-5zM20 42h5v2h-5zM11 43h4v2h-4z" /><path className="speedster-gold" d="M23 44h28v1H23z" /></g>
      <g className="speedster-attention"><path className="speedster-outline" d="M50 1h10v11H50z" /><path className="speedster-gold" d="M51 2h8v9h-8zM52 11h3v3h-3z" /><path className="speedster-outline" d="M54 3h2v4h-2zM54 8h2v2h-2z" /></g>
      <g className="speedster-confetti"><path className="speedster-gold" d="M22 5h2v2h2v2h-2v2h-2V9h-2V7h2zM56 23h2v2h2v2h-2v2h-2v-2h-2v-2h2z" /><path className="speedster-red-light" d="M16 19h3v2h-3zM49 1h2v3h-2zM57 33h2v3h-2z" /></g>
    </g>
  </svg>;
}
