#!/usr/bin/env node
/**
 * Tek seferlik veri düzeltme — ExternalMailSetting + FromAlias kopyala.
 *
 * Senaryo: Aynı isim (örn. "UNIVERA") iki Company kaydında var;
 * admin mail entegrasyonu SOURCE companyId'ye kaydedilmiş ama vakalar
 * TARGET companyId'ye bağlı → İletişim sekmesi "yapılandırılmamış"
 * banner'ı.
 *
 * Bu script SOURCE → TARGET için tüm setting alanlarını + FromAlias
 * kayıtlarını UPSERT eder.
 *
 * Güvenlik:
 *  - secretCiphertext/Iv/AuthTag AYNEN kopyalanır (decrypt/re-encrypt YOK).
 *    Aynı DEVOPS_PAT_ENC_KEY ile her iki tenant'ta da çalışır.
 *  - Idempotent: TARGET'ta varsa üzerine yazılır.
 *  - --dry-run: hiçbir şey yazmaz; sadece ne yapacağını gösterir.
 *
 * Kullanım:
 *   node scripts/copy-mail-setting.mjs --source <SRC_CID> --target <TGT_CID> [--dry-run]
 *
 * Örnek:
 *   node scripts/copy-mail-setting.mjs \
 *     --source clr_univera_old \
 *     --target clr_univera_new \
 *     --dry-run
 */

import { prisma } from '../server/db/client.js';

function arg(name) {
  const i = process.argv.findIndex((a) => a === `--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
}

const SOURCE = arg('source');
const TARGET = arg('target');
const DRY_RUN = process.argv.includes('--dry-run');

if (!SOURCE || !TARGET) {
  console.error('Kullanım: node scripts/copy-mail-setting.mjs --source <SRC_CID> --target <TGT_CID> [--dry-run]');
  process.exit(2);
}
if (SOURCE === TARGET) {
  console.error('SOURCE ve TARGET aynı companyId — hiçbir şey yapılmaz.');
  process.exit(2);
}

console.log('═══════════════════════════════════════════════════════════');
console.log(`SOURCE: ${SOURCE}`);
console.log(`TARGET: ${TARGET}`);
console.log(`MODE  : ${DRY_RUN ? 'DRY-RUN (yazım YOK)' : 'COMMIT'}`);
console.log('═══════════════════════════════════════════════════════════\n');

async function main() {
  // 1) Company doğrula
  const [srcCo, tgtCo] = await Promise.all([
    prisma.company.findUnique({ where: { id: SOURCE }, select: { id: true, name: true } }),
    prisma.company.findUnique({ where: { id: TARGET }, select: { id: true, name: true } }),
  ]);
  if (!srcCo) throw new Error(`SOURCE Company yok: ${SOURCE}`);
  if (!tgtCo) throw new Error(`TARGET Company yok: ${TARGET}`);
  console.log(`SOURCE Company: ${srcCo.name} (${srcCo.id})`);
  console.log(`TARGET Company: ${tgtCo.name} (${tgtCo.id})\n`);

  // 2) SOURCE setting fetch
  const src = await prisma.externalMailSetting.findUnique({
    where: { companyId: SOURCE },
  });
  if (!src) throw new Error(`SOURCE ExternalMailSetting yok: ${SOURCE}`);
  console.log('SOURCE ExternalMailSetting bulundu:');
  console.log(`  enabled       : ${src.enabled}`);
  console.log(`  fromAddress   : ${src.fromAddress}`);
  console.log(`  smtpHost:port : ${src.smtpHost}:${src.smtpPort} secure=${src.smtpSecure}`);
  console.log(`  imapHost:port : ${src.imapHost}:${src.imapPort}`);
  console.log(`  authMode      : ${src.authMode}`);
  console.log(`  username      : ${src.username}`);
  console.log(`  secretSet?    : ${!!src.secretCiphertext} (set ${src.secretSetAt})`);
  console.log(`  signatureHtml?: ${!!src.signatureHtml}`);
  console.log(`  inboundAddress: ${src.inboundAddress}\n`);

  // 3) Hedef setting'i kontrol — varsa update, yoksa create
  const tgtExisting = await prisma.externalMailSetting.findUnique({
    where: { companyId: TARGET },
  });
  if (tgtExisting) {
    console.log(`TARGET'ta ExternalMailSetting MEVCUT (id=${tgtExisting.id}) → ÜZERİNE YAZILACAK\n`);
  } else {
    console.log('TARGET\'ta ExternalMailSetting YOK → YENİ KAYIT OLUŞTURULACAK\n');
  }

  const payload = {
    enabled:          src.enabled,
    fromAddress:      src.fromAddress,
    inboundAddress:   src.inboundAddress,
    smtpHost:         src.smtpHost,
    smtpPort:         src.smtpPort,
    smtpSecure:       src.smtpSecure,
    imapHost:         src.imapHost,
    imapPort:         src.imapPort,
    authMode:         src.authMode,
    secretCiphertext: src.secretCiphertext,
    secretIv:         src.secretIv,
    secretAuthTag:    src.secretAuthTag,
    secretSetAt:      src.secretSetAt,
    username:         src.username,
    signatureHtml:    src.signatureHtml,
    // createdByUserId/updatedByUserId script çalıştırması — null bırak
  };

  // 4) SOURCE FromAlias listesi
  const srcAliases = await prisma.externalMailSettingFromAlias.findMany({
    where: { companyId: SOURCE },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  console.log(`SOURCE FromAlias kayıtları: ${srcAliases.length}`);
  for (const a of srcAliases) {
    console.log(`  · ${a.address} (display="${a.displayName ?? ''}", default=${a.isDefault}, active=${a.isActive})`);
  }
  console.log('');

  if (DRY_RUN) {
    console.log('[DRY-RUN] Yazım atlandı.');
    return;
  }

  // 5) Transaction içinde upsert
  await prisma.$transaction(async (tx) => {
    const targetSetting = await tx.externalMailSetting.upsert({
      where: { companyId: TARGET },
      update: payload,
      create: { companyId: TARGET, ...payload },
    });
    console.log(`✓ ExternalMailSetting upsert → id=${targetSetting.id}`);

    for (const a of srcAliases) {
      await tx.externalMailSettingFromAlias.upsert({
        where: { companyId_address: { companyId: TARGET, address: a.address } },
        update: {
          displayName: a.displayName,
          isDefault:   a.isDefault,
          isActive:    a.isActive,
          sortOrder:   a.sortOrder,
          externalMailSettingId: targetSetting.id,
        },
        create: {
          companyId: TARGET,
          address:   a.address,
          displayName: a.displayName,
          isDefault:   a.isDefault,
          isActive:    a.isActive,
          sortOrder:   a.sortOrder,
          externalMailSettingId: targetSetting.id,
        },
      });
      console.log(`  ✓ FromAlias upsert → ${a.address} (default=${a.isDefault})`);
    }
  });

  // 6) Doğrulama oku
  const verify = await prisma.externalMailSetting.findUnique({
    where: { companyId: TARGET },
  });
  const verifyAliases = await prisma.externalMailSettingFromAlias.count({
    where: { companyId: TARGET, isActive: true },
  });
  console.log('\n═══ DOĞRULAMA ═══');
  console.log(`TARGET setting enabled=${verify?.enabled} fromAddress=${verify?.fromAddress}`);
  console.log(`TARGET FromAlias (active): ${verifyAliases}`);
  console.log('\nTAMAM. İletişim sekmesini yenileyin.');
}

main()
  .catch((err) => {
    console.error('\n[copy-mail-setting] HATA:', err.message);
    console.error(err.stack);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
