import fs from 'node:fs';
import path from 'node:path';

import { parse as csvParse } from 'csv-parse';
import cliProgress from 'cli-progress';

import { cityName, MachiAzaApi, machiAzaName, PrefectureApi, prefectureName, SingleCity, SinglePrefecture, SingleMachiAza } from '../data.js';
import { HeaderRow } from '../address_data.js';

function readUntilHeaderEnd(path: string): Promise<Buffer> {
  const HEADER_END = Buffer.from('=END=\n', 'utf8');
  return new Promise((resolve, reject) => {
    const readStream = fs.createReadStream(path);
    const chunks: Buffer[] = [];
    let foundEnd = false;
    readStream.on('data', (chunk: Buffer) => {
      if (foundEnd) {
        return;
      }
      const headerEndPos = chunk.indexOf(HEADER_END);
      if (headerEndPos !== -1) {
        foundEnd = true;
        readStream.close();
        chunks.push(chunk.subarray(0, headerEndPos));
      } else {
        chunks.push(chunk);
      }
    });
    readStream.on('close', () => {
      resolve(Buffer.concat(chunks));
    });
    readStream.on('error', (err) => {
      reject(err);
    });
  });
}

export async function getRangesFromCSV(path: string): Promise<undefined | HeaderRow[]> {
  try {
    const headerData = await readUntilHeaderEnd(path);
    const headerStream = csvParse(headerData);
    const rows: HeaderRow[] = [];
    for await (const line_ of headerStream) {
      const line = line_ as [string, string, string];
      if (line[0] === '=END=') {
        break;
      }
      const [name, start, length] = line;
      rows.push({
        name,
        offset: parseInt(start),
        length: parseInt(length),
      });
    }
    return rows;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw e;
  }
}

/**
 * 住居表示のデータを持つ町字の rsdt フラグを true にする。
 *
 * 02 で付く rsdt は ABR 町字マスターの rsdt_addr_flg そのままだが、ABR 上は「住居表示非実施」(flg=0) でも
 * 住居表示-住居マスターに行が存在する町字がある。そうした町字を rsdt なし(=地番扱い)にすると、
 * 利用側は住居表示データを引かず、地番データでも引けなくなる。
 * そのため「flg=1、または住居表示データが有る」町字だけが rsdt: true になるようにここで補う。
 * 住居表示データが無く flg=0 の町字は rsdt なし(地番扱い)のままになる。
 * @param ma 町字(csv_ranges が設定済みであること)。破壊的に更新する
 */
export function applyRsdtFlagFromCsvRanges(ma: SingleMachiAza): void {
  if (ma.csv_ranges?.['住居表示']) {
    ma.rsdt = true;
  }
}

async function main(argv: string[]) {
  const apiDir = argv[2] || path.join(import.meta.dirname, '..', '..', 'out', 'api');
  const jaFile = path.join(apiDir, 'ja.json');
  const api = JSON.parse(fs.readFileSync(jaFile, 'utf-8')) as PrefectureApi;

  const progress = new cliProgress.SingleBar({
    format: ' {bar} {percentage}% | ETA: {eta_formatted} | {value}/{total}',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    etaBuffer: 30,
    fps: 2,
    // No-TTY output is required for CI/CD environments
    noTTYOutput: true,
  });

  const flatCities: [SinglePrefecture, SingleCity][] = [];
  for (const pref of api.data) {
    for (const city of pref.cities) {
      flatCities.push([pref, city]);
    }
  }

  progress.start(flatCities.length, 0);
  try {
    for (const [pref, city] of flatCities) {
      const cityPrefix = path.join(apiDir, 'ja', prefectureName(pref), cityName(city));
      const [
        chibanHeader,
        rsdtHeader,
      ] = await Promise.all([
        getRangesFromCSV(`${cityPrefix}-地番.txt`),
        getRangesFromCSV(`${cityPrefix}-住居表示.txt`),
      ]);

      if (!chibanHeader && !rsdtHeader) {
        progress.increment();
        continue;
      }

      const maData = JSON.parse(await fs.promises.readFile(`${cityPrefix}.json`, 'utf8')) as MachiAzaApi;
      // CSVレンジを一旦全クリア
      for (const ma of maData.data) {
        ma.csv_ranges = undefined;
      }
      for (const headerRow of chibanHeader || []) {
        const ma = maData.data.find((ma) => machiAzaName(ma) === headerRow.name);
        if (ma) {
          ma.csv_ranges = ma.csv_ranges || {};
          ma.csv_ranges['地番'] = { start: headerRow.offset, length: headerRow.length };
        }
      }
      for (const headerRow of rsdtHeader || []) {
        const ma = maData.data.find((ma) => machiAzaName(ma) === headerRow.name);
        if (ma) {
          ma.csv_ranges = ma.csv_ranges || {};
          ma.csv_ranges['住居表示'] = { start: headerRow.offset, length: headerRow.length };
          applyRsdtFlagFromCsvRanges(ma);
        }
      }

      await fs.promises.writeFile(`${cityPrefix}.json`, JSON.stringify(maData));

      progress.increment();
    }
  } finally {
    progress.stop();
  }
}

export default main;
