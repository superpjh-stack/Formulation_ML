"use client";

import { useState, useCallback } from "react";
import { fetchRecommendation, ApiError } from "@/lib/api";
import type { RecommendRequest, RecommendResponse, LoadingState } from "@/types";

export function useRecommend() {
  const [status, setStatus] = useState<LoadingState>("idle");
  const [result, setResult] = useState<RecommendResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recommend = useCallback(async (params: RecommendRequest) => {
    setStatus("loading");
    setError(null);
    try {
      const data = await fetchRecommendation(params);
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

  return { status, result, error, recommend, reset };
}
