# comdirect / cominvest parser fixtures

`buy.txt`, `sell.txt`, `dividend.txt` and `dividend-tax.txt` keep the layout of real comdirect documents
as extracted by unpdf, but every name, address, account and depot number, order and reference number and
amount is anonymised. `buy-fees.txt` (Provision + Börsenplatzgebühr) and `savings-plan.txt` (fractional
quantity) are **synthetic** variants of `buy.txt`. Never commit real documents, real extracted text or
personal data (public repository).

A comdirect settlement file carries its Steuermitteilung on later pages ("Steuerliche Behandlung: … Nr.
<Geschäftsnummer>"); a dividend comes as two files, the Ertragsgutschrift (`dividend.txt`) and its
Steuermitteilung (`dividend-tax.txt`), linked by the Referenz-Nummer.

## Adding an anonymised real sample

1. Extract the text of a local PDF (nothing is written into the repo; keep the output outside it):

   ```sh
   npm run -s extract-pdf-text -- ~/Downloads/abrechnung.pdf > /tmp/abrechnung.txt
   ```

2. Anonymise it: replace names, addresses, account and depot numbers, order and reference numbers,
   Security names, ISINs/WKNs (use a synthetic ISIN with a valid check digit) and all amounts and dates.
   Keep the layout — labels, line breaks, column order and number formats — unchanged, and keep the
   amounts consistent (Kurswert, fees, vor/nach Steuern and the taxes must add up; a Steuermitteilung must
   keep the Geschäftsnummer or Referenz-Nummer of its settlement or credit).
3. Save it here as `<case>.txt` (never `*.pdf` or `*.csv`) and add a test in
   `src/modules/import/parsers/comdirect/`.
