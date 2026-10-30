// 驗證 data.js：模型 id 唯一、必要欄位齊全、數字欄位不是 NaN、實測紀錄都對得到模型與量化檔
// 用法：node scripts/validate_data.mjs（失敗時 exit 1，給 GitHub Actions 用）
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(readFileSync(join(root, 'data.js'), 'utf8'), ctx, { filename: 'data.js' });
const { MODELS_DATABASE: models, HARDWARE_PROFILES: hardware, LOCAL_BENCHMARKS: benches = [], DATA_ASOF: asof } = ctx.window;

const errors = [];
const fail = msg => errors.push(msg);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const numOrNull = (v, where) => { if (v !== null && !isNum(v)) fail(`${where} 必須是數字或 null（目前是 ${JSON.stringify(v)}）`); };

const REQUIRED = ['id', 'name', 'family', 'paramsTotal', 'paramsActive', 'architecture', 'license', 'commercialAllowed',
  'contextWindow', 'nativeContext', 'arenaKey', 'arenaWebdevKey', 'arenaCodeElo', 'arenaWebdevElo', 'humanEval', 'sweBench',
  'liveCodeBench', 'tcGrade', 'tcQuantMinBit', 'tcQuantNote', 'jsonDisciplineScore', 'jsonNote', 'kvPerTokKB',
  'speedPrefillScore', 'speedDecodeRating', 'workloadFit', 'engineSupport', 'engineNotes', 'storageAdvise', 'examScore',
  'isDay16Featured', 'day16Role', 'editorial', 'quantProfiles', 'sources'];
const NUMERIC = ['paramsTotal', 'paramsActive', 'contextWindow', 'nativeContext', 'arenaCodeElo', 'arenaWebdevElo',
  'humanEval', 'sweBench', 'liveCodeBench', 'jsonDisciplineScore', 'kvPerTokKB', 'speedPrefillScore'];

if (!Array.isArray(models) || !models.length) fail('MODELS_DATABASE 是空的');
if (!asof || !asof.arena || !asof.specs) fail('DATA_ASOF 缺 arena 或 specs');

const ids = new Set();
for (const m of models || []) {
  const where = `模型 ${m.id || '(無 id)'}`;
  if (ids.has(m.id)) fail(`${where} 的 id 重複`);
  ids.add(m.id);
  for (const k of REQUIRED) if (!(k in m)) fail(`${where} 缺欄位 ${k}`);
  for (const k of NUMERIC) numOrNull(m[k], `${where}.${k}`);
  if (!['Dense', 'MoE'].includes(m.architecture)) fail(`${where}.architecture 只能是 Dense 或 MoE`);
  for (const k of ['prefill', 'decode', 'agent']) if (!isNum(m.workloadFit?.[k])) fail(`${where}.workloadFit.${k} 必須是數字`);
  const quants = Object.entries(m.quantProfiles || {});
  if (!quants.length) fail(`${where} 沒有任何 quantProfiles`);
  for (const [k, q] of quants) {
    numOrNull(q.sizeGB, `${where}.quantProfiles['${k}'].sizeGB`);
    numOrNull(q.bpw, `${where}.quantProfiles['${k}'].bpw`);
  }
  if (!m.sources?.arena || !m.sources?.specs) fail(`${where}.sources 至少要有 arena 與 specs`);
}

const hwIds = new Set((hardware || []).map(h => h.id));
const benchIds = new Set();
for (const b of benches) {
  const where = `實測 ${b.id || '(無 id)'}`;
  if (benchIds.has(b.id)) fail(`${where} 的 id 重複`);
  benchIds.add(b.id);
  const m = (models || []).find(x => x.id === b.modelId);
  if (!m) fail(`${where} 的 modelId '${b.modelId}' 不存在`);
  else if (b.quantKey !== null && !m.quantProfiles[b.quantKey]) fail(`${where} 的 quantKey '${b.quantKey}' 不在 ${m.id} 的 quantProfiles`);
  if (!hwIds.has(b.platform)) fail(`${where} 的 platform '${b.platform}' 不是已知硬體`);
  numOrNull(b.decode, `${where}.decode`);
  for (const [n, v] of Object.entries(b.aggregate || {})) numOrNull(v, `${where}.aggregate[${n}]`);
  if (b.prefill) { numOrNull(b.prefill.tokPerSec, `${where}.prefill.tokPerSec`); numOrNull(b.prefill.promptTokens, `${where}.prefill.promptTokens`); }
  if (!b.source) fail(`${where} 沒有 source`);
}

if (errors.length) {
  console.error(errors.map(e => `錯誤：${e}`).join('\n'));
  process.exit(1);
}
console.log(`data.js 驗證通過：${models.length} 款模型、${hardware.length} 個硬體設定、${benches.length} 筆實測`);
