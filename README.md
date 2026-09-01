# Translation Layer (`st-translation-layer`)

SillyTavern extension: the chat LLM **only ever sees English**; you read and write in your own language (e.g. PT-BR).

- Canonical message text (`mes`) is always EN — the prompt is assembled natively in EN, no prompt interception.
- Your language is stored alongside as `extra.display_text` (ST renders it instead of `mes`).
- You type in your language → a configurable OpenAI-compatible translator model converts to EN on send (`MESSAGE_SENT`, awaited).
- LLM replies in EN → translator converts to your language on receipt (`MESSAGE_RECEIVED`, awaited).
- Edits/swipes/regens re-translate whichever side changed. Reasoning translation is off by default. Onomatopoeias stay as-is. Code blocks, URLs and proper names are preserved byte-for-byte.

Status: **v0.1 implemented, deployed via symlink** to `../SillyTavern/data/default-user/extensions/st-translation-layer/`.
Specs: `docs/PRB.md` (requirements, SC-1..SC-10) · `docs/SDD-0..3` (design) · `tasks/` (plan + todo).
Design rationale and verified ST source facts: `../brainstorms/2026-09-01-st-bidirectional-translation.md`.
First run: reload the ST UI, open **Extensions → Translation Layer**, set Base URL / API key / Model, press "Test connection".
