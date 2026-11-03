# 0005 — UTC canonical instants plus per-record timezone and precision

**Status:** accepted · **Date:** 2026-10-17 · **Context:** V0.1


Users move across timezones; day-coarse memories ('last week') are not
instants; hardcoding a zone would misstate history.

**Decision:** store UTC ISO-8601 with designator; keep the capture timezone and
a precision per record; display in the user's current zone; place day-coarse
records at local noon of the viewing zone so they never slip a day. No
hardcoded zone anywhere; 'device' follows the platform.

**Consequences:** DST tests pass for extreme zones; imports from other zones
stay correct.

