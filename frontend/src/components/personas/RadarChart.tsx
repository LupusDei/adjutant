/**
 * Inline SVG 4-point radar chart for persona roster cards.
 *
 * Axes: ENG (top), QUA (right), CRF (bottom), PRD (left).
 * Each axis value is the max of its trait group, normalized to 0-1.
 *
 * Design spec: adj-bpxp
 */
import type { TraitValues } from '../../types';
import { PersonaTrait, TRAIT_MAX } from '../../types';

interface RadarChartProps {
  traits: TraitValues;
  /** SVG width/height in pixels. */
  size?: number;
}

/** Compute the 4-axis values from trait groups. */
function computeAxes(traits: TraitValues): { eng: number; qua: number; prd: number; crf: number } {
  const max = (vals: number[]) => Math.max(...vals) / TRAIT_MAX;
  return {
    eng: max([
      traits[PersonaTrait.ARCHITECTURE_FOCUS],
      traits[PersonaTrait.MODULAR_ARCHITECTURE],
      traits[PersonaTrait.TECHNICAL_DEPTH],
    ]),
    qua: max([
      traits[PersonaTrait.QA_CORRECTNESS],
      traits[PersonaTrait.QA_SCALABILITY],
      traits[PersonaTrait.TESTING_UNIT],
      traits[PersonaTrait.TESTING_ACCEPTANCE],
    ]),
    prd: max([
      traits[PersonaTrait.PRODUCT_DESIGN],
      traits[PersonaTrait.UIUX_FOCUS],
      traits[PersonaTrait.BUSINESS_OBJECTIVES],
    ]),
    crf: max([
      traits[PersonaTrait.CODE_REVIEW],
      traits[PersonaTrait.DOCUMENTATION],
    ]),
  };
}

export function RadarChart({ traits, size = 80 }: RadarChartProps) {
  const axes = computeAxes(traits);
  const cx = size / 2;
  const cy = size / 2;
  const r = (size / 2) - 16; // leave room for labels

  // Diamond shape: top=ENG, right=QUA, bottom=CRF, left=PRD
  const points = [
    { x: cx, y: cy - r * Math.max(axes.eng, 0.08) },  // top (ENG)
    { x: cx + r * Math.max(axes.qua, 0.08), y: cy },  // right (QUA)
    { x: cx, y: cy + r * Math.max(axes.crf, 0.08) },  // bottom (CRF)
    { x: cx - r * Math.max(axes.prd, 0.08), y: cy },  // left (PRD)
  ];

  const shapePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + ' Z';

  // Reference diamond (outline at max)
  const refPoints = [
    { x: cx, y: cy - r },
    { x: cx + r, y: cy },
    { x: cx, y: cy + r },
    { x: cx - r, y: cy },
  ];
  const refPath = refPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + ' Z';

  const labelSize = 7;
  const labelOffset = r + 10;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      {/* Reference diamond outline */}
      <path
        d={refPath}
        fill="none"
        stroke="var(--crt-phosphor-dim)"
        strokeWidth="0.5"
        opacity="0.3"
      />
      {/* Cross axes */}
      <line x1={cx} y1={cy - r} x2={cx} y2={cy + r}
        stroke="var(--crt-phosphor-dim)" strokeWidth="0.5" opacity="0.2" />
      <line x1={cx - r} y1={cy} x2={cx + r} y2={cy}
        stroke="var(--crt-phosphor-dim)" strokeWidth="0.5" opacity="0.2" />
      {/* Data shape */}
      <path
        d={shapePath}
        fill="var(--crt-phosphor)"
        fillOpacity="0.15"
        stroke="var(--crt-phosphor)"
        strokeWidth="1.5"
        style={{ filter: 'drop-shadow(0 0 3px var(--crt-phosphor-glow))' }}
      />
      {/* Axis labels */}
      <text x={cx} y={cy - labelOffset} textAnchor="middle" dominantBaseline="auto"
        fill="var(--crt-phosphor-dim)" fontSize={labelSize} fontFamily="'Share Tech Mono', monospace">
        ENG
      </text>
      <text x={cx + labelOffset} y={cy} textAnchor="start" dominantBaseline="middle"
        fill="var(--crt-phosphor-dim)" fontSize={labelSize} fontFamily="'Share Tech Mono', monospace">
        QUA
      </text>
      <text x={cx} y={cy + labelOffset} textAnchor="middle" dominantBaseline="hanging"
        fill="var(--crt-phosphor-dim)" fontSize={labelSize} fontFamily="'Share Tech Mono', monospace">
        CRF
      </text>
      <text x={cx - labelOffset} y={cy} textAnchor="end" dominantBaseline="middle"
        fill="var(--crt-phosphor-dim)" fontSize={labelSize} fontFamily="'Share Tech Mono', monospace">
        PRD
      </text>
    </svg>
  );
}
