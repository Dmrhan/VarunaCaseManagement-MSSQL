// Excel dosyasını okuyup JSON'a çevirir (keşif/içe aktarma için).
// Kullanım: node scripts/read-xlsx.mjs "<path>" [--full]
import XLSX from 'xlsx';

const path = process.argv[2];
const full = process.argv.includes('--full');
if (!path) {
  console.error('path gerekli');
  process.exit(1);
}
const wb = XLSX.readFile(path);
console.log('Sheets:', JSON.stringify(wb.SheetNames));
for (const sheetName of wb.SheetNames) {
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
  console.log(`\n=== "${sheetName}" — ${rows.length} satır ===`);
  if (rows.length) console.log('kolonlar:', JSON.stringify(Object.keys(rows[0])));
  const out = full ? rows : rows.slice(0, 3);
  console.log(JSON.stringify(out, null, 2));
}
