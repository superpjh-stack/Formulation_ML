"use client";

import { useEffect, useState } from "react";
import { SN_TARGET, AG_TARGET, CU_TARGET } from "@/lib/constants";
import { fetchEdaStats, ApiError } from "@/lib/api";
import type { EdaStats } from "@/types";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { ErrorAlert } from "@/components/ui/ErrorAlert";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  BarChart,
  Bar,
} from "recharts";

export default function EdaPage() {
  const [data, setData] = useState<EdaStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchEdaStats()
      .then(setData)
      .catch((err) => {
        const msg =
          err instanceof ApiError
            ? `EDA 데이터 로드 실패 (${err.status}): ${err.message}`
            : "EDA 데이터를 불러오지 못했습니다.";
        setError(msg);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return <ErrorAlert message={error} className="mt-4" />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">데이터 분석 (EDA)</h1>
        <p className="mt-1 text-sm text-gray-500">
          성분 분포, 목표값 대비 편차, 품질 상관관계를 시각화합니다.
        </p>
      </div>

      {/* 요약 통계 */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "SN 목표값", value: SN_TARGET, unit: "%" },
          { label: "AG 목표값", value: AG_TARGET, unit: "%" },
          { label: "CU 목표값", value: CU_TARGET, unit: "%" },
        ].map(({ label, value, unit }) => (
          <Card key={label}>
            <CardContent className="py-4 text-center">
              <p className="text-xs text-gray-500">{label}</p>
              <p className="mt-1 text-2xl font-bold text-blue-700">
                {value}
                <span className="ml-1 text-sm font-normal">{unit}</span>
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {data && (
        <>
          {/* 전체 통계 배지 */}
          <div className="flex flex-wrap gap-4 text-sm text-gray-600">
            <span className="rounded-full border border-gray-200 bg-white px-3 py-1">
              총 LOT: <strong>{data.stats.total_lots}</strong>건
            </span>
            <span className="rounded-full border border-gray-200 bg-white px-3 py-1">
              평균 품질: <strong>{data.stats.mean_quality}</strong>
            </span>
            <span className="rounded-full border border-gray-200 bg-white px-3 py-1">
              품질 표준편차: <strong>{data.stats.std_quality}</strong>
            </span>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* SN 분포 히스토그램 */}
            <Card>
              <CardHeader>
                <CardTitle>SN 비율 분포</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.sn_distribution}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="range" fontSize={11} />
                    <YAxis fontSize={11} />
                    <Tooltip />
                    <Bar dataKey="count" name="LOT 수" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* SN vs 품질 산점도 */}
            <Card>
              <CardHeader>
                <CardTitle>SN 비율 vs 품질 점수</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <ScatterChart>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="sn"
                      name="SN 비율"
                      unit="%"
                      fontSize={11}
                      domain={["auto", "auto"]}
                    />
                    <YAxis dataKey="quality" name="품질 점수" fontSize={11} />
                    <Tooltip cursor={{ strokeDasharray: "3 3" }} />
                    <ReferenceLine
                      x={SN_TARGET}
                      stroke="#ef4444"
                      strokeDasharray="4 4"
                      label={{ value: `목표 ${SN_TARGET}%`, fontSize: 10, fill: "#ef4444" }}
                    />
                    <Scatter data={data.sn_vs_quality} fill="#3b82f6" fillOpacity={0.7} />
                  </ScatterChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* AG 분포 히스토그램 */}
            <Card>
              <CardHeader>
                <CardTitle>AG 비율 분포</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.ag_distribution}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="range" fontSize={11} />
                    <YAxis fontSize={11} />
                    <Tooltip />
                    <Bar dataKey="count" name="LOT 수" fill="#7c3aed" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* CU 분포 히스토그램 */}
            <Card>
              <CardHeader>
                <CardTitle>CU 비율 분포</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.cu_distribution}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="range" fontSize={11} />
                    <YAxis fontSize={11} />
                    <Tooltip />
                    <Bar dataKey="count" name="LOT 수" fill="#059669" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
