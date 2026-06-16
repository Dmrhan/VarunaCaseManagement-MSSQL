import { sql } from "../db";
import type { SqlParam } from "../db";
import { COL, DEFAULT_SELECT, TICKET_VIEW, type ColumnKey } from "./source";
import { qualifyTable, quoteIdent } from "./identifiers";

/*
 * Önceden derlenmiş sorgu üreticileri. Hiçbiri kullanıcıdan SQL almaz;
 * sadece allowlist içindeki tablo/kolonları kullanır ve tüm değer'leri
 * parametre bind eder.
 */

function selectList(cols: ReadonlyArray<ColumnKey>): string {
  return cols
    .map((key) => {
      const raw = COL[key];
      // "Univera.BugGroup" nokta içerdiği için alias veriyoruz, böylece
      // recordset'te düz `BugGroup` olarak gelir.
      if (raw.includes(".")) {
        return `${quoteIdent(raw)} AS ${quoteIdent("BugGroup")}`;
      }
      return quoteIdent(raw);
    })
    .join(", ");
}

const TABLE = qualifyTable(TICKET_VIEW.schema, TICKET_VIEW.name);

export type BuiltQuery = {
  text: string;
  params: SqlParam[];
};

/** Tek kayıt — `WHERE Bildirim_No = @id`. */
export function getByIdQuery(bildirimNo: number, cols = DEFAULT_SELECT): BuiltQuery {
  const text = `
    SELECT TOP 1 ${selectList(cols)}
    FROM ${TABLE}
    WHERE ${quoteIdent(COL.id)} = @id
  `;
  return {
    text,
    params: [{ name: "id", type: sql.Int, value: bildirimNo }],
  };
}

/** Tarih aralığı + opsiyonel proje + opsiyonel kategori prefix. */
export function recentQuery(args: {
  lookbackDays: number;
  limit: number;
  project?: string | null;
  categoryPrefix?: string | null;
  withDescriptionOnly?: boolean;
  cols?: ReadonlyArray<ColumnKey>;
}): BuiltQuery {
  const cols = args.cols ?? DEFAULT_SELECT;
  const where: string[] = [
    `${quoteIdent(COL.date)} >= DATEADD(day, -@days, CAST(GETDATE() AS date))`,
  ];
  const params: SqlParam[] = [
    { name: "days", type: sql.Int, value: args.lookbackDays },
    { name: "lim", type: sql.Int, value: args.limit },
  ];
  if (args.project) {
    where.push(`${quoteIdent(COL.project)} = @proje`);
    params.push({ name: "proje", type: sql.NVarChar(350), value: args.project });
  }
  if (args.categoryPrefix) {
    where.push(`${quoteIdent(COL.categoryLong)} LIKE @catPrefix`);
    params.push({
      name: "catPrefix",
      type: sql.NVarChar(986),
      value: `${args.categoryPrefix}%`,
    });
  }
  if (args.withDescriptionOnly) {
    where.push(`${quoteIdent(COL.description)} IS NOT NULL`);
    where.push(`LEN(${quoteIdent(COL.description)}) > 0`);
  }
  const text = `
    SELECT TOP (@lim) ${selectList(cols)}
    FROM ${TABLE}
    WHERE ${where.join("\n      AND ")}
    ORDER BY ${quoteIdent(COL.date)} DESC, ${quoteIdent(COL.id)} DESC
  `;
  return { text, params };
}

/**
 * Distinct etiket kümeleri (kategori, kök neden, vb.).
 * Faz 2'de taxonomy.ts bunu kullanacak.
 */
export function distinctValuesQuery(args: {
  column: ColumnKey;
  lookbackDays: number;
  limit: number;
}): BuiltQuery {
  const col = COL[args.column];
  const colExpr = quoteIdent(col);
  const text = `
    SELECT TOP (@lim) ${colExpr} AS value, COUNT_BIG(*) AS n
    FROM ${TABLE}
    WHERE ${quoteIdent(COL.date)} >= DATEADD(day, -@days, CAST(GETDATE() AS date))
      AND ${colExpr} IS NOT NULL
      AND LEN(CAST(${colExpr} AS NVARCHAR(MAX))) > 0
    GROUP BY ${colExpr}
    ORDER BY n DESC
  `;
  return {
    text,
    params: [
      { name: "days", type: sql.Int, value: args.lookbackDays },
      { name: "lim", type: sql.Int, value: args.limit },
    ],
  };
}
