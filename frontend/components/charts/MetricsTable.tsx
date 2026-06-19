import type { ModelMetrics } from "@/types";
import { formatNumber, formatPercent } from "@/lib/utils";

interface MetricsTableProps {
  metrics: ModelMetrics;
}

export function MetricsTable({ metrics }: MetricsTableProps) {
  const rows = [
    {
      label: "MAE",
      value: formatNumber(metrics.mae, 3),
      description: "평균 절대 오차 (낮을수록 좋음)",
    },
    {
      label: "RMSE",
      value: formatNumber(metrics.rmse, 3),
      description: "평균 제곱근 오차 (낮을수록 좋음)",
    },
    {
      label: "R²",
      value: formatNumber(metrics.r2, 3),
      description: "결정계수 (1에 가까울수록 좋음)",
    },
    {
      label: "MAPE",
      value: formatPercent(metrics.mape, 2),
      description: "평균 절대 백분율 오차 (낮을수록 좋음)",
    },
  ];

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-gray-200">
          <th className="pb-2 text-left font-medium text-gray-500">지표</th>
          <th className="pb-2 text-right font-medium text-gray-500">값</th>
          <th className="pb-2 pl-4 text-left font-medium text-gray-500">설명</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label} className="border-b border-gray-100 last:border-0">
            <td className="py-2.5 font-mono font-semibold text-blue-700">
              {row.label}
            </td>
            <td className="py-2.5 text-right font-mono text-gray-900">
              {row.value}
            </td>
            <td className="py-2.5 pl-4 text-gray-500">{row.description}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
