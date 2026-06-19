import Link from "next/link";
import { FlaskConical } from "lucide-react";

const NAV_LINKS = [
  { href: "/", label: "홈" },
  { href: "/recommend", label: "배합 추천" },
  { href: "/predict", label: "품질 예측" },
  { href: "/eda", label: "데이터 분석" },
  { href: "/model", label: "모델 현황" },
];

export function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-gray-200 bg-white">
      <nav className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-3">
        {/* 로고 */}
        <Link href="/" className="flex items-center gap-2 font-bold text-blue-700">
          <FlaskConical className="h-5 w-5" />
          <span>Formulation ML</span>
        </Link>

        {/* 메뉴 */}
        <div className="flex gap-1">
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="rounded-md px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
            >
              {label}
            </Link>
          ))}
        </div>

        {/* API 상태 표시 (오른쪽) */}
        <div className="ml-auto flex items-center gap-1.5 text-xs text-gray-400">
          <span className="h-2 w-2 rounded-full bg-green-400" />
          API: localhost:8000
        </div>
      </nav>
    </header>
  );
}
