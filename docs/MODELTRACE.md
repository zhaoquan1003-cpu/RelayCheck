# ModelTrace integration

Advanced mode vendors the MIT-licensed ModelTrace fingerprint core and bank.

Source: <https://github.com/xqy2006/ModelTrace>

Pinned commit:

```text
6cd4a8ff0f3f4e49d6d6969dd2fbadfa1569fde2
```

Files:

```text
vendor/modeltrace/
  fingerprint-core.js      # analyzeGlobalOutputs, parseNumbers
  challenge-browser.js     # generateChallenges: 3 lengths in [292, 332]
  unified_bank.json        # 18 candidate models, robust features, calibration
  LICENSE                  # MIT
  NOTICE                   # source + commit + attribution
```

## Flow

1. `createAdvancedChallenges(3)` generates 3 independent prompts with random lengths/openings/endings/separators.
2. The worker sends the 3 prompts concurrently through the selected API adapter.
3. Each answer is parsed to its longest digit run.
4. A response is accepted if it contains at least `max(80, ceil(expected_count * 0.55))` numbers.
5. `analyzeGlobalOutputs` combines valid outputs and runs the global robust fingerprint:
   `0.75 * Hellinger model-centroid similarity (with nuisance projection) + 0.25 * ordered-block feature`, then calibrated softmax.
6. The returned report is stored as `fingerprint` on the test and shown in the detail dialog.

## Verdict

- If the predicted model name equals the tested model name (normalized), verdict `pass`.
- Else if both target and predicted models are present in `config/model-tiers.json`, compare numeric tiers:
  predicted >= target → `pass`; lower → `fail`.
- Else verdict `unknown`, and the UI only shows the fingerprint.

The empty default `config/model-tiers.json` is intentional: we do not invent a capability ranking. `config/model-tiers.example.json` is a demonstration only.

## Important caveats

- Closed-set, uniform-prior probability; an unlisted model is still mapped to the closest candidate.
- Three long-number prompts are sensitive to system prompts and tool wrappers.
- The official challenge prompt distribution must be preserved for the pretrained bank. If you change prompt templates or lengths, retrain/rebuild the bank instead of reusing it.
- Do not present a fingerprint as proof of identity or capability.

## Updating

1. Pick a new upstream commit.
2. Re-download the three files at that exact commit.
3. Update `NOTICE`, `README.md`, and this document with the SHA.
4. Run unit/integration tests, including `tests/unit/modeltrace.test.ts`.
5. Re-run a known live sample and compare sanity (no strict accuracy guarantee).

Do not edit the official challenge prompts in place unless you also rebuild the bank.