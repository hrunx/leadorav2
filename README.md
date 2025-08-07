# leadorav2
leadorav2

## Contact Enrichment Security

- All contact enrichment (emails, phones, etc.) is performed via the secure Netlify function `/.netlify/functions/enrich-decision-makers`.
- No enrichment logic or secrets are exposed to the frontend or bundled in client code.
- The file `src/tools/contact-enrichment.ts` is used only by server-side functions and should not be imported directly by agents or frontend code.
