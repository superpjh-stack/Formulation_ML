"use client";

import { useState, useEffect } from "react";
import { fetchModels, ApiError } from "@/lib/api";
import type { ModelInfo } from "@/types";

export function useModels() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchModels()
      .then(setModels)
      .catch((err) => {
        const msg =
          err instanceof ApiError
            ? `모델 로드 실패 (${err.status}): ${err.message}`
            : "모델 목록을 불러오지 못했습니다.";
        setError(msg);
      })
      .finally(() => setLoading(false));
  }, []);

  return { models, loading, error };
}
