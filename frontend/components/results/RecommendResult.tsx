import { CheckCircle, XCircle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { ComponentRadarChart } from "@/components/charts/ComponentRadarChart";
import { QualityScoreGauge } from "@/components/charts/QualityScoreGauge";
import { formatNumber } from "@/lib/utils";
import { SN_TARGET, AG_TARGET, CU_TARGET } from "@/lib/constants";
import type { RecommendResponse } from "@/types";

interface RecommendResultProps {
  result: RecommendResponse;
}

export function RecommendResult({ result }: RecommendResultProps) {
  const { recommended_ratios: r, predicted_quality, optimization_success, message } = result;

  const deviations = [
    { label: "SN", actual: r.sn, target: SN_TARGET },
    { label: "AG", actual: r.ag, target: AG_TARGET },
    { label: "CU", actual: r.cu, target: CU_TARGET },
  ];

  return (
    <div className="space-y-4">
      {/* 최적화 상태 */}
      <div
        className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium ${
          optimization_success
            ? "bg-green-50 text-green-700"
            : "bg-yellow-50 text-yellow-700"
        }`}
      >
        {optimization_success ? (
          <CheckCircle className="h-4 w-4" />
        ) : (
          <XCircle className="h-4 w-4" />
        )}
        {optimization_success
          ? "최적화 성공 — 최적 배합비율을 찾았습니다."
          : `최적화 수렴 미완료${message ? `: ${message}` : ""}`}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* 레이더 차트 */}
        <Card>
          <CardHeader>
            <CardTitle>성분 비율 분포</CardTitle>
          </CardHeader>
          <CardContent>
            <ComponentRadarChart ratios={r} showTarget />
          </CardContent>
        </Card>

        {/* 품질 게이지 */}
        <Card>
          <CardHeader>
            <CardTitle>예측 품질 점수</CardTitle>
          </CardHeader>
          <CardContent className="flex justify-center">
            <QualityScoreGauge score={predicted_quality} />
          </CardContent>
        </Card>
      </div>

      {/* 수치 상세 */}
      <Card>
        <CardHeader>
          <CardTitle>추천 배합비율 상세</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Object.entries(r).map(([key, val]) => (
              <div
                key={key}
                className="rounded-lg bg-gray-50 p-3 text-center"
              >
                <p className="text-xs font-medium uppercase text-gray-500">
                  {key}
                </p>
                <p className="mt-1 text-xl font-bold text-blue-700">
                  {formatNumber(val)}%
                </p>
              </div>
            ))}
          </div>

          {/* 목표값 대비 편차 */}
          <div className="mt-4 border-t border-gray-100 pt-4">
            <p className="mb-2 text-xs font-medium text-gray-500">
              목표값 대비 편차
            </p>
            <div className="space-y-1.5">
              {deviations.map(({ label, actual, target }) => {
                const diff = actual - target;
                return (
                  <div key={label} className="flex items-center gap-2 text-sm">
                    <span className="w-8 font-mono font-semibold text-gray-700">
                      {label}
                    </span>
                    <span className="text-gray-600">
                      {formatNumber(actual)}% (목표 {target}%)
                    </span>
                    <span
                      className={`ml-auto font-mono text-xs ${
                        Math.abs(diff) < 1
                          ? "text-green-600"
                          : "text-yellow-600"
                      }`}
                    >
                      {diff >= 0 ? "+" : ""}
                      {formatNumber(diff)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
