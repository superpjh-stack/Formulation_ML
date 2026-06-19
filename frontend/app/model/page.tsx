"use client";

import { useModels } from "@/hooks/useModels";
import { MetricsTable } from "@/components/charts/MetricsTable";
import { FeatureImportanceBar } from "@/components/charts/FeatureImportanceBar";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { ErrorAlert } from "@/components/ui/ErrorAlert";
import { formatDate } from "@/lib/utils";
import { useState } from "react";

export default function ModelPage() {
  const { models, loading, error } = useModels();
  const [selected, setSelected] = useState<string | null>(null);

  const activeModel = models.find((m) => m.name === selected) ?? models[0];

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
        <h1 className="text-2xl font-bold text-gray-900">모델 현황</h1>
        <p className="mt-1 text-sm text-gray-500">
          학습된 ML 모델의 성능 지표와 피처 중요도를 비교합니다.
        </p>
      </div>

      {models.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-gray-400">
            학습된 모델이 없습니다. <code className="rounded bg-gray-100 px-1">python scripts/train.py</code>를 먼저 실행하세요.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* 모델 탭 */}
          <div className="flex gap-2">
            {models.map((m) => (
              <button
                key={m.name}
                onClick={() => setSelected(m.name)}
                className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                  (selected ?? models[0]?.name) === m.name
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                {m.name}
              </button>
            ))}
          </div>

          {activeModel && (
            <div className="grid gap-6 lg:grid-cols-2">
              {/* 성능 지표 */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>성능 지표</CardTitle>
                    {activeModel.trained_at && (
                      <Badge variant="neutral" className="text-xs">
                        {formatDate(activeModel.trained_at)}
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <MetricsTable metrics={activeModel.metrics} />
                </CardContent>
              </Card>

              {/* 피처 중요도 */}
              <Card>
                <CardHeader>
                  <CardTitle>피처 중요도 (Top 10)</CardTitle>
                </CardHeader>
                <CardContent>
                  {activeModel.feature_importances.length > 0 ? (
                    <FeatureImportanceBar
                      data={activeModel.feature_importances}
                      topN={10}
                    />
                  ) : (
                    <p className="text-center text-sm text-gray-400">
                      이 모델은 피처 중요도를 지원하지 않습니다. (Ridge 등)
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}
