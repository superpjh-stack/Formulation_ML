"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/Button";
import { MODEL_OPTIONS, SUPPLIER_OPTIONS } from "@/lib/constants";
import type { RecommendRequest } from "@/types";

const schema = z.object({
  model: z.enum(["gradient_boosting", "random_forest", "xgboost", "ridge"]),
  temperature: z.coerce
    .number()
    .min(100, "최소 100°C")
    .max(400, "최대 400°C"),
  process_time: z.coerce
    .number()
    .min(1, "최소 1분")
    .max(300, "최대 300분"),
  supplier: z.enum(["SUP_A", "SUP_B", "SUP_C"]),
});

interface RecommendFormProps {
  onSubmit: (data: RecommendRequest) => void;
  loading?: boolean;
}

export function RecommendForm({ onSubmit, loading }: RecommendFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RecommendRequest>({
    resolver: zodResolver(schema),
    defaultValues: {
      model: "gradient_boosting",
      temperature: 250,
      process_time: 45,
      supplier: "SUP_A",
    },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      {/* 모델 선택 */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          예측 모델
        </label>
        <select
          {...register("model")}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          {MODEL_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* 온도 */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          공정 온도 (°C)
        </label>
        <input
          type="number"
          {...register("temperature")}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        {errors.temperature && (
          <p className="mt-1 text-xs text-red-600">{errors.temperature.message}</p>
        )}
      </div>

      {/* 공정 시간 */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          공정 시간 (분)
        </label>
        <input
          type="number"
          {...register("process_time")}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        {errors.process_time && (
          <p className="mt-1 text-xs text-red-600">{errors.process_time.message}</p>
        )}
      </div>

      {/* 공급사 */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">
          공급사
        </label>
        <select
          {...register("supplier")}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          {SUPPLIER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <Button type="submit" loading={loading} className="w-full" size="lg">
        배합비율 추천 실행
      </Button>
    </form>
  );
}
