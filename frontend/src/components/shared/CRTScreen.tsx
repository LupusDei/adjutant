import { ReactNode, useEffect, useState } from 'react';
import './CRTScreen.css';

interface CRTScreenProps {
  children: ReactNode;
  /** Enable boot sequence animation on mount */
  showBootSequence?: boolean;
  /** Enable screen flicker effect */
  enableFlicker?: boolean;
  /** Enable scanline animation */
  enableScanlines?: boolean;
  /** Enable screen noise */
  enableNoise?: boolean;
}

/**
 * Authentic CRT screen wrapper that provides:
 * - Phosphor glow and bloom
 * - Screen curvature distortion
 * - Animated scanlines
 * - Subtle flicker
 * - Vignette darkening at edges
 * - Optional boot sequence
 */
export function CRTScreen({
  children,
  showBootSequence = true,
  enableFlicker = true,
  enableScanlines = true,
  enableNoise = true,
}: CRTScreenProps) {
  const [isBooting, setIsBooting] = useState(showBootSequence);
  const [bootPhase, setBootPhase] = useState(0);

  useEffect(() => {
    if (!showBootSequence) return;

    // Boot sequence phases
    const phases = [
      { delay: 0, duration: 300 },      // Screen warm-up flash
      { delay: 300, duration: 500 },    // Phosphor activation
      { delay: 800, duration: 400 },    // System init text
      { delay: 1200, duration: 300 },   // Final stabilization
    ];

    phases.forEach((phase, index) => {
      setTimeout(() => setBootPhase(index + 1), phase.delay);
    });

    // End boot sequence
    setTimeout(() => setIsBooting(false), 1500);
  }, [showBootSequence]);

  return (
    <div className="crt-monitor">
      {/* Outer monitor bezel */}
      <div className="crt-bezel">
        {/* Screen glass with curvature */}
        <div className={`crt-glass ${enableFlicker ? 'crt-flicker-active' : ''}`}>
          {/* Phosphor layer with glow */}
          <div className="crt-phosphor">
            {/* Content layer */}
            <div className={`crt-content ${isBooting ? 'crt-booting' : ''}`}>
              {isBooting ? (
                <BootSequence phase={bootPhase} />
              ) : (
                children
              )}
            </div>

            {/* Scanline overlay */}
            {enableScanlines && <div className="crt-scanlines" />}

            {/* Rolling scan bar */}
            {enableScanlines && <div className="crt-scan-bar" />}

            {/* Screen noise */}
            {enableNoise && <div className="crt-noise" />}

            {/* CRT curvature effect */}
            <div className="crt-curvature" />

            {/* Vignette effect */}
            <div className="crt-vignette" />

            {/* Screen reflection/glare */}
            <div className="crt-glare" />
          </div>
        </div>
      </div>
    </div>
  );
}

function BootSequence({ phase }: { phase: number }) {
  return (
    <div className="boot-sequence">
      {phase >= 1 && (
        <div className="boot-line boot-flash">
          <span className="boot-cursor">█</span>
        </div>
      )}
      {phase >= 2 && (
        <div className="boot-line">
          GASCO INDUSTRIES TERMLINK PROTOCOL
        </div>
      )}
      {phase >= 3 && (
        <div className="boot-line">
          INITIALIZING GASTOWN BOY v52.5...
        </div>
      )}
      {phase >= 4 && (
        <div className="boot-line boot-ready">
          &gt; SYSTEM READY_
        </div>
      )}
    </div>
  );
}

export default CRTScreen;
