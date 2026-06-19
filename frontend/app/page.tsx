import Link from "next/link";
import { FlaskConical, BarChart3, BrainCircuit, TrendingUp, TestTube2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";

const FEATURE_CARDS = [
  {
    href: "/recommend",
    icon: FlaskConical,
    title: "배합비율 추천",
    description:
      "공정 온도·시간·공급사를 입력하면 SLSQP 최적화로 최적 SN/AG/CU/PB 배합비율을 추천합니다.",
    color: "text-blue-600",
    bg: "bg-blue-50",
  },
  {
    href: "/predict",
    icon: TrendingUp,
    title: "품질 점수 예측",
    description:
      "성분 비율과 공정 조건을 직접 입력하여 ML 모델의 품질 점수 예측값을 확인합니다.",
    color: "text-green-600",
    bg: "bg-green-50",
  },
  {
    href: "/eda",
    icon: BarChart3,
    title: "데이터 분석 (EDA)",
    description:
      "성분 분포, 상관관계, 목표값 대비 편차를 시각화하여 데이터 품질을 파악합니다.",
    color: "text-purple-600",
    bg: "bg-purple-50",
  },
  {
    href: "/model",
    icon: BrainCircuit,
    title: "모델 현황",
    description:
      "학습된 모델의 MAE/RMSE/R²/MAPE 성능 지표와 피처 중요도를 비교합니다.",
    color: "text-orange-600",
    bg: "bg-orange-50",
  },
  {
    href: "/doe",
    icon: TestTube2,
    title: "DOE 시뮬레이터",
    description:
      "실험계획법(CCD, Taguchi, LHS 등) 설계 행렬 생성 → ML 시뮬레이션 → 주효과 분석 → 최적 배합 탐색.",
    color: "text-teal-600",
    bg: "bg-teal-50",
  },
];

export default function HomePage() {
  return (
    <div className="space-y-10">
      {/* 헤더 */}
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-900">
          Formulation ML
        </h1>
        <p className="mt-2 text-gray-500">
          성분분석 데이터 기반 배합비율 최적화 시스템 — Python FastAPI + GradientBoosting
        </p>
      </div>

      {/* 기능 카드 그리드 */}
      <div className="grid gap-5 sm:grid-cols-2">
        {FEATURE_CARDS.map(({ href, icon: Icon, title, description, color, bg }) => (
          <Link key={href} href={href} className="group block">
            <Card className="h-full transition-shadow group-hover:shadow-md">
              <CardContent>
                <div className={`mb-4 inline-flex rounded-lg p-3 ${bg}`}>
                  <Icon className={`h-6 w-6 ${color}`} />
                </div>
                <h2 className="mb-1.5 text-base font-semibold text-gray-900">
                  {title}
                </h2>
                <p className="text-sm leading-relaxed text-gray-500">
                  {description}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* 스택 뱃지 */}
      <div className="flex flex-wrap justify-center gap-2 text-xs">
        {[
          "Next.js 14",
          "FastAPI",
          "GradientBoosting",
          "XGBoost",
          "scikit-learn",
          "scipy SLSQP",
          "Recharts",
          "Tailwind CSS",
        ].map((tag) => (
          <span
            key={tag}
            className="rounded-full border border-gray-200 bg-white px-3 py-1 text-gray-500"
          >
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
}
