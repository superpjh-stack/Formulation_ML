/** @type {import('next').NextConfig} */

/**
 * `api-contract.md` §1.2 ③ · `ts-types.md` §8 #15.
 *
 * 두 가지가 고쳐졌다.
 *   1. **`/api` 를 벗기지 않는다.** 이전 규칙은 `/api/:path*` → `:8000/:path*` 라
 *      프론트가 `/api/v1/predict` 를 부르면 백엔드 `/v1/predict` 에 닿아 **404** 였다.
 *      이제 프론트가 부른 경로와 백엔드가 받은 경로가 글자 그대로 같아서
 *      네트워크 탭 URL 을 그대로 curl 에 붙여 재현할 수 있다.
 *   2. **개발 환경 전용 분기를 없앴다.** 프론트가 `BASE_URL=''`(상대경로)로 부르므로
 *      프로덕션에서 rewrite 가 꺼지면 요청이 Next 자신에게 가서 전부 404 가 된다.
 *
 * `API_PROXY_TARGET` 으로 백엔드 주소를 바꾼다. 프론트/백엔드를 다른 도메인에 배포해
 * rewrite 를 건너뛰려면 `NEXT_PUBLIC_API_URL` 을 채우고 백엔드 CORS 에 오리진을 추가한다.
 */
const API_TARGET = process.env.API_PROXY_TARGET ?? "http://localhost:8000";

const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_TARGET}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
