/**
 * Customer 360 XLSX template generator (client-side).
 *
 * Builds a 6-sheet workbook (README + 5 data sheets) and triggers a browser
 * download. Sheet names match the canonical English aliases the parser
 * recognizes (see parsers.ts SHEET_ALIASES), so the downloaded template can
 * be uploaded back without renaming.
 *
 * Required columns are marked with a trailing "*" in the header label as a
 * lightweight visual cue. The README explains the convention.
 *
 * TODO(schema-driven): regenerate header sets from
 * /api/admin/imports/targets/customer360/schema so the template tracks the
 * Customer 360 schema registry automatically. For now the field list is
 * hard-coded against the Phase 2b shape.
 */

type Row = Record<string, unknown>;

interface SheetSpec {
  sheetName: string;
  columns: { key: string; required?: boolean; width?: number }[];
  rows: Row[];
}

// Asterisks in header cells break autoMap (exact-match on lowercased name),
// so required-field marking lives in the README only.
const headerLabel = (c: SheetSpec['columns'][number]) => c.key;

const README_LINES: string[] = [
  'Müşteri 360 İçe Aktarma Şablonu',
  '',
  'Bu şablon, Varuna Veri Aktarım Stüdyosu → Müşteri 360 akışı için hazırlanmıştır.',
  '',
  'KULLANIM AKIŞI',
  '  1) Varuna’da hedef şirketi seçin.',
  '  2) Bu dosyayı kendi verilerinizle doldurun. Sheet isimlerini değiştirmeyin.',
  '  3) Veri Aktarım Stüdyosu → Müşteri 360 ekranında dosyayı yükleyin.',
  '  4) Dry-run (önizleme) çalıştırın; uyarı ve hataları gözden geçirin.',
  '  5) Sorun yoksa Commit (uygula) ile yazma işlemini başlatın.',
  '',
  'SHEET’LER',
  '  Accounts   → Müşteri ana kartı: kayıt oluşturur veya günceller. Eşleştirme anahtarı VKN.',
  '  Companies  → Müşteri ↔ Varuna şirket ilişkisi (per-tenant kod, paket, durum vb.).',
  '  Contacts   → Müşteriye bağlı iletişim kişileri.',
  '  Addresses  → Müşteriye bağlı adresler (ISO-2 ülke kodu normalize edilir).',
  '  Projects   → AccountCompany altında projeler. Doğrudan müşteriye değil, şirket ilişkisine bağlanır.',
  '',
  'BAĞLANTI ANAHTARLARI',
  '  accountKey         → Çocuk satırların hangi müşteriye ait olduğunu gösterir.',
  '                        Account sayfasındaki VKN veya isim ile EŞLEŞMELİDİR.',
  '                        En güvenli yöntem: çocuk satırlarda VKN değerini kopyalamak.',
  '                        Aksi halde dry-run "yetim satır" hatası verir.',
  '  accountCompanyKey  → Projects sayfasında, projeyi hangi şirket ilişkisine bağlayacağınızı belirtir.',
  '                        Companies sayfasındaki companyCode değeri ile eşleşmelidir.',
  '  companyCode        → Boş bırakırsanız sistem seçili Varuna şirketine otomatik bağlar.',
  '                        Farklı bir kod yazarsanız ve seçili şirketle uyuşmazsa satır reddedilir.',
  '',
  'ZORUNLU ALANLAR (Customer 360 target schema kaynağına göre)',
  '  Aşağıdaki sütunlar boş bırakılamaz:',
  '    Accounts   → name',
  '    Companies  → accountKey',
  '    Contacts   → accountKey, fullName',
  '    Addresses  → accountKey, type, line1, country',
  '    Projects   → accountKey, projectCode, projectName',
  '  Not: Accounts sayfasındaki accountKey kolonu zorunlu DEĞİLDİR, ancak',
  '  çocuk satırların bu müşteriye bağlanabilmesi için Account satırının',
  '  VKN ya da name değerini kullanmanız gerekir.',
  '',
  'GÜVENLİK VE GİZLİLİK',
  '  • TCKN aktarmayın. Sistem TCKN içeren satırları reddeder.',
  '  • Telefonlar E.164 olarak normalize edilir (örn. +905551112233).',
  '  • İsim eşleşmesiyle DB tarafında müşteri birleştirme YAPILMAZ; yalnız VKN eşleşmesi update üretir,',
  '    aksi halde yeni müşteri oluşturulur.',
  '',
  'DRY-RUN ZORUNLU',
  '  Commit öncesi dry-run’ı atlamayın. Önizleme; eksik kolon eşleştirmesi, çapraz-şirket',
  '  uyuşmazlığı, yetim satırlar ve dublike anahtarları raporlar.',
  '',
  'YARDIM',
  '  Ekrandaki "Nasıl çalışır?" panelinde ayrıntılı kılavuz bulunur.',
];

const SHEETS: SheetSpec[] = [
  {
    sheetName: 'Accounts',
    columns: [
      { key: 'accountKey', required: true, width: 22 },
      { key: 'name', required: true, width: 30 },
      { key: 'customerType', width: 14 },
      { key: 'vkn', width: 16 },
      { key: 'phone', width: 18 },
      { key: 'email', width: 28 },
      { key: 'website', width: 24 },
    ],
    rows: [
      {
        accountKey: '1234567890',
        name: 'ACME Holding A.Ş.',
        customerType: 'Corporate',
        vkn: '1234567890',
        phone: '+902125550101',
        email: 'info@acme.com.tr',
        website: 'https://www.acme.com.tr',
      },
      {
        accountKey: '9876543210',
        name: 'Beta Lojistik Ltd. Şti.',
        customerType: 'Corporate',
        vkn: '9876543210',
        phone: '+902325550202',
        email: 'iletisim@betalojistik.com',
        website: '',
      },
    ],
  },
  {
    sheetName: 'Companies',
    columns: [
      { key: 'accountKey', required: true, width: 22 },
      { key: 'companyCode', width: 16 },
      { key: 'externalCustomerCode', width: 22 },
      { key: 'packageName', width: 22 },
      { key: 'status', width: 14 },
    ],
    rows: [
      {
        accountKey: '1234567890',
        companyCode: '',
        externalCustomerCode: 'CUST-0001',
        packageName: 'Premium',
        status: 'Active',
      },
      {
        accountKey: '9876543210',
        companyCode: '',
        externalCustomerCode: 'CUST-0002',
        packageName: 'Standart',
        status: 'Active',
      },
    ],
  },
  {
    sheetName: 'Contacts',
    columns: [
      { key: 'accountKey', required: true, width: 22 },
      { key: 'fullName', required: true, width: 24 },
      { key: 'title', width: 22 },
      { key: 'email', width: 28 },
      { key: 'phone', width: 18 },
      { key: 'isPrimary', width: 10 },
    ],
    rows: [
      {
        accountKey: '1234567890',
        fullName: 'Ayşe Yılmaz',
        title: 'Satın Alma Müdürü',
        email: 'ayse.yilmaz@acme.com.tr',
        phone: '+905321112233',
        isPrimary: true,
      },
      {
        accountKey: '9876543210',
        fullName: 'Mehmet Demir',
        title: 'Operasyon Sorumlusu',
        email: 'mehmet.demir@betalojistik.com',
        phone: '+905329998877',
        isPrimary: true,
      },
    ],
  },
  {
    sheetName: 'Addresses',
    columns: [
      { key: 'accountKey', required: true, width: 22 },
      { key: 'type', width: 12 },
      { key: 'label', width: 18 },
      { key: 'line1', required: true, width: 36 },
      { key: 'district', width: 18 },
      { key: 'city', width: 16 },
      { key: 'country', width: 10 },
      { key: 'isDefault', width: 10 },
    ],
    rows: [
      {
        accountKey: '1234567890',
        type: 'Billing',
        label: 'Genel Merkez',
        line1: 'Levent Mah. Büyükdere Cad. No:120',
        district: 'Beşiktaş',
        city: 'İstanbul',
        country: 'TR',
        isDefault: true,
      },
      {
        accountKey: '9876543210',
        type: 'Shipping',
        label: 'Depo',
        line1: 'Atatürk Org. San. Böl. 4. Sk. No:8',
        district: 'Çiğli',
        city: 'İzmir',
        country: 'TR',
        isDefault: true,
      },
    ],
  },
  {
    sheetName: 'Projects',
    columns: [
      { key: 'accountKey', required: true, width: 22 },
      { key: 'accountCompanyKey', width: 18 },
      { key: 'projectCode', required: true, width: 18 },
      { key: 'projectName', required: true, width: 28 },
      { key: 'status', width: 14 },
      { key: 'startDate', width: 12 },
      { key: 'endDate', width: 12 },
    ],
    rows: [
      {
        accountKey: '1234567890',
        accountCompanyKey: '',
        projectCode: 'WMS-ROLLOUT',
        projectName: 'WMS Rollout 2026',
        status: 'Active',
        startDate: '2026-01-15',
        endDate: '2026-09-30',
      },
    ],
  },
];

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function downloadCustomer360Template(): Promise<void> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  const readmeAoa = README_LINES.map((line) => [line]);
  const readmeWs = XLSX.utils.aoa_to_sheet(readmeAoa);
  readmeWs['!cols'] = [{ wch: 100 }];
  XLSX.utils.book_append_sheet(wb, readmeWs, 'README');

  for (const spec of SHEETS) {
    const header = spec.columns.map(headerLabel);
    const dataRows = spec.rows.map((row) =>
      spec.columns.map((c) => {
        const v = row[c.key];
        return v === undefined ? '' : v;
      }),
    );
    const aoa: unknown[][] = [header, ...dataRows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = spec.columns.map((c) => ({ wch: c.width ?? 16 }));
    XLSX.utils.book_append_sheet(wb, ws, spec.sheetName);
  }

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  triggerDownload(blob, 'customer360-template.xlsx');
}
