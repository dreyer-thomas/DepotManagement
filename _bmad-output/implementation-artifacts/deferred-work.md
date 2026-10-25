### DW-1: A server action POST without a valid session (e.g. "Abmelden" after the 7-day session expired) gets a 307 to /login from the proxy, which the client-side action fetch may not handle as a navigation.
origin: spec-deferred 07c043545a5b
location: src/proxy.ts:28
source_spec: `spec-1-2-single-user-login.md`
reason: Verified: POST /depots with a Next-Action header and no cookie returns 307 to /login?next=%2Fdepots (next start). Unverified: what the Next 16 client does with that 307 for a server action. Settle by letting the session expire in a browser, clicking "Abmelden" (or any later action), and observing whether the login page appears or an "unexpected response" error is thrown; if broken, answer action requests (Next-Action header) with a response the client can follow, plus a test.
status: open

### DW-2: The "Neue Buchung" form may lose some entered values after an error, if React 19's automatic form reset after an action also affects the MUI Select or Autocomplete inputs.
origin: spec-deferred 45744b75451b
location: src/app/_components/transactions/TransactionDialog.tsx
source_spec: `spec-1-4-record-buys-and-sells.md`
reason: maybe-false: every input is controlled (useState), and the same pattern is used in DepotDialogs (story 1.3), but no browser or DOM test has confirmed it. Settle by opening the dialog in a browser, submitting with an invalid quantity (e.g. "0") after filling every field including a new Security and Art, and checking that all values are still there.
status: open
