# Proxima — Built-in Provider DOM Selectors for Model/Effort Selection

**Source:** Session `20260809` — DOM inspection via `POST /v1/execute` endpoint
**Author:** OWL (Larry Cai)
**Date:** 2026-08-09

## Claude (claude.ai)

### Model selector
- **Selector:** `button[aria-label^="Model:"]`
- **Current text:** `"Sonnet 5 Max"`
- **Aria label:** `"Model: Sonnet 5 Max"`
- **Dropdown role:** `[role="option"]`
- **Dropdown options (observed):**
  - `"Fable 5"` (Pro, upgrade required)
  - `"Opus 5"` (Pro, upgrade required)
  - `"Sonnet 5"` (current, free)
  - `"Haiku 4.5"` (fastest)
  - `"EffortMax"` (thinking effort toggle)
  - `"More models"` (expands further)
- **Click flow:** Click button → wait ~400ms for dropdown → find `[role="option"]` whose `textContent` contains the model name → click it
- **Fallback:** Scan all visible `div, span, [role="option"]` elements for model name text, pick the deepest one (to avoid matching parent containers)

### Effort selector
- **Selector:** Same dropdown, option `[role="option"]` with text containing "EffortMax"
- **Click flow:** Open model dropdown → find "EffortMax" option → click it

### Implementation notes
- Model selection must happen BEFORE conversation creation (`_createConversation`), because the model is baked into the conversation on the server
- The `send()` function signature is `(message, engine, attachments, sessionId)`
- `engine` parameter should be used to select model before calling `_getOrgId()`

---

## ChatGPT (chatgpt.com)

### Model selector
- **No explicit model picker button found** — ChatGPT has abstracted model selection behind mode tabs
- **Mode tabs:** Two buttons with `role="radio"`:
  - `btn[65]` text=`"Chat"` — general chat mode
  - `btn[66]` text=`"Work"` — work/productivity mode
- **No model names (GPT-4o, o1, o3, etc.) visible in the page DOM** — model selection is fully abstracted

### Effort / reasoning selector
- **Selector:** `.__composer-pill` class button
- **Current text:** `"High"`
- **Likely values:** High, Medium, Low (click cycles through options)
- **Location:** In the composer toolbar, sibling to file upload and dictation buttons

### Composer structure
- **Composer container:** `form.group/composer`
- **Input area:** `div[contenteditable="true"]` within `.prosemirror-parent`
- **Toolbar buttons (in order):**
  - `btn[aria-label="Add files and more"]` (data-testid="composer-plus-btn")
  - `.__composer-pill` with text="High" (reasoning effort)
  - Dictation button
  - Voice submit button
- **Page structure:** Sidebar with conversation history, composer at bottom, no visible model picker

### Implementation notes
- Model selection is not directly controllable — users can only choose Chat/Work mode
- Effort selection via `.__composer-pill` button — click cycles through effort levels
- The `send()` function signature is `(message, engine, attachments, sessionId)`
- `engine` parameter could map to "Chat" or "Work" mode by clicking the appropriate radio button

---

## Gemini (gemini.google.com)

### Model selector
- **Selector:** `button[aria-label="Open mode picker, currently ..."]`
- **Current text:** `"Gemini 3.5 Flash-Lite"`
- **Aria label:** `"Open mode picker, currently 3.5 Flash-Lite"`
- **Click flow:** Click button → wait for dropdown → find option by text → click it
- **Note:** Gemini was NOT logged in during inspection, so the dropdown options were not visible

### Status
- **Login state:** ❌ Not logged in ("Sign in" button visible at `btn[3]`)
- **Model options:** Unknown — requires login to inspect further

### Implementation notes
- The `send()` function signature is `(message, engine, attachments, sessionId, _isRetry)`
- `engine` parameter maps to Gemini model names like "3.5-flash", "3.1-pro", "2.5-pro", etc.
- The `geminiModel` parameter in the REST API maps to engine values
- Once logged in, the model picker dropdown should show options like "2.0 Flash", "2.5 Pro", "2.5 Flash", "1.5 Pro", etc.

---

## Perplexity (perplexity.ai)

### Model selector
- **Selector:** `button[aria-label="Model" i]`
- **Current text:** `"Model"`
- **Aria label:** `"Model"`
- **Click flow:** Click button → wait for dropdown → find option by text → click it
- **Note:** Perplexity was NOT logged in during inspection, so the dropdown options were not visible

### Mode tabs
- **Search mode:** `btn[9]` text=`"Search"` — web search mode
- **Computer mode:** `btn[10]` text=`"Computer"` — computer-use mode

### Status
- **Login state:** ❌ Not logged in (showing "Continue with Google", "Continue with Apple", "Continue with email", "Single sign-on (SSO)" buttons)
- **Model options:** Unknown — requires login to inspect further

### Implementation notes
- The `send()` function signature is `(message, engine, attachments, sessionId)`
- `engine` parameter could map to Perplexity model names like "sonar", "sonar-pro", etc.
- The model dropdown likely shows options like "Perplexity", "Sonar", "Sonar Pro", "Claude", "GPT-4o", etc.
- Search/Computer mode tabs could be used for behavior selection

---

## Summary of known selectors

| Provider | Model button | Option role | Effort |
|---|---|---|---|
| Claude | `button[aria-label^="Model:"]` | `[role="option"]` | "EffortMax" in dropdown |
| ChatGPT | N/A (Chat/Work radio tabs) | `button[role="radio"]` | `.__composer-pill` |
| Gemini | `button[aria-label*="Open mode picker"]` | Unknown (needs login) | Unknown |
| Perplexity | `button[aria-label="Model"]` | Unknown (needs login) | N/A |

## REST API model routing

The REST API maps model strings to providers via `MODEL_ALIASES` in `electron/api/rest-api.cjs`:

```
chatgpt, gpt, gpt-4, gpt-4o, gpt-4.5, openai → chatgpt
claude, claude-3, claude-3.5, claude-4, anthropic, sonnet, opus, haiku → claude
gemini, gemini-pro, gemini-2, gemini-2.5, google, bard → gemini
perplexity, pplx, sonar → perplexity
zai, chat.z.ai, glm → zai
kimi, moonshot → kimi
deepseek, ds → deepseek
auto → auto (pick best)
all → all (query all)
```

The `engine` parameter (second argument to `send()`) is passed through from the REST API's `provider:model:effort` format. For example:
- `model="zai:glm-4.7:thinking"` → provider=zai, engine=glm-4.7, effort=thinking
- `model="claude:haiku"` → provider=claude, engine=haiku
- `model="gemini:2.5-pro"` → provider=gemini, engine=2.5-pro

The `engine` parameter is currently **ignored** by the built-in providers (ChatGPT, Claude, Gemini, Perplexity). The model selectors described above would make it functional.