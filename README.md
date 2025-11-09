# HAb_DB
A database of Hydrogen Abstraction Reactions

## Exporting reactions

You can generate a shareable snapshot of every reaction (geometry, properties, and kinetics) as follows:

```bash
python -m ingest.export_reactions --out /tmp/hab_export
```

This creates:

- `manifest.json` with high-level metadata and an index of reaction folders.
- One folder per reaction (`00001_rxn-name/`) containing:
  - `participants.sdf` – the R1H/R2/TS/R1/R2H conformers with all stored properties on each record.
  - `reaction.json` – reaction metadata plus rate-model entries (if any).

Use `--reaction-id 12 34` to export only specific reactions. Zip the output directory to publish a fixed dataset.
