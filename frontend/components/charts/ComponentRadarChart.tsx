"use client";

import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { ComponentRatios } from "@/types";
import { SN_TARGET, AG_TARGET, CU_TARGET } from "@/lib/constants";

interface ComponentRadarChartProps {
  ratios: ComponentRatios;
  showTarget?: boolean;
}

export function ComponentRadarChart({
  ratios,
  showTarget = true,
}: ComponentRadarChartProps) {
  const data = [
    {
      component: "SN",
      actual: ratios.sn,
      target: SN_TARGET,
    },
    {
      component: "AG",
      actual: ratios.ag,
      target: AG_TARGET,
    },
    {
      component: "CU",
      actual: ratios.cu,
      target: CU_TARGET,
    },
    {
      component: "PB",
      actual: ratios.pb,
      target: 100 - SN_TARGET - AG_TARGET - CU_TARGET,
    },
  ];

  return (
    <ResponsiveContainer width="100%" height={300}>
      <RadarChart data={data}>
        <PolarGrid />
        <PolarAngleAxis dataKey="component" />
        <PolarRadiusAxis angle={30} />
        <Radar
          name="추천 비율"
          dataKey="actual"
          stroke="#2563eb"
          fill="#2563eb"
          fillOpacity={0.4}
        />
        {showTarget && (
          <Radar
            name="목표 비율"
            dataKey="target"
            stroke="#9ca3af"
            fill="#9ca3af"
            fillOpacity={0.15}
          />
        )}
        <Tooltip
          formatter={(value: number, name: string) => [
            `${value.toFixed(2)}%`,
            name,
          ]}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}
