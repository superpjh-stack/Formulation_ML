"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/Button";
import { MODEL_OPTIONS, SUPPLIER_OPTIONS } from "@/lib/constants";
import type { PredictRequest } from "@/types";

const schema = z
  .object({
    model: z.enum(["gradient_boosting", "random_forest", "xgboost", "ridge"]),
    sn_ratio: z.coerce.number().min(0).max(100),
    ag_ratio: z.coerce.number().min(0).max(100),
    cu_ratio: z.coerce.number().min(0).max(100),
    pb_ratio: z.coerce.number().min(0).max(100),
    temperature: z.coerce.number().min(100).max(400),
    process_time: z.coerce.number().min(1).max(300),
    supplier: z.enum(["SUP_A", "SUP_B", "SUP_C"]),
  })
  .refine(
    (d) => {
      const sum = d.sn_ratio + d.ag_ratio + d.cu_ratio + d.pb_ratio;
      return Math.abs(sum - 100) < 0.01;
    },
    {
      message: "SN + AG + CU + PB 합계는 100이어야 합니다.",
      path: ["pb_ratio"],
    }
  );

interface PredictFormProps {
  onSubmit: (data: PredictRequest) => void;
  loading?: boolean;
}

const RATIO_FIELDS = [
  { key: "sn_ratio" as const, label: "SN 비율 (%)" },
  { key: "ag_ratio" as const, label: "AG 비율 (%)" },
  { key: "cu_ratio" as const, label: "CU 비율 (%)" },
  { key: "pb_ratio" as const, label: "PB 비율 (%)" },
];

export function PredictForm({ onSubmit, loading }: PredictFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PredictRequest>({
    resolver: zodResolver(schema),
    defaultValues: {
      model: "gradient_boosting",
      sn_ratio: 62.0,
      ag_ratio: 3.0,
      cu_ratio: 0.5,
      pb_ratio: 34.5,
      temperature: 250,
      process_time: 45,
      supplier: "SUP_A",
    },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      {/* 모델 */}
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

      {/* 성분 비율 */}
      <div>
        <p className="mb-2 text-sm font-medium text-gray-700">
          성분 비율 (합계 = 100%)
        </p>
        <div className="grid grid-cols-2 gap-3">
          {RATIO_FIELDS.map(({ key, label }) => (
            <div key={key}>
              <label className="mb-1 block text-xs text-gray-500">{label}</label>
              <input
                type="number"
                step="0.01"
                {...register(key)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          ))}
        </div>
        {errors.pb_ratio && (
          <p className="mt-1.5 text-xs text-red-600">{errors.pb_ratio.message}</p>
        )}
      </div>

      {/* 공정 조건 */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            온도 (°C)
          </label>
          <input
            type="number"
            {...register("temperature")}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            시간 (분)
          </label>
          <input
            type="number"
            {...register("process_time")}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
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
        품질 점수 예측
      </Button>
    </form>
  );
}
