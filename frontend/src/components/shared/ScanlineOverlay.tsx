import { CSSProperties } from 'react';

/**
 * Props for the ScanlineOverlay component.
 */
interface ScanlineOverlayProps {
  /** Opacity of scanlines (0-1). Default: 0.1 */
  opacity?: number;
  /** Height of each scanline in pixels. Default: 2 */
  lineHeight?: number;
  /** Whether to animate the scanlines scrolling. Default: false */
  animated?: boolean;
  /** Optional CSS class name */
  className?: string;
}

/**
 * CRT-style scanline overlay effect.
 * Creates horizontal lines across the viewport for retro terminal aesthetics.
 * Can be animated for a scrolling effect.
 */
const ScanlineOverlay = ({
  opacity = 0.1,
  lineHeight = 2,
  animated = false,
  className = '',
}: ScanlineOverlayProps) => {
  const containerStyle: CSSProperties = {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    zIndex: 9999,
    overflow: 'hidden',
  };

  const scanlineStyle: CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: animated ? '200%' : '100%',
    background: `repeating-linear-gradient(
      0deg,
      transparent,
      transparent ${lineHeight}px,
      rgba(0, 0, 0, ${opacity}) ${lineHeight}px,
      rgba(0, 0, 0, ${opacity}) ${lineHeight * 2}px
    )`,
    animation: animated ? 'scanline-scroll 8s linear infinite' : 'none',
  };

  return (
    <>
      {animated && (
        <style>{`
          @keyframes scanline-scroll {
            0% { transform: translateY(0); }
            100% { transform: translateY(-50%); }
          }
        `}</style>
      )}
      <div className={`scanline-overlay ${className}`} style={containerStyle}>
        <div style={scanlineStyle} />
      </div>
    </>
  );
};

export default ScanlineOverlay;
