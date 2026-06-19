# DOE 실험계획법 기능

## 실행 방법
uvicorn app:app --reload --port 8000
브라우저: static/doe.html 파일을 직접 열기 (또는 http://localhost:8000/static/doe.html)

## 지원 DOE 방법
- 완전요인설계 (Full Factorial)
- 부분요인설계 (Fractional Factorial)
- 중심합성설계 (CCD)
- 박스-벤켄 설계 (Box-Behnken)
- 다구치 방법 (Taguchi)
- 라틴 하이퍼큐브 (LHS)

## API 엔드포인트
- GET  /doe/methods
- POST /doe/design
- POST /doe/simulate
- POST /doe/analyze
- GET  /doe/sample
