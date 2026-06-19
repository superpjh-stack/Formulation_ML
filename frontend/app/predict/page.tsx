"use client";

import { toast } from "sonner";
import { PredictForm } from "@/components/forms/PredictForm";
import { PredictResult } from "@/components/results/PredictResult";
import { ErrorAlert } from "@/components/ui/ErrorAlert";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { usePredict } from "@/hooks/usePredict";

export default function PredictPage() {
  const { status, result, error, predict } = usePredict();

  const handleSubmit = async (data: Parameters<typeof predict>[0]) => {
    await predict(data);
    if (status !== "error") {
      toast.success("품질 점수 예측이 완료되었습니다.");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">품질 점수 예측</h1>
        <p className="mt-1 text-sm text-gray-500">
          성분 비율과 공정 조건을 입력하여 ML 모델의 품질 점수 예측값을 확인합니다.
          SN + AG + CU + PB 합계는 반드시 100%이어야 합니다.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
        {/* 입력 폼 */}
        <Card>
          <CardHeader>
            <CardTitle>성분 및 공정 조건 입력</CardTitle>
          </CardHeader>
          <CardContent>
            <PredictForm
              onSubmit={handleSubmit}
              loading={status === "loading"}
            />
          </CardContent>
        </Card>

        {/* 결과 */}
        <div>
          {status === "idle" && (
            <div className="flex h-full items-center justify-center rounded-xl border-2 border-dashed border-gray-200 text-sm text-gray-400">
              왼쪽 폼에서 조건을 입력하고 예측을 실행하세요.
            </div>
          )}
          {status === "loading" && (
            <div className="flex h-full items-center justify-center text-sm text-gray-400">
              예측 계산 중...
            </div>
          )}
          {status === "error" && error && (
            <ErrorAlert message={error} />
          )}
          {status === "success" && result && (
            <PredictResult result={result} />
          )}
        </div>
      </div>
    </div>
  );
}
