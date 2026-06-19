"use client";

import { toast } from "sonner";
import { RecommendForm } from "@/components/forms/RecommendForm";
import { RecommendResult } from "@/components/results/RecommendResult";
import { ErrorAlert } from "@/components/ui/ErrorAlert";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { useRecommend } from "@/hooks/useRecommend";

export default function RecommendPage() {
  const { status, result, error, recommend } = useRecommend();

  const handleSubmit = async (data: Parameters<typeof recommend>[0]) => {
    await recommend(data);
    if (status !== "error") {
      toast.success("배합비율 추천이 완료되었습니다.");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">배합비율 추천</h1>
        <p className="mt-1 text-sm text-gray-500">
          공정 조건을 입력하면 SLSQP 최적화 알고리즘으로 최적 배합비율을 계산합니다.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        {/* 입력 폼 */}
        <Card>
          <CardHeader>
            <CardTitle>공정 조건 입력</CardTitle>
          </CardHeader>
          <CardContent>
            <RecommendForm
              onSubmit={handleSubmit}
              loading={status === "loading"}
            />
          </CardContent>
        </Card>

        {/* 결과 */}
        <div>
          {status === "idle" && (
            <div className="flex h-full items-center justify-center rounded-xl border-2 border-dashed border-gray-200 text-sm text-gray-400">
              왼쪽 폼에서 조건을 입력하고 추천을 실행하세요.
            </div>
          )}
          {status === "loading" && (
            <div className="flex h-full items-center justify-center text-sm text-gray-400">
              최적화 계산 중...
            </div>
          )}
          {status === "error" && error && (
            <ErrorAlert message={error} />
          )}
          {status === "success" && result && (
            <RecommendResult result={result} />
          )}
        </div>
      </div>
    </div>
  );
}
