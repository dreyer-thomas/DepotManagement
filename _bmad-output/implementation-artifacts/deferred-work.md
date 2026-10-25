### DW-1: A server action POST without a valid session (e.g. "Abmelden" after the 7-day session expired) gets a 307 to /login from the proxy, which the client-side action fetch may not handle as a navigation.
origin: spec-deferred 07c043545a5b
location: src/proxy.ts:28
source_spec: `spec-1-2-single-user-login.md`
reason: Verified: POST /depots with a Next-Action header and no cookie returns 307 to /login?next=%2Fdepots (next start). Unverified: what the Next 16 client does with that 307 for a server action. Settle by letting the session expire in a browser, clicking "Abmelden" (or any later action), and observing whether the login page appears or an "unexpected response" error is thrown; if broken, answer action requests (Next-Action header) with a response the client can follow, plus a test.
status: open
