import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { QualityScoreGauge } from "@/components/charts/QualityScoreGauge";
import { Badge } from "@/components/ui/Badge";
import { getQualityBadgeVariant } from "@/lib/utils";
import type { PredictResponse } from "@/types";

interface PredictResultProps {
  result: PredictResponse;
}

export function PredictResult({ result }: PredictResultProps) {
  const { predicted_quality, model_used } = result;
  const variant = getQualityBadgeVariant(predicted_quality);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>예측 결과</CardTitle>
          <Badge variant="neutral" className="font-mono text-xs">
            {model_used}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4">
        <QualityScoreGauge score={predicted_quality} />
        <div className="w-full rounded-lg bg-gray-50 p-4 text-center">
          <p className="text-sm text-gray-500">예측 품질 점수</p>
          <p className="mt-1 text-4xl font-bold text-gray-900">
            {predicted_quality.toFixed(2)}
          </p>
          <Badge variant={variant} className="mt-2">
            {variant === "success"
              ? "우수 — 양산 적합"
              : variant === "info"
              ? "양호 — 조건부 적합"
              : variant === "warning"
              ? "보통 — 추가 검토 필요"
              : "주의 — 배합 재조정 권장"}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
