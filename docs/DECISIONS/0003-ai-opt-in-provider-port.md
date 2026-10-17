# 0003 — AI as an opt-in provider behind a port, never in the loop by default

**Status:** accepted · **Date:** 2026-10-17 · **Context:** V0.1


Model assistance can improve structure suggestions but introduces privacy,
cost and honesty risks.

**Decision:** define `CaptureProvider`; ship `localProvider` as the default;
remote providers require explicit enablement, an endpoint and a session-only
key. Remote output is validated field-by-field, can never rewrite user text,
can never raise evidence above the local reading, and any failure falls back
to local capture with a notice. Private records are excluded unless allowed.

**Consequences:** the app is fully functional with AI off forever; disclosure
is a settings surface, not a footnote.

