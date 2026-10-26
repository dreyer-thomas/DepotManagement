# Deutsche Bank / ROBIN parser fixtures

Every `*.txt` file here is **synthetic**: names, ISINs, account numbers, addresses and amounts are
invented and only mimic the layout of Deutsche Bank / ROBIN documents as extracted by unpdf. Never
commit real documents, real extracted text or personal data (public repository).

## Adding an anonymised real sample

1. Extract the text of a local PDF (nothing is written into the repo; keep the output outside it):

   ```sh
   npm run -s extract-pdf-text -- ~/Downloads/abrechnung.pdf > /tmp/abrechnung.txt
   ```

2. Anonymise it: replace names, addresses, account and depot numbers, order numbers, Security names,
   ISINs/WKNs (use a synthetic ISIN with a valid check digit) and all amounts and dates. Keep the
   layout — labels, line breaks, column order and number formats — unchanged, and keep the amounts
   consistent (Kurswert, fees, taxes and the booked total must add up).
3. Save it here as `<case>.txt` (never `*.pdf` or `*.csv`) and add a test in
   `src/modules/import/parsers/deutsche-bank/`.
