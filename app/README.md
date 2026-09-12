# AriaForge

자동 영어 문제 제작 프로그램. 요구사항과 설계는 [../PRD.md](../PRD.md), 생성 엔진 조사 결과는
[../spike/SPIKE-REPORT.md](../spike/SPIKE-REPORT.md)를 참고하세요.

현재 상태: **PRD §5.1 P0 + P1 완료** — 엔진 브리지, TA3 파서, C1/C2/C3 변환, 두 출제 모드,
2단 A4 미리보기, 정답지, 문항 단위 재생성·삭제·재배열·**직접 수정**, 프리셋·세션 저장,
**PDF · DOCX** 내보내기.

## 명령

```bash
npm install          # 최초 1회
npm run dev          # 개발 (Electron + 렌더러 HMR)
npm run typecheck    # 타입 검사 (main/preload/renderer)
npm test             # 회귀 테스트 107건
npm run build        # 프로덕션 번들 -> out/
npm run selftest     # 빌드 후 엔진 11유형 생성 검증 (헤드리스)
npm run package:win  # Windows 설치본 + 포터블 exe -> release/
npm run package:mac  # macOS dmg (macOS 에서만 가능)
```

파이프라인 전체를 헤드리스로 돌려 PDF를 뽑아 보려면:

```bash
# 생성 -> 조판 -> PDF/DOCX 출력
node scripts/build.mjs && electron out/main/index.js --export-sample sample.pdf 30

# 문항 단위 편집을 실제 엔진으로 확인 (재생성 시 중복이 없는지)
node scripts/build.mjs && electron out/main/index.js --edit-check 12

# 손으로 고친 내용이 PDF·DOCX 에 실제로 들어가는지 확인
node scripts/build.mjs && electron out/main/index.js --edit-export-check <디렉터리>
```

`npm run selftest` 출력 예:

```
engine contract OK — dialog trap installed
  OK   Scramble          1 attempt(s) 8ms
  ...
  OK   Cloze             1 attempt(s) 26ms

11/11 types generated
```

## 구조

```
src/
├─ main/                     Electron 메인 프로세스
│  ├─ index.ts               앱 엔트리 + `--self-test` 모드
│  ├─ ipc.ts                 IPC 핸들러
│  ├─ resources.ts           번들 리소스 경로 해석
│  ├─ engine/
│  │  ├─ contract.ts         엔진의 DOM/전역 계약 (S1에서 확정)
│  │  ├─ EngineBridge.ts     숨긴 BrowserWindow로 엔진 구동
│  │  ├─ ResultParser.ts     Text Area 3 원문 -> 구조화 데이터
│  │  └─ transforms.ts       C1/C2/C3 변환 + 중복 fingerprint + 지문 정규화
│  ├─ export/
│  │  ├─ PdfExporter.ts     숨긴 창에 print HTML 로드 -> printToPDF
│  │  └─ DocxExporter.ts    Word 2단 섹션 + 단 나눔
├─ preload/
│  ├─ index.ts               앱 창용: contextBridge로 IPC 노출
│  └─ engine.ts              엔진 창용: alert/confirm/prompt 트랩
│  └─ store/Store.ts        프리셋 · 세션 (프로젝트 폴더 안에 저장)
├─ renderer/
│  └─ src/
│     ├─ App.tsx             화면 구성 + 세션 자동 저장/복원
│     ├─ ConfigPanel.tsx     유형 선택 · 출제 모드 · 변형 옵션
│     ├─ QuestionList.tsx    문항 재생성 · 삭제 · 순서 변경 · 편집 열기
│     ├─ QuestionEditor.tsx  본문 · 선지 · 단어목록 · 정답 직접 수정
│     ├─ PresetBar.tsx       프리셋 저장/적용/삭제
│     └─ PreviewPane.tsx     2단 A4 미리보기 (iframe)
└─ shared/
   ├─ types.ts               문서 모델 + 실측 페이지 지오메트리
   ├─ plan.ts                문항 배분 (랜덤 / 유형별 지정) + 프리셋 타입
   ├─ document.ts            문항 재배열 · 삭제 · 교체 · 직접 수정 (번호는 항상 파생)
   └─ print/layout.ts        조판 — 미리보기와 PDF가 함께 쓰는 단일 구현

resources/
├─ engine/ariaenglish_offline_4.html   버전 고정 번들, 무수정
└─ fixtures/selftest-passage.txt       self-test용 지문

test/golden.test.ts          spike/out/golden 99개 파일에 대한 회귀 테스트
test/layout.test.ts          페이지네이션 · 지오메트리 · print HTML 계약
test/plan.test.ts            두 출제 모드 · 유형 최소 요건 · 정렬
test/document.test.ts        문항 재배열 · 삭제 · 교체 · 직접 수정 · 편집 검증
test/store.test.ts           프리셋 · 세션 영속성 (임시 디렉터리 사용)
test/docx.test.ts            DOCX 페이지·단 설정 · 단 나눔 개수 · 내용
scripts/
├─ bundle-node.mjs           main/preload (esbuild)
├─ build.mjs                 프로덕션 빌드
└─ dev.mjs                   개발 루프
```

## 엔진을 호출하는 방법 (중요)

`resources/engine/ariaenglish_offline_4.html`은 서드파티 생성 엔진이며 **수정하지 않습니다**.
JS 본문은 난독화되어 있고, 생성 함수는 모두 일회용 능력 토큰으로 보호됩니다:

```js
function getCloze(content, code) {
  if (!flagValidate || code !== globalCode) return ''   // 게이트
  /* ...생성... */
  globalCode = Math.floor(Math.random() * 1000 + 1)      // 토큰 회전
  flagValidate = false                                   // 1회용 소진
  return result
}
```

토큰은 **버튼의 이벤트 경로로 실행될 때만** 무장됩니다. 따라서:

| 호출 경로 | 33회 성공률 |
|---|---|
| `window.generatePerformance(type)` 직접 호출 | 0/33 |
| 유형 버튼에 `dispatchEvent(new MouseEvent('click'))` | 32/33 |

`EngineBridge`는 버튼 dispatch만 사용하고, 레이블만 돌아오면 재시도합니다 — **실패한 시도가
다음 시도를 무장**시키므로 재시도가 메커니즘 자체입니다. 페이지 로드 후 첫 생성은 버려지는
프라이밍입니다. 근거는 `spike/probe4.js`, `spike/probe5.js`에 보존되어 있습니다.

엔진 창은 `contextIsolation: false`로 띄웁니다. preload가 페이지의 `window`를 공유해야
`alert`/`confirm`을 가로챌 수 있고, 그것이 **엔진 파일을 건드리지 않는** 방법입니다.
`nodeIntegration: false`, `sandbox: true`, file:// 외 모든 요청 차단은 유지됩니다
(엔진은 네트워크를 전혀 쓰지 않습니다 — S1에서 요청 시도 0건 확인).

엔진은 생성 결과마다 6줄 저작자 푸터를 붙입니다. 문항에서는 제거하지만 앱 크레딧(하단)에
원문 그대로 1회 표시합니다.

## 프로젝트 경로는 ASCII 여야 합니다 (해결됨)

**이 머신에서 `vite build` 는 프로젝트 경로에 비ASCII 문자가 있으면 0xC0000005(SIGSEGV)로
죽습니다.** 그래서 프로젝트 폴더를 `영어 문제 제작` → **`english-quiz-maker`** 로 옮겼습니다.

동일한 디렉터리를 옮겨가며 확인한 근거입니다:

| 경로 | `vite build` |
|---|---|
| `.../ascii space/vitetest` (공백 포함 ASCII) | **3/3 성공** |
| `.../한글 경로/vitetest` | **0/3 SIGSEGV** |
| 위 디렉터리를 ASCII 로 이동 | **3/3 성공** |
| 다시 한글 경로로 이동 | **SIGSEGV** |

내용물·node_modules·설정이 전부 동일하고 경로만 다릅니다. 설치 중 겪은 pnpm·npm 의
access violation 도 같은 원인으로 보입니다.

**폴더 안의 한글 파일명은 문제없습니다 — 경로만 해당됩니다.** 지문·기존 PDF 는 그대로 두세요.
다른 노트북으로 옮길 때도 상위 경로에 한글이 들어가지 않게만 하면 됩니다.

## 그 밖에 확인된 환경 문제

**1. 전역 pnpm 11.21.0이 `install` 중 access violation으로 죽습니다.**
pnpm 12는 동작하지만 네이티브 바이너리를 받는 빌드 스크립트 승인 방식이 바뀌어
Electron 런타임이 설치되지 않았습니다. 그래서 **npm을 씁니다**(`package-lock.json`).

**2. `electron` postinstall이 건너뛰어질 수 있습니다.**
`node_modules/electron/dist`가 없으면:

```bash
node node_modules/electron/install.js
```

**3. Git Bash의 `kill`은 `npm run dev`를 깨끗히 멈추지 못합니다.**
Windows에서 SIGTERM이 전달되지 않아 정리 핸들러가 돌지 않습니다. 터미널에서 **Ctrl+C**로
종료하세요. 잔여 프로세스가 남았다면:

```bash
powershell -NoProfile -Command "Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force"
```

## 빌드 구성

main/preload는 **esbuild**(`scripts/bundle-node.mjs`), 렌더러는 **Vite**로 나눠져 있습니다.
main/preload에는 HMR·CSS·JSX가 필요 없어 esbuild가 더 단순하고 빠릅니다. 이 분리는 원래
위 크래시를 피하려다 나온 것이지만, 원인이 경로로 밝혀진 뒤에도 그대로 둘 만한 구성입니다
(부수 효과로 main/preload는 한글 경로에서도 빌드됩니다).

## 테스트

`test/golden.test.ts`는 스파이크 S2가 수집한 99개 골든 파일(11유형 × 난이도 3 × 보기 개수 3)을
기준선으로 씁니다. 검증 내용:

- 99/99 파싱, 경고 0건
- 유형별 정답 종류 (Cloze만 `wordList`, 나머지 10종은 `choice`)
- 요청한 보기 개수를 정확히 전달하는지
- 저작자 푸터가 본문에서 제거되고 별도로 보존되는지
- **C1** 서술형 Scramble: 정답 문장 9/9 복원 + 원문 verbatim 일치
- **C2** Cloze 단어목록: 제거 후 잔여 힌트 0건, 정답 개수 = 빈칸 개수
- **C3** Cloze 재번호: 9건 중 3건이 읽는 순서를 벗어나며, 재번호로 9/9 정렬
- 중복 fingerprint가 같은 유형의 서로 다른 문항을 구분하는지
- 지문 정규화 (탭·다중 공백·nbsp·스마트 인용부호)

골든 코퍼스는 `spike/out/golden/`에 있습니다. 없으면 해당 테스트는 skip되고 나머지만 돕니다.

## 문항 직접 수정

생성 결과는 출발점이고, 마음에 안 드는 부분은 앱 안에서 바로 고칠 수 있습니다.
문항 목록의 **✎** 를 누르면 편집창이 열립니다.

| 수정 가능 | |
|---|---|
| 제목 · 부제목 | 왼쪽 패널의 입력란 |
| 본문 | 편집창의 textarea |
| 선지 | 추가 · 삭제 · 텍스트 수정 (삭제 시 정답 번호가 범위 안으로 자동 조정) |
| Cloze 단어 목록 | 공백 구분 입력 |
| 정답 | 선지 번호 / 정답 문장 / 빈칸 단어 목록 — 유형에 맞는 형태로 |

- 저장하면 **미리보기와 PDF · DOCX 에 즉시 반영**됩니다. 세 곳 모두 같은 문서 모델을 읽기 때문입니다.
- 저장 전에 어긋난 점을 알려줍니다 — 빈 본문, 빈 선지, 선지 수를 넘는 정답 번호,
  Cloze 의 빈칸 수와 정답 수 불일치 등. 문제가 있으면 저장 버튼이 잠깁니다.
- 수정한 문항은 목록에 **✎** 로 표시됩니다. 그 문항을 다시 생성하면 수정 내용이 사라지므로
  확인을 한 번 받습니다.

## 내보내기

두 형식 모두 `shared/types.ts` 의 같은 문서 모델에서 나옵니다.

| 형식 | 방식 | 조판 정확도 |
|---|---|---|
| **PDF** | 미리보기와 **같은 HTML** 을 숨긴 창에서 `printToPDF` | 기준 PDF 와 단 위치·폰트 일치 |
| **DOCX** | `docx` 라이브러리, A4 2단 섹션 + 문항마다 단 나눔 | Word 가 줄바꿈을 다시 흘리므로 줄 위치는 달라짐. 문항 순서·단당 1문항·정답지 분리는 동일 |

손으로 고칠 일이 있으면 DOCX 를 쓰면 됩니다 — 한글에서도 `.docx` 를 열 수 있습니다.

## 배포 (패키징)

`electron-builder` 로 만듭니다. 설정은 [electron-builder.yml](electron-builder.yml).

| 플랫폼 | 산출물 |
|---|---|
| Windows | `AriaForge-<버전>-win-x64-setup.exe` (설치본), `...-portable.exe` (설치 없이 실행) |
| macOS | `AriaForge-<버전>-mac-x64.dmg`, `...-arm64.dmg` |

**macOS 빌드는 macOS 에서만 가능합니다.** 이 저장소에는
[.github/workflows/release.yml](../.github/workflows/release.yml) 이 있어 GitHub Actions 가
Windows · macOS 러너에서 양쪽을 만듭니다. `v0.1.0` 같은 태그를 push 하면 빌드 후
Release 에 첨부되고, Actions 탭에서 수동 실행도 됩니다.

### 패키징에서 주의할 점

- **의존성은 main 번들에 포함됩니다.** 패키지에는 `node_modules` 가 들어가지 않으므로
  런타임 `require()` 가 실패합니다(실제로 `Cannot find module 'docx'` 로 겪었습니다).
  `scripts/bundle-node.mjs` 는 `electron` 과 Node 내장 모듈만 external 로 둡니다.
- **패키징된 Windows 앱은 GUI 바이너리라 stdout 이 콘솔에 닿지 않습니다.**
  검증 모드에 `--report <파일>` 을 주면 결과를 파일로 남깁니다.
  CI 에서는 패키징 전에 `electron out/main/index.js --self-test` 형태로 돌립니다.
- **설정 저장 위치가 달라집니다.** 개발 체크아웃은 프로젝트 폴더의 `.ariaforge/`,
  패키징된 앱은 OS 사용자 데이터 폴더입니다(번들은 읽기 전용). `ARIAFORGE_DATA_DIR`
  로 덮어쓸 수 있습니다 — USB 포터블 설치에 씁니다.
- **코드 서명이 없습니다.** Windows 는 SmartScreen 경고("알 수 없는 게시자"),
  macOS 는 Gatekeeper 경고가 뜹니다. 받는 분께 미리 알려주세요.
  macOS 는 우클릭 → 열기, 또는 시스템 설정 → 개인정보 보호 및 보안에서 허용해야 합니다.
- **용량은 약 110MB** 입니다. Electron 런타임이 통째로 들어갑니다.

## 글꼴 번들

Pretendard 와 Noto Sans 를 앱에 포함해, 받는 사람 PC 에 설치돼 있지 않아도 인쇄 결과가
같게 나옵니다. `resources/fonts/` 에 있고 라이선스 안내는 [NOTICE.md](resources/fonts/NOTICE.md).

글꼴은 `aria-font://` 전용 스킴으로 제공합니다 — 미리보기(srcdoc iframe)와 PDF 내보내기
창이 **같은 파일**을 쓰게 하려면 이 방법이 필요합니다. `file://` 은 개발 모드에서
렌더러 출처가 http 라 차단되고, base64 임베드는 7.6MB 를 렌더마다 실어야 합니다.
`npm run build && npx electron out/main/index.js --font-check` 로 확인할 수 있습니다.

## 프리셋과 세션

학교별 설정은 **`app/.ariaforge/`** 에 저장됩니다 — OS 앱데이터 폴더가 아니라 프로젝트 폴더
안입니다. 노트북을 오갈 때 폴더만 옮기면 설정도 같이 따라옵니다 (PRD §2.1).

```
app/.ariaforge/
├─ session.json          제목 · 부제목 · 지문 · 설정 (앱 재시작 시 복원)
└─ presets/<이름>.json    학교별 설정 조합
```

프리셋에는 유형 선택, 출제 모드(랜덤/유형별 지정), 문항 수, 난이도, 보기 개수,
Scramble 방식, Cloze 옵션, 정렬 방식이 모두 들어갑니다.

`test/layout.test.ts`는 조판을 검증합니다 — 페이지당 정확히 2문항, 제목 블록은 1페이지 1단에만,
문항 순서 보존, 홀수 문항 시 마지막 단 비움, 정답지 페이지 확보, 실측 지오메트리 유지,
정답 3종 표기, HTML 이스케이프.

## 조판이 기준 PDF와 일치하는지

미리보기와 PDF는 `src/shared/print/layout.ts`의 **같은 HTML**을 렌더합니다. 12문항을
내보내 기준 PDF와 대조한 결과:

| 항목 | 기준 PDF | 생성 PDF |
|---|---|---|
| 좌/우 단 x0 | 28 / 309 | 28 / 309 |
| 본문 폰트 | 10.0pt | 9.75pt (13px) — 아래 타이포그래피 참조 |
| 페이지당 문항 | 2 | 2 |
| 콘텐츠 상단 | 25.3pt | 26.1pt |
| 행간 | 16.0pt | 15.7~16.5pt |
| 페이지 폭 | 595.32pt | 594.96pt |

페이지 폭 0.36pt(0.13mm) 차이는 Chromium의 PDF 페이지 크기 양자화 때문이며, 기준 PDF의
595.32pt 자체도 실제 A4(595.276pt)에서 반올림된 값입니다. PRD §7.2의 ±2pt 기준 안입니다.

## 타이포그래피

페이지·단 수치는 기준 PDF 실측값 그대로지만, 글꼴과 크기는 별도로 지정된 값을 씁니다.

| 대상 | 지정 | 환산 |
|---|---|---|
| 제목 · 부제목 | **Pretendard 16px bold** | 12.0pt |
| 그 외 전부 (문항 헤더 · 본문 · 선지 · 정답지) | **Noto Sans 13px** | 9.75pt |

- 크기는 px 로 저장합니다 (`PRINT_GEOMETRY.titleFontPx` / `bodyFontPx`). 1px = 0.75pt 로 정확히
  변환되므로 pt 인 페이지 수치와 섞여도 오차가 없습니다.
- 행간은 기준 PDF 의 **16pt 고정**을 유지합니다. 단에 들어가는 줄 수가 달라지지 않습니다.
- `Noto Sans` 는 이 PC 에 `Noto Sans KR` 로 설치돼 있어 폰트 스택에 둘 다 넣었습니다.
  두 글꼴 모두 설치돼 있어야 의도한 결과가 나옵니다 — 없으면 `Malgun Gothic` 으로 대체됩니다.
- **문항 헤더(`< Question 1 >  Cloze`)도 "그 외"에 포함**되어 본문과 같은 13px 입니다.
  기준 PDF 는 헤더를 12pt / 본문 10pt 로 구분했는데, 지금은 크기 차이가 없습니다.
