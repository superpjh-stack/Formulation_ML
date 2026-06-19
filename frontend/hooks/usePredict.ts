"use client";

import { useState, useCallback } from "react";
import { fetchPrediction, ApiError } from "@/lib/api";
import type { PredictRequest, PredictResponse, LoadingState } from "@/types";

export function usePredict() {
  const [status, setStatus] = useState<LoadingState>("idle");
  const [result, setResult] = useState<PredictResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const predict = useCallback(async (params: PredictRequest) => {
    setStatus("loading");
    setError(null);
    try {
      const data = await fetchPrediction(params);
      setResult(data);
      setStatus("success");
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `API ${err.status}: ${err.message}`
          : "알 수 없는 오류가 발생했습니다.";
      setError(msg);
      setStatus("error");
    }
  }, []);

  const reset = useCallback(() => {
    setStatus("idle");
    setResult(null);
    setError(null);
  }, []);

  return { status, result, error, predict, reset };
}
