// Taksonomi etiket guncellemeleri (TaxonomyDef). DRY-RUN default; --commit ile yazar.
// Idempotent: zaten uygulanmis rename/insert'ler atlanir.
import('../server/db/client.js').then(async ({ prisma }) => {
  const commit = process.argv.includes('--commit');
  const anyG = await prisma.taxonomyDef.findFirst({ where: { taxonomyType: 'rootCauseGroup' }, select: { companyId: true } });
  if (!anyG) { console.error('rootCauseGroup bulunamadi'); process.exit(1); }
  const companyId = anyG.companyId;

  const renames = [
    { type: 'rootCauseGroup', code: 'rcg.cihaz_mobil_ortam',          label: 'Donanım/Cihaz' },
    { type: 'rootCauseGroup', code: 'rcg.yazilim_hatasi',             label: 'Uygulama Hatası' },
    { type: 'rootCauseGroup', code: 'rcg.e_belge_entegrator_3_parti', label: 'Entegratör (3.parti)' },
    { type: 'rootCauseGroup', code: 'rcg.kullanim_egitim',            label: 'Kullanım/Bilgi Eksikliği' },
    { type: 'resolutionType', code: 'rt.egitim',                      label: 'Kullanıcı Eğitim' },
    { type: 'resolutionType', code: 'rt.urun_gelistirme',             label: 'Geliştirme / değişiklik talebi' },
  ];
  const newGroups = [
    { code: 'rcg.e_belge_gonderim', label: 'E-belge (Gönderim)' },
    { code: 'rcg.kosul_yakalanmadi', label: 'Koşul Yakalanmadı' },
  ];

  console.log(commit ? '=== COMMIT MODU ===' : '=== DRY-RUN (yazmaz) ===');
  console.log('companyId:', companyId, '\n--- rename ---');
  for (const r of renames) {
    const cur = await prisma.taxonomyDef.findFirst({ where: { taxonomyType: r.type, code: r.code }, select: { label: true } });
    if (!cur) { console.log(`! BULUNAMADI: ${r.code}`); continue; }
    const same = cur.label === r.label;
    console.log(`${same ? '(atlandi, zaten)' : (commit ? 'UPDATE' : '[dry]')} ${r.code}: "${cur.label}" ${same ? '' : '-> "' + r.label + '"'}`);
    if (commit && !same) await prisma.taxonomyDef.updateMany({ where: { companyId, taxonomyType: r.type, code: r.code }, data: { label: r.label } });
  }
  console.log('--- yeni gruplar ---');
  let sort = (await prisma.taxonomyDef.findFirst({ where: { taxonomyType: 'rootCauseGroup' }, orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } }))?.sortOrder ?? 0;
  for (const g of newGroups) {
    const exists = await prisma.taxonomyDef.findFirst({ where: { taxonomyType: 'rootCauseGroup', code: g.code } });
    if (exists) { console.log(`(atlandi, zaten var) ${g.code}`); continue; }
    sort += 1;
    console.log(`${commit ? 'INSERT' : '[dry]'} ${g.code} = "${g.label}" (sortOrder ${sort})`);
    if (commit) await prisma.taxonomyDef.create({ data: { companyId, taxonomyType: 'rootCauseGroup', code: g.code, label: g.label, sortOrder: sort, isActive: true } });
  }
  console.log('\n' + (commit ? '✓ TAMAMLANDI' : 'DRY-RUN bitti. --commit ile uygula'));
  process.exit(0);
}).catch((e) => { console.error('HATA:', e.message); process.exit(1); });
