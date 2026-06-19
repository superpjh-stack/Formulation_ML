"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import type { FeatureImportance } from "@/types";

interface FeatureImportanceBarProps {
  data: FeatureImportance[];
  topN?: number;
}

const COLORS = [
  "#2563eb",
  "#3b82f6",
  "#60a5fa",
  "#93c5fd",
  "#bfdbfe",
  "#dbeafe",
];

export function FeatureImportanceBar({
  data,
  topN = 10,
}: FeatureImportanceBarProps) {
  const sorted = [...data]
    .sort((a, b) => b.importance - a.importance)
    .slice(0, topN);

  return (
    <ResponsiveContainer width="100%" height={Math.max(200, sorted.length * 36)}>
      <BarChart
        data={sorted}
        layout="vertical"
        margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
      >
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis
          type="number"
          domain={[0, "dataMax"]}
          tickFormatter={(v) => v.toFixed(3)}
          fontSize={11}
        />
        <YAxis
          type="category"
          dataKey="feature"
          width={140}
          fontSize={11}
        />
        <Tooltip
          formatter={(value: number) => [value.toFixed(4), "중요도"]}
        />
        <Bar dataKey="importance" radius={[0, 4, 4, 0]}>
          {sorted.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
