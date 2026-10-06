import assert from 'node:assert';
import test, { describe } from 'node:test';

import { applyRsdtFlagFromCsvRanges } from './10_refresh_csv_ranges.js';
import { SingleMachiAza } from '../data.js';

await describe('applyRsdtFlagFromCsvRanges', async () => {
  await test('ABR が非実施(rsdt なし)でも住居表示データが有れば rsdt: true にする', () => {
    const ma: SingleMachiAza = { machiaza_id: '0001001', csv_ranges: { 住居表示: { start: 1, length: 2 } } };
    applyRsdtFlagFromCsvRanges(ma);
    assert.equal(ma.rsdt, true);
  });

  await test('住居表示データが無く rsdt なしの町字は地番扱いのまま', () => {
    const ma: SingleMachiAza = { machiaza_id: '0001002', csv_ranges: { 地番: { start: 1, length: 2 } } };
    applyRsdtFlagFromCsvRanges(ma);
    assert.equal(ma.rsdt, undefined);
  });

  await test('csv_ranges が無い町字は変更しない', () => {
    const ma: SingleMachiAza = { machiaza_id: '0001003' };
    applyRsdtFlagFromCsvRanges(ma);
    assert.equal(ma.rsdt, undefined);
  });

  await test('ABR が実施(rsdt: true)で住居表示データが無い町字は true のまま', () => {
    const ma: SingleMachiAza = { machiaza_id: '0001004', rsdt: true };
    applyRsdtFlagFromCsvRanges(ma);
    assert.equal(ma.rsdt, true);
  });
});
