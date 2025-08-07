# leadorav2
leadorav2

## Contact Enrichment Security

- All contact enrichment (emails, phones, etc.) is now performed exclusively via the secure Netlify function `/api/enrich-decision-makers`.
- No enrichment logic or secrets are exposed to the frontend or bundled in client code.
- The file `src/tools/contact-enrichment.ts` is **deprecated** and should not be imported or used in any frontend or backend agent code. All enrichment must be triggered via the backend function.
