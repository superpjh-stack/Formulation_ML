import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ErrorAlertProps {
  message: string;
  className?: string;
}

export function ErrorAlert({ message, className }: ErrorAlertProps) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700",
        className
      )}
    >
      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
      <p className="text-sm">{message}</p>
    </div>
  );
}
