# S1 / S2 스파이크 결과 보고서

| | |
|---|---|
| 실행일 | 2026-09-12 |
| 환경 | Electron 44.3.0 (Chromium), Node 23.11.0, Windows 11 |
| 엔진 | `ariaenglish/ariaenglish_offline_4.html` (Engine v0 r4 Fix04 Build0048) — **무수정** |
| 테스트 지문 | 기준 PDF Q6 + Answer 6에서 복원한 원문 (1,315자 / 14문장) |
| 결론 | **S1 통과, S2 통과. PRD 결정 D1(엔진 재사용)은 실현 가능.** |

## 최종 판정

```json
{ "s1_types_ok": "11/11", "engine_file_unmodified": true,
  "network_requests_attempted": 0, "s2_ok": "99/99" }
{ "goldenFiles": 99, "parsed": "99/99",
  "c1_scramble_openEnded": "9/9", "c2_cloze_wordBank": "9/9",
  "c3_cloze_renumber": "9/9", "clozeOutOfOrder": "3/9",
  "optionCountMismatches": 0 }
```

재현: `npm run s1` / `npm run s2` → `node verify.js`

---

## 1. S1 — 엔진 프로그램적 호출 (통과)

### 1.1 계약 검증

- 필수 전역 함수 14개 전부 존재 (`generatePerformance`, `stackContent`, `applyNumber`, `setOption*` 등)
- 필수 DOM id 24개 전부 존재 (텍스트 영역 6개, 설정 select 5개, 유형 버튼 11개, `buttonStack`, `buttonApplyNumber`)
- 로드 중 다이얼로그 0건, JS 오류 0건
- **네트워크 요청 시도 0건** — 완전 오프라인 동작 확인 (`webRequest`로 file:// 외 전부 차단한 상태에서 차단 로그 없음)

### 1.2 라이선스 검증 경로 — PRD 리스크 R2 **해소**

착수 전 최대 리스크였던 `globalLicense` / `getLicense()` / `flagValidate`의 실체:

```
globalLicense = "For Mass Production www.AriaEnglish.com
                 For Contact teamexercisevocabulary10@gmail.com
                 Engine Design by Dani Sohn
                 Copyright 2021 Dani Sohn
                 Engine Version 0 Revision 4 Fix 04
                 USE AT YOUR OWN RISK"
getLicense() === globalLicense  →  true
```

**라이선스 키가 아니라 저작자 크레딧 배너**입니다. 잠금 장치가 아니며, 통과 여부를 따질 대상이 아니었습니다.

### 1.3 실제 게이트 — 일회용 능력 토큰 (신규 발견)

모든 생성 함수(`getScramble`, `getCloze`, `getBlank`, `getShuffle`, `getWrongSentence`, `getCorrectSentence`, `getMissingSentence`, `getWrongWord`, `getCorrectWord`, `getBinaryWord`)가 동일한 구조를 갖습니다:

```js
function getXxx(content, code) {
  if (!flagValidate || code !== globalCode) return '';   // 게이트
  /* ...생성... */
  globalCode   = Math.floor(Math.random() * 1000 + 1);   // 토큰 회전
  flagValidate = false;                                  // 1회용 소진
  return result;
}
```

`generatePerformance`가 버튼의 **이벤트 경로로 실행될 때만** 토큰을 무장(`flagValidate = true`)합니다. 직접 함수 호출은 무장시키지 못합니다.

### 1.4 호출 경로 실측

| 경로 | `flagValidate` 전이 | 생성 | 33회 반복 성공률 |
|---|---|---|---|
| `window.generatePerformance(type)` 직접 호출 | false → false | ✗ | **0/33** |
| 프라이밍 1회 후 직접 호출 | — | ✗ | **1/33** |
| `el.click()` | false → **true** | ✗ (무장만) | — |
| **`el.dispatchEvent(new MouseEvent('click'))`** | true → true | **✓** | **32/33** |
| `webContents.sendInputEvent` (OS 신뢰 입력) | true → true | ✓ | 11/11 |

**확정 레시피**

1. 원본 HTML을 `BrowserWindow`에 로드 (파일 수정 불필요)
2. `<select>` 값 주입 후 `setOption*()` 호출
3. TA1(`productWordContentOriginal`)에 지문 기록, TA3 비우기
4. **해당 유형 버튼에 `dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true, view:window}))`**
5. TA3(`productWordContentProcessed`)를 **동기적으로** 읽음 (폴링 불필요)
6. 결과가 레이블만이면(= 토큰 미무장) 재시도 — **실패한 시도 자체가 다음 시도를 무장**시킴

OS 수준 신뢰 입력(`sendInputEvent`)은 **필요하지 않습니다.** 좌표 계산·창 포커스가 불필요해 구현이 단순해집니다.

### 1.5 다이얼로그 트랩 — 파일 수정 없이

`preload.js`에서 `window.alert` / `confirm` / `prompt`를 가로챕니다. 이를 위해 **`contextIsolation: false`가 필요**합니다(preload가 페이지 window를 공유해야 함). `nodeIntegration: false`, `sandbox: true`, 네트워크 차단은 유지되므로 엔진은 순수 계산만 수행합니다.

> PRD §6.1이 `contextIsolation: true`로 적혀 있었는데, 이 항목은 수정이 필요합니다. 대안으로 HTML에 `<script>`를 주입하는 방식도 동작은 하지만(별도 검증), 원본 파일을 건드리지 않는 preload 방식이 낫습니다.

### 1.6 성능

문항당 **4~36 ms** (11유형 평균 ~11 ms). PRD 목표였던 "문항당 < 1.5초 / 30문항 < 60초"를 크게 밑돕니다. 30문항이면 1초 미만입니다. 리스크 R7(직렬화로 인한 속도 저하)은 사실상 해소되었습니다.

---

## 2. S2 — 출력 포맷 전수 수집 및 파서 스펙 (통과)

11유형 × 난이도 3 × 보기 개수 3 = **99개 골든 파일** (`out/golden/<유형>/<난이도>-opt<N>.txt`)

### 2.1 표준 출력 골격

```
(빈 줄)
<유형 레이블>                     ← 요청한 유형 문자열과 정확히 일치
(빈 줄)
<문제 본문>                       ← 1줄 또는 여러 줄
[(빈 줄) Choose  =  w  w  ...]    ← Cloze 전용 단어 목록
[(빈 줄) (1)  ... ~ (N)  ...]     ← 선지 보유 유형 전용
(빈 줄)
Answer  =  (N)                    ← 객관식. 또는 "Answer  =  " + 빈 줄 + "1) w" 목록
(빈 줄)
For Mass Production www.AriaEnglish.com      ┐
For Contact teamexercisevocabulary10@gmail.com │
Engine Design by Dani Sohn                     ├ 6줄 저작자 푸터, 항상 부착
Copyright 2021 Dani Sohn                       │
Engine Version 0 Revision 4 Fix 04             │
USE AT YOUR OWN RISK                         ┘
```

- **`Answer  =  ` 라인이 문제/정답의 정식 구분자** (등호 양쪽 공백 2개)
- 파서 결과: **99/99 파싱 성공, 경고 0건** (`parser.js` + `verify.js`)

### 2.2 유형별 구조

| 유형 | 정답 종류 | 선지 블록 | 선지 형식 |
|---|---|---|---|
| Scramble | choice | ✓ | `(1)  word / word / ...` |
| Shuffle | choice | ✓ | `(1)  (A) - (B) - (D) - (C)` |
| Multiple Choice | choice | ✓ | `(1)  bananas` |
| Blank | choice | ✓ | `(1)  (A) x  (B) y  (C) z` |
| Binary Word | choice | ✓ | `(1)  (A) x  (B) y  (C) z` |
| Missing / Wrong / Correct Sentence | choice | ✗ | 본문 내 `( N )` 마커 참조 |
| Wrong / Correct Word | choice | ✗ | 본문 내 `( N ) ( word )` 마커 참조 |
| Cloze | **wordList** | ✗ | `1) word` 번호 목록 |

**어떤 유형도 `sentence` 정답을 native로 내지 않습니다** → 서술형 Scramble은 반드시 후처리 변환이어야 한다는 PRD §6.3 설계가 확인되었습니다.

### 2.3 보기 개수는 정확히 지켜짐

요청 1 / 3 / 5 → 전달 1 / 3 / 5. **자동 하향 조정 0건.** (이 지문에서. 짧은 지문에서는 여전히 발생 가능하므로 PRD E16은 유지)

Cloze에서는 보기 개수가 **빈칸 개수**를 결정합니다:

| | opt1 | opt3 | opt5 |
|---|---|---|---|
| Hard | 1 | 7 | 14 |
| Normal | 1 | 20 | 23 |
| Easy | 12 | 24 | 35 |

→ UI 제안: Cloze가 선택되면 "보기 개수" 라벨을 **"빈칸 빈도"**로 바꿔 표시. 같은 값이 유형마다 전혀 다른 의미를 가집니다.

### 2.4 출력 다양성 — 중복 위험 해소

동일 지문으로 유형별 12회 반복:

```
11개 유형 전부 distinct 12/12  (중복 0건)
```

PRD E4/§6.4의 `targetFingerprint` 중복 제거는 여전히 안전장치로 유지할 값어치가 있으나, 우려했던 수준의 문제는 아닙니다.

### 2.5 C1 — 서술형 Scramble 변환 **9/9 검증**

정답 선지의 단어 순서를 공백으로 결합하면 원문 문장이 되고, **9/9 전부 원본 지문에서 verbatim으로 확인**되었습니다. 본문은 9/9에서 `( word / word / ... )` 그룹을 유지합니다.

```
PASS Hard-opt3   verified=true  words=11  "July 29, Monday Our club arrived at the Free Animals sanctuary."
PASS Easy-opt3   verified=true  words=14  "It was amazing to see bears and elephants moving freely in a large field."
```

PRD §6.3의 4단계 교차검증 절차가 그대로 동작합니다.

### 2.6 C2 — Cloze 단어목록 제거 **9/9 검증**

`Choose  =` 라인 제거 시 잔여 힌트 0건, 정답 목록은 빈칸 수와 정확히 일치(1~35개).

### 2.7 C3 — Cloze 빈칸 번호 역순 (**신규 발견, PRD 미반영**)

엔진이 빈칸 번호를 **읽는 순서와 다르게** 부여하는 경우가 있습니다. 9개 Cloze 중 **3개**:

```
Hard-opt5    [1,2,3,13,4,5,6,7,8,9,10,11,12,14]   ← 13번이 3번과 4번 사이
Normal-opt3  [1,2,3,4,7,5,6,8,...]
Normal-opt5  [1,2,6,3,4,5,7,...]
```

기준 PDF의 Cloze(Q7, Q23)는 순서대로였으므로, 현재는 **수동으로 교정하거나 운 좋게 순서대로 나온 것만 채택**하고 있을 가능성이 높습니다. 학생 입장에서 번호가 튀는 Cloze는 혼란스럽습니다.

→ **C3 변환(본문 + 정답 목록 동시 재번호)을 P0에 추가**해야 합니다. 구현·검증 완료: 9/9 교정 성공 (`parser.js: renumberCloze`).

### 2.8 엔진 자체 스택 경로가 기준 PDF 형식을 그대로 생산

`stackContent()` → `applyNumber()` 결과:

```
< Question 1 >  Correct Sentence        ← 기준 PDF와 동일 (>, 공백 2개)
< Question 2 >  Binary Word
...
< Answer 1 >  (5)
< Answer 4 >

1) leader
2) organized
...
```

그리고 **저작자 푸터를 자동으로 제거합니다** (스택 텍스트에 0건).

- **채택 경로는 여전히 §6.2 구조화 파싱(Path A)** — C1/C2/C3 변환, 문항 재배열·재생성, PDF/DOCX/HWPX 3종 렌더에 구조화 데이터가 필요합니다.
- 다만 스택 경로(Path B)는 **조판기 검증용 대조군**으로 유용합니다. 우리 렌더러의 번호 부여·정답 형식을 엔진 자체 출력과 비교해 회귀 테스트를 만들 수 있습니다.

### 2.9 저작자 푸터 처리 방침

푸터는 엔진 저작자의 크레딧입니다. 기준 PDF에는 없으므로 현재 수동으로 제거하고 있고, 문항마다 6줄이 붙으면 조판이 불가능하니 **문항 단위로는 제거**합니다. 대신 **앱의 크레딧/정보 화면에 원문 그대로 1회 표시**합니다 — 저작자 표시를 조용히 없애지 않는 것이 맞습니다. `parser.js`의 `FOOTER_LINES`에 보존되어 있습니다.

---

## 3. PRD 변경 필요 사항

| PRD 위치 | 변경 |
|---|---|
| §3.2 | 라이선스 검증 → **저작자 배너로 정정**. 일회용 토큰 게이트 + `dispatchEvent` 레시피 추가 |
| §5.1 P0 | **C3 Cloze 재번호 변환 추가** (신규 #15) |
| §6.1 | `contextIsolation: true` → **`false` + preload** (다이얼로그 트랩 요건). 엔진 파일 무수정 명시 |
| §6.3 | C1/C2 실데이터 검증 완료 표시, C3 절차 추가 |
| §6.5 | 문항당 타임아웃 3초 → 실측 36ms. 프라이밍/재시도 규칙 명문화 |
| §7.3 | 30문항 생성 < 60초 → **< 5초**로 상향 |
| §8.3 | E19(라이선스 거부) 해소. 신규 E35(토큰 미무장 시 재시도), E36(Cloze 번호 역순) |
| §10.1 | **R2 해소.** R7 해소. 신규 R8: 토큰 메커니즘은 비공개 내부 동작 → 엔진 버전 고정 + 기동 시 self-test |
| §10.2 | S1·S2 **완료** |
| §11 | Q4 해소(어순배열프로그램 무관), Q5 부분 해소(다양성 12/12) |
| §2.1 | 노트북 간 이동 → 프리셋·세션을 **프로젝트 폴더 상대 경로**에 저장 |

## 4. 산출물

| 파일 | 내용 |
|---|---|
| `spike/main.js` | 엔진 브리지 + S1/S2 하네스 (프로덕션 `EngineBridge`의 기반) |
| `spike/preload.js` | 다이얼로그 트랩 |
| `spike/parser.js` | **TA3 파서 + C1/C2/C3 변환** (프로덕션 `ResultParser`/`Transformers`의 기반) |
| `spike/verify.js` | 골든 코퍼스 전수 검증 |
| `spike/fixtures/passage.txt` | 기준 PDF에서 복원한 테스트 지문 |
| `spike/out/golden/**` (99개) | 골든 코퍼스 — 회귀 테스트 기준선 |
| `spike/out/report_s1.json`, `report_s2.json`, `verify.json` | 실행 기록 |
| `spike/out/stack_questions.txt`, `stack_answers.txt` | 엔진 자체 스택 출력 (조판기 대조군) |
| `spike/debug.js`, `probe2~5.js` | 진단 과정 기록 (레시피 도출 근거) |
