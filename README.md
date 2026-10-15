# 나의 약노트

감기약 복용 경험, 성분, 알레르기 반응과 느낀 효과를 개인 기록으로 남기는 MVP입니다.

- 화면과 브라우저 기능: `index.html`
- 개인 복용 기록: 비밀번호로 암호화해 해당 브라우저에 저장
- 기록 카드에서 수정·삭제, 암호화 백업 파일 저장·가져오기 제공
- 약 성분 찾기: 제조사에서 확인한 국내 제품 2종과 미국 openFDA 제품 라벨 검색, 선택 시 기록 입력란에 채움
- 바코드·QR: 기기 안에서 촬영·사진 판독, 확인된 국내 두 제품 표준코드 및 FDA UPC 조회. 일반 QR 웹주소는 열지 않음
- 국내 반입 안내: 대표 성분·관세청 적발 사례 대조, 함량·배합 예외와 휴대반입 승인 안내. 근거와 범위는 [IMPORT_GUIDE.md](IMPORT_GUIDE.md) 참고
- 정식 버전 신청: Supabase에 이름·연락처·남긴 말 저장, 브라우저는 새 신청 입력만 가능
- 카카오톡 나에게 보내기: `api/kakao.js`, 카카오 앱 설정 전에는 연결 준비 안내만 표시

## 실행

폴더에서 `python3 -m http.server 49263`을 실행하고 `http://localhost:49263`을 엽니다. Python 미리보기에서는 카카오 인증용 서버 기능을 실행하지 않습니다.

## 배포

Vercel의 GitHub 연결로 `main`에 push할 때 자동 배포합니다. 별도의 설치나 프런트엔드 빌드가 필요하지 않습니다. 비밀 환경 변수는 Vercel에만 입력하며 소스에 기록하지 않습니다.

저장소: [hunylee/medicine-note-mvp](https://github.com/hunylee/medicine-note-mvp). Vercel 프로젝트: `heonylees-projects/medicine-note-mvp`.

수정 후에는 `git add . && git commit -m "수정 내용" && git push origin main`을 실행하면 자동 배포됩니다.

카카오 설정은 [KAKAO_SETUP.md](KAKAO_SETUP.md), 신청 표와 보안 정책은 [SQL 정의](supabase/migrations/202610130001_create_launch_requests.sql)를 참고하세요. 브라우저에 포함된 Supabase publishable 키는 공개용이며, 데이터 보호는 RLS와 입력 전용 권한으로 적용합니다.

## 검사

`node --test tests/*.test.cjs`

백업은 ‘암호화 백업 받기’ 다음 ‘백업 파일 저장하기’를 눌러 보관합니다. 다른 기기에서는 같은 파일과 백업 당시 기록 비밀번호로 가져옵니다. 기존 기록은 유지하고 없는 기록만 추가하며, 이미 수정한 기록을 이전 백업으로 덮어쓰지 않습니다. 비밀번호를 잊으면 복원할 수 없습니다.

의학적 진단이나 약 추천을 제공하지 않습니다. 고객이 직접 기록한 경험을 보여줍니다.
