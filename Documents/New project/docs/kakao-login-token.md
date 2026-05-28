# Kakao 초기 토큰 발급 가이드

이 프로젝트는 실행 시점마다 `refresh_token`으로 `access_token`을 갱신해 사용합니다. 그래서 처음 한 번은 Kakao OAuth 인가 코드를 받아 `refresh_token`을 확보해야 합니다.

## 1. Kakao Developers 앱 설정

- Kakao Login 활성화
- Redirect URI 등록
- 동의항목 `talk_message` 활성화
- 필요 시 `profile_nickname`, `profile_image`도 추가
- Product Link 설정

문서상 `나에게 보내기`는 `POST https://kapi.kakao.com/v2/api/talk/memo/default/send` 를 사용하며, 전제 조건으로 Kakao Login 활성화, Product Link, `talk_message` 동의가 필요합니다.

## 2. 인가 코드 받기

브라우저에서 아래 URL로 이동합니다.

```text
https://kauth.kakao.com/oauth/authorize?response_type=code&client_id=YOUR_REST_API_KEY&redirect_uri=YOUR_REDIRECT_URI&scope=talk_message
```

로그인과 동의를 마치면 Redirect URI로 이동하면서 `code` 파라미터가 붙습니다.

예시:

```text
https://your-site.com/callback?code=abc123...
```

## 3. 토큰 발급

아래 요청으로 access token과 refresh token을 발급받습니다.

```bash
curl -X POST "https://kauth.kakao.com/oauth/token" \
  -H "Content-Type: application/x-www-form-urlencoded;charset=utf-8" \
  -d "grant_type=authorization_code" \
  -d "client_id=YOUR_REST_API_KEY" \
  -d "redirect_uri=YOUR_REDIRECT_URI" \
  -d "code=AUTHORIZATION_CODE" \
  -d "client_secret=YOUR_CLIENT_SECRET"
```

응답 예시:

```json
{
  "token_type": "bearer",
  "access_token": "....",
  "expires_in": 21599,
  "refresh_token": "....",
  "refresh_token_expires_in": 5183999
}
```

여기서 `refresh_token` 값을 `.env` 또는 n8n 실행 환경 변수 `KAKAO_REFRESH_TOKEN`에 넣으면 됩니다.

## 4. 토큰 갱신

워크플로우는 아래 규칙으로 갱신 API를 호출합니다.

```text
POST https://kauth.kakao.com/oauth/token
grant_type=refresh_token
client_id=YOUR_REST_API_KEY
refresh_token=YOUR_REFRESH_TOKEN
client_secret=YOUR_CLIENT_SECRET
```

문서상 access token은 새로 발급되고, refresh token은 만료가 1개월 미만 남았을 때만 새로 반환될 수 있습니다.

## 5. 실무 팁

- 첫 테스트는 반드시 본인 계정으로만 진행
- Redirect URI는 공백이나 슬래시 오타가 나면 실패하기 쉬움
- Product Link 도메인과 메시지 링크 도메인을 맞추는 편이 안전함
- refresh token이 만료되면 2단계부터 다시 진행

## 참고

- [Kakao Login REST API](https://developers.kakao.com/docs/latest/en/kakaologin/rest-api)
- [Kakao Talk Message REST API](https://developers.kakao.com/docs/latest/en/kakaotalk-message/rest-api)
