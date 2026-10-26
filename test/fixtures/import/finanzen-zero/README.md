# finanzen.net zero / Baader Bank parser fixtures

`buy.txt`, `sell.txt`, `dividend.txt`, `fund-distribution.txt`, `tax-refund.txt`, `tax-pot-no-booking.txt`
and `isin-change.txt` keep the layout of real Baader Bank documents as extracted by unpdf, but every
name, address, account and depot number, Vorgangs- and Referenz-Nr., Security and amount is anonymised.
Error cases (wrong totals, unknown positions, foreign currency, partial fills, Storno, …) are built in the
tests by string replacement on these files. Never commit real documents, real extracted text or personal
data (public repository).

Baader prints position lines as `<label> <amount>EUR` or `<label> <amount> -EUR`, signed relative to the
Kurswert (settlement) or Bruttobetrag (dividend). Only the lines between `Kurswert` and the `Zu Lasten/Zu
Gunsten Konto` line (settlement) or between `Bruttobetrag EUR` and the credited line (dividend) are read;
the later tax pages (`Steuerbeträge`, `Merkposten / Steuertöpfe`) are not.

## Adding an anonymised real sample

1. Extract the text of a local PDF (nothing is written into the repo; keep the output outside it):

   ```sh
   npm run -s extract-pdf-text -- ~/Downloads/abrechnung.pdf > /tmp/abrechnung.txt
   ```

2. Anonymise it: replace names, addresses, account, depot, Stamm- and Vorgangs-/Referenz-numbers,
   Security names, ISINs/WKNs (use a real-format ISIN with a valid check digit) and all amounts and
   dates. Keep the layout — labels, line breaks, glued tokens such as `EURKurswert` or
   `4,52EURValuta:`, column order and number formats — unchanged, and keep the amounts consistent
   (Kurswert = Stückzahl × Kurs, Kurswert ± positions = account total, Bruttobetrag − taxes − fees =
   credited amount, refunded tax lines = Erstattung).
3. Save it here as `<case>.txt` (never `*.pdf` or `*.csv`) and add a test in
   `src/modules/import/parsers/finanzen-zero/`.
