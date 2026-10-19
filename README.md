# FormSentry

A Chrome / Microsoft Edge extension (Manifest V3) that adds a **monitoring and restriction layer** around existing Google Forms exams.

Google Forms stays responsible for questions, answers, submission, scores, and responses. This extension does **not** replace it, and it never reads or modifies form content.

---

## How it works

```
Student opens approved Google Form
        ↓
Extension detects the form and shows "● Ready"
        ↓
Student clicks "Start exam monitoring"
        ↓
Browser-level monitoring activates
        ↓
Suspicious activity is logged / restricted
        ↓
Student returns to the form and continues
        ↓
Form submitted (or monitoring ended) → ALL monitoring stops
```

Monitoring only runs for forms the teacher has explicitly approved, and only after the student starts the exam.

---

## Features

| Area | What it does |
|---|---|
| **Form detection** | Recognizes `docs.google.com/forms/...` pages; activates only for teacher-approved form URLs |
| **Tab switching** | Logs `TAB_SWITCH` / `TAB_RETURN` with time away and destination domain |
| **New tabs** | Allow, monitor, or block (default: block and return to exam) |
| **Website rules** | Teacher-editable domain lists by category (AI, search, communication) with allowed / monitored / blocked rules |
| **AI site detection** | Detects AI domains (ChatGPT, Claude, Gemini, Copilot, Perplexity by default) from the tab's domain only |
| **Blocking** | Replaces blocked pages with an "Access restricted" page and a **Return to Exam** button |
| **Fullscreen** | Optional or required; logs enter/exit and time outside fullscreen |
| **Focus / visibility** | Logs page hidden/visible and window blur/focus as low-severity monitoring events |
| **Copy / cut / paste** | Monitor or block browser-level clipboard actions |
| **Right-click** | Allow, monitor, or block the context menu |
| **Shortcuts** | Monitors F12, Ctrl+Shift+I/J/C, Ctrl+U/S/P and blocks them where the browser allows |
| **PDF in browser** | Logs `PDF_OPENED` when another tab loads a `.pdf` URL |
| **Network** | Logs `NETWORK_DISCONNECTED` / `NETWORK_RECONNECTED` |
| **Disconnect detection** | A heartbeat logs `EXTENSION_DISCONNECTED` after a long gap mid-exam |
| **Event log & score** | Local log with severity, weighted score, JSON export |
| **Demo mode** | Simulated events, clearly labelled `SIMULATED EVENT` and excluded from the score |

Events are described as **"potential violations"** for teacher review. The score is **not proof of cheating**.

---

## What it cannot do

This is a standard browser extension. It is honest about its limits:

**Not possible**

- Detecting desktop applications (Microsoft Word, Notepad, Adobe Acrobat, Windows PDF viewers)
- Reliably blocking Alt+Tab, the Windows key, Ctrl+Alt+Delete, or other OS-level shortcuts
- Preventing DevTools opened from browser menus
- Detecting phones or other physical devices
- Reading ChatGPT or other AI site conversations (only the domain is visible)
- Guaranteeing that a student cannot cheat

Fullscreen mode does **not** stop OS-level switching.

**For stronger control**, institutions need managed ChromeOS devices, browser or Windows kiosk mode, device management, or dedicated desktop exam software. The `DESKTOP_APPLICATION_OPENED` event type is reserved for a future optional desktop monitoring client. Today it is only available as a simulated event in demo mode.

---

## Privacy

- Monitoring runs **only** while an approved exam has been started.
- Nothing is monitored outside the exam: no personal browsing, history, files, passwords, private messages, webcam, or microphone.
- The extension does **not** scrape answers, read questions, modify responses, submit the form, or need access to the teacher's Google account.
- Students see a persistent notice: *"Monitoring is active only during this examination."*
- Events are stored locally in `chrome.storage.local`. If the optional dashboard endpoint is configured, events are also POSTed there.

Institutions should tell students what is monitored and obtain any consent required by local policy before use.

---

## Permissions

| Permission | Why it is needed |
|---|---|
| `storage` | Save exam configuration, session state, and the event log |
| `tabs` | Read the URL/domain of other tabs, only while an exam is active, to detect tab switches and restricted sites |
| `alarms` | Heartbeat used to detect extension/browser disconnection |
| `https://docs.google.com/forms/*` | Run the content script on Google Forms pages |

---

## Installation (development)

1. Clone or download this repository.
2. Open `chrome://extensions` (or `edge://extensions`).
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the extension folder.
5. Pin the extension from the puzzle-piece menu.

After changing code, click the refresh icon on the extension's card and reload the form.

---

## Usage

### Teacher setup

1. Click the extension icon → **Teacher settings** (or right-click → Options).
2. Under **Add exam**, enter a name and the form's `viewform` URL, for example:
   `https://docs.google.com/forms/d/e/XXXXXXXX/viewform`
3. Choose the mode and rules per exam.
4. Edit domain rules in the **Domain rules** box, one per line:
   ```
   domain,CATEGORY[,ALLOWED|MONITORED|BLOCKED]
   ```
   Domains in the `AI` category follow the exam's **AI websites** rule.
5. Optionally set a dashboard endpoint that receives each event as JSON.

### Per-exam settings

| Setting | Options | Default |
|---|---|---|
| Mode | `DETECTION` / `RESTRICTION` | `RESTRICTION` |
| Tab switching | `OFF` / `MONITOR` / `BLOCK` | `MONITOR` |
| New tabs | `ALLOW` / `MONITOR` / `BLOCK` | `BLOCK` |
| AI websites | `ALLOW` / `MONITOR` / `BLOCK` | `BLOCK` |
| Copy / paste | `ALLOW` / `MONITOR` / `BLOCK` | `BLOCK` |
| Fullscreen | `OPTIONAL` / `REQUIRED` | `REQUIRED` |
| Developer tools | `MONITOR` / `RESTRICT` | `RESTRICT` |
| Right-click | `ALLOW` / `MONITOR` / `BLOCK` | `BLOCK` |

In `DETECTION` mode, every `BLOCK` / `RESTRICT` setting is downgraded to monitor-only.

> Blocking paste also blocks it in short-answer fields. Use `MONITOR` for exams where students type long answers.

### Student flow

1. Open the approved form. A small overlay shows **● Ready**.
2. Click **Start exam monitoring** (this click also enables fullscreen).
3. Answer the form normally. The overlay stays small and can be dragged out of the way.
4. Submit the form. Monitoring stops automatically.

---

## Event types

| Severity | Events |
|---|---|
| **HIGH** | `AI_WEBSITE_DETECTED`, `BLOCKED_WEBSITE_DETECTED`, `DEVTOOLS_ATTEMPT`, `DESKTOP_APPLICATION_OPENED` |
| **MEDIUM** | `TAB_SWITCH`, `NEW_TAB_OPENED`, `FULLSCREEN_EXIT`, `COPY_ATTEMPT`, `CUT_ATTEMPT`, `PASTE_ATTEMPT`, `KEYBOARD_RESTRICTION_ATTEMPT`, `PDF_OPENED`, `EXTENSION_DISCONNECTED`, `EXAM_TAB_CLOSED` |
| **LOW** | `EXAM_STARTED`, `EXAM_ENDED`, `TAB_RETURN`, `WINDOW_BLUR`, `WINDOW_FOCUS`, `PAGE_HIDDEN`, `PAGE_VISIBLE`, `FULLSCREEN_ENTER`, `CONTEXT_MENU_ATTEMPT`, `NETWORK_DISCONNECTED`, `NETWORK_RECONNECTED` |

Event shape:

```json
{
  "id": "evt_lx4k2a9f",
  "type": "TAB_SWITCH",
  "timestamp": "2026-09-29T10:30:25.000Z",
  "examUrl": "https://docs.google.com/forms/d/e/XXXX/viewform",
  "domain": "chatgpt.com",
  "severity": "MEDIUM",
  "sessionId": "s_lx4k1z",
  "metadata": {}
}
```

### Monitoring score

| Event | Weight |
|---|---|
| Tab switch, fullscreen exit, copy/cut/paste, new tab, blocked shortcut, PDF opened | 1 |
| Blocked website, AI website, developer tools attempt | 3 |

The UI reports **Monitoring Events** (all events) and **Potential Violations** (weighted events). Simulated events are excluded.

---

## Project structure

```
gf-anticheat/
├── manifest.json     Manifest V3 configuration
├── background.js     Service worker: sessions, tab/window monitoring, domain rules, event log
├── content.js        Google Forms page: overlay, fullscreen, clipboard, shortcuts, focus
├── popup.html/js     Student popup (status and end monitoring)
├── options.html/js   Teacher settings, event log, demo mode, limitations
└── blocked.html/js   "Access restricted" page with Return to Exam
```

---

## Testing

Use a real Google Form and check:

1. Open the approved form and start monitoring.
2. Switch tabs and return; verify `TAB_SWITCH` / `TAB_RETURN` and duration.
3. Open a new tab; verify it closes and you return to the exam.
4. Visit `chatgpt.com`; verify detection and the block page.
5. Try copy, paste, right-click, F12; verify logging and blocking.
6. Exit fullscreen; verify the warning overlay and `FULLSCREEN_EXIT`.
7. Submit the form; verify `EXAM_ENDED` and that nothing is logged afterwards.

Also check for false positives: accidental clicks outside the browser, brief network drops, refreshing the form, and returning after a short interruption. Use **Demo / test mode** in Teacher settings for simulated events.

---

## Known limitations of this prototype

- No server-backed teacher dashboard or real-time updates yet.
- Exam-code activation (Method B) is not implemented; only teacher-approved URLs work.
- The popup's **End monitoring** button lets a student stop monitoring. This is logged, but not prevented.
- Server-side verification of exam ID, session, extension status, and timestamps is not implemented.
- The event log lives in local browser storage and can be cleared by anyone with access to Teacher settings.

---

## Roadmap

- [ ] Teacher dashboard (web) with live session view and event streaming
- [ ] Server-side session and timestamp verification
- [ ] Exam-code activation
- [ ] Teacher PIN to end sessions and to edit settings
- [ ] Optional native desktop companion for application detection (with explicit consent)
- [ ] Automated tests and CI

---

## Disclaimer

This tool reports detected browser activity for a teacher to review. A logged event is not proof of misconduct, and the tool does not guarantee academic integrity. Use it as one signal among several, with clear disclosure to students.

