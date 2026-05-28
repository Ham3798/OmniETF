# Tally -> Gemini Image -> Kakao Memo MVP

Tally 폼 제출을 받아 n8n에서 이미지를 생성하고, 결과를 내 카카오톡 `나에게 보내기`로 전송하는 MVP 템플릿입니다.

이 저장소에는 바로 손볼 수 있는 3가지가 들어 있습니다.

- [workflows/tally-gemini-kakao-self.json](/Users/taeho/Documents/New project/workflows/tally-gemini-kakao-self.json)
- [.env.example](/Users/taeho/Documents/New project/.env.example)
- [docs/kakao-login-token.md](/Users/taeho/Documents/New project/docs/kakao-login-token.md)

## 워크플로우 개요

1. Tally가 n8n `Webhook`으로 폼 제출 JSON을 보냅니다.
2. `Code` 노드가 Tally payload를 표준화하고 이미지 프롬프트를 만듭니다.
3. `HTTP Request` 노드가 Gemini `gemini-2.5-flash-image` 모델로 이미지를 생성합니다.
4. 결과 이미지를 Cloudinary에 업로드해 공개 HTTPS URL을 얻습니다.
5. Kakao OAuth refresh token으로 access token을 갱신합니다.
6. Kakao `memo/default/send`로 내 카카오톡에 이미지 메시지를 보냅니다.

## 필요한 준비물

- Tally 폼
- n8n 인스턴스
- Gemini API key
- Cloudinary 계정
- Kakao Developers 앱
- Kakao Login 활성화
- `talk_message` 동의항목
- 초기 `refresh_token`

## 추천 Tally 필드

이 템플릿은 아래 이름을 우선적으로 찾습니다.

- `name`
- `product`
- `theme`
- `extra_prompt`
- `phone`

Tally가 다른 키 이름을 보내더라도, 코드 노드에서 `label`과 `key`를 같이 탐색하도록 작성해 두었습니다. 그래도 가장 안정적인 방식은 위 이름으로 맞추는 것입니다.

## n8n 설정 순서

1. [workflows/tally-gemini-kakao-self.json](/Users/taeho/Documents/New project/workflows/tally-gemini-kakao-self.json) 을 n8n에 import 합니다.
2. `Prepare Input` 노드에서 `$env.*` 값이 정상적으로 들어오는지 확인합니다.
3. n8n 실행 환경에 [.env.example](/Users/taeho/Documents/New project/.env.example) 값을 채웁니다.
4. Kakao 앱의 Redirect URI와 Product Link를 설정합니다.
5. [docs/kakao-login-token.md](/Users/taeho/Documents/New project/docs/kakao-login-token.md) 를 보고 첫 `refresh_token`을 발급받습니다.
6. Tally 폼의 Webhook URL을 n8n `Webhook` 노드 테스트 URL 또는 프로덕션 URL로 연결합니다.
7. Tally에서 테스트 제출 후, n8n 실행 로그와 내 카카오톡 수신 결과를 확인합니다.

## 환경 변수

이 템플릿은 `Prepare Input` 코드 노드에서 n8n의 환경 변수를 읽습니다.

- `BASE_BIO_PROMPT`
- `GEMINI_API_KEY`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_UPLOAD_PRESET`
- `CLOUDINARY_FOLDER`
- `KAKAO_REST_API_KEY`
- `KAKAO_CLIENT_SECRET`
- `KAKAO_REFRESH_TOKEN`
- `RESULT_LINK_BASE_URL`
- `KAKAO_MESSAGE_TITLE`
- `KAKAO_MESSAGE_DESCRIPTION`

`RESULT_LINK_BASE_URL`이 없으면 업로드된 이미지 URL 자체를 링크로 사용합니다.

## 주의사항

- Tally는 10초 안에 `2XX` 응답을 기대합니다. 이 워크플로우는 Webhook을 즉시 응답하도록 설계했습니다.
- Kakao `나에게 보내기`는 현재 로그인한 사용자 본인에게만 보낼 수 있습니다.
- Kakao 메시지 템플릿의 링크 도메인은 Product Link 설정과 맞아야 안정적입니다.
- Cloudinary는 unsigned upload preset 기준으로 템플릿을 작성했습니다. 프로덕션에서는 보안 정책을 꼭 확인하세요.
- Kakao refresh token은 영구가 아니므로 만료 시 다시 발급받아야 합니다.

## 빠른 테스트 체크리스트

- Tally 제출이 n8n 실행으로 들어오는지
- Gemini 응답에 `inlineData.data`가 있는지
- Cloudinary 업로드 결과에 `secure_url`이 있는지
- Kakao token refresh가 `200 OK` 인지
- Kakao memo send 응답 `result_code`가 `0` 인지

## 참고 문서

- [Tally Webhooks](https://tally.so/help/webhooks)
- [n8n Export and import workflows](https://docs.n8n.io/workflows/export-import/)
- [n8n Code node](https://docs.n8n.io/code/code-node/)
- [Gemini image generation](https://ai.google.dev/gemini-api/docs/image-generation)
- [Kakao Talk Message REST API](https://developers.kakao.com/docs/latest/en/kakaotalk-message/rest-api)
- [Kakao Default Message Template](https://developers.kakao.com/docs/latest/en/message-template/default)
- [Kakao Login REST API](https://developers.kakao.com/docs/latest/en/kakaologin/rest-api)
