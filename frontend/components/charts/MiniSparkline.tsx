// ── MiniSparkline — 순수 SVG 스파크라인 (recharts 의존 없음) ──────────────────

interface MiniSparklineProps {
  /** 렌더링할 숫자 배열 */
  data: number[];
  /** 라인 및 면적 색상 (기본: #3b82f6) */
  color?: string;
  /** SVG 높이 px (기본: 30) */
  height?: number;
  /** SVG 너비 px (기본: 80) */
  width?: number;
  /** 면적 채우기 투명도 (기본: 0.15) */
  fillOpacity?: number;
  /** 라인 두께 (기본: 1.5) */
  strokeWidth?: number;
}

export default function MiniSparkline({
  data,
  color = '#3b82f6',
  height = 30,
  width = 80,
  fillOpacity = 0.15,
  strokeWidth = 1.5,
}: MiniSparklineProps) {
  // 데이터 없거나 1개 이하면 빈 SVG 반환
  if (!data || data.length < 2) {
    return <svg width={width} height={height} aria-hidden="true" />;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1; // 0 나눗셈 방지

  const pad = strokeWidth; // 라인이 잘리지 않도록 상하 패딩
  const innerH = height - pad * 2;

  // 데이터 포인트 → SVG 좌표 변환
  const points = data.map((v, i) => ({
    x: (i / (data.length - 1)) * width,
    y: pad + innerH - ((v - min) / range) * innerH,
  }));

  // polyline용 포인트 문자열
  const linePoints = points.map((p) => `${p.x},${p.y}`).join(' ');

  // 면적 채우기용 polygon 포인트 (하단 마감 포함)
  const areaPoints = [
    `0,${height}`,
    ...points.map((p) => `${p.x},${p.y}`),
    `${width},${height}`,
  ].join(' ');

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      style={{ display: 'block', overflow: 'visible' }}
    >
      {/* 면적 채우기 */}
      <polygon
        points={areaPoints}
        fill={color}
        fillOpacity={fillOpacity}
        stroke="none"
      />
      {/* 라인 */}
      <polyline
        points={linePoints}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 마지막 포인트 강조 도트 */}
      <circle
        cx={points[points.length - 1].x}
        cy={points[points.length - 1].y}
        r={strokeWidth + 0.5}
        fill={color}
      />
    </svg>
  );
}
