import sql, { type ConnectionPool, type IResult } from "mssql";
import { env } from "./env";

/*
 * Read-only guard — yorum strip + forbidden keyword scan.
 *
 * Bu uygulama MSSQL'e KESİNLİKLE INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/
 * TRUNCATE/MERGE/EXEC/GRANT/REVOKE/DENY göndermez. Guard satır içinde "--"
 * ve blok yorumlarını strip ettikten sonra kalan SQL'i yasaklı kelime
 * listesine karşı tarar; eşleşme bulursa hata fırlatır.
 *
 * Bu, ikinci savunma katmanıdır: birinci katman SQL'in `query-builder.ts`
 * içindeki allowlist tabanlı kaynaktan üretilmesidir (kullanıcıdan serbest
 * SQL alınmaz). Guard yine de her sorguya uygulanır.
 */
const FORBIDDEN_PATTERNS: ReadonlyArray<RegExp> = [
  /\binsert\b/i,
  /\bupdate\b/i,
  /\bdelete\b/i,
  /\bdrop\b/i,
  /\balter\b/i,
  /\bcreate\b/i,
  /\btruncate\b/i,
  /\bmerge\b/i,
  /\bexec(ute)?\b/i,
  /\bgrant\b/i,
  /\brevoke\b/i,
  /\bdeny\b/i,
  /\binto\b\s+\w/i, // SELECT ... INTO yeni tablo
  /;\s*\S/, // çoklu ifade
];

export function assertReadOnly(query: string): void {
  const stripped = query
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  for (const pat of FORBIDDEN_PATTERNS) {
    if (pat.test(stripped)) {
      throw new Error(
        `Read-only guard sorguyu reddetti: pattern=${pat.source}`,
      );
    }
  }
}

let poolPromise: Promise<ConnectionPool> | null = null;

function buildConfig(): sql.config {
  const e = env();
  return {
    server: e.TICKET_MSSQL_SERVER,
    port: e.TICKET_MSSQL_PORT,
    database: e.TICKET_MSSQL_DATABASE,
    user: e.TICKET_MSSQL_USER,
    password: e.TICKET_MSSQL_PASSWORD,
    options: {
      ...(e.TICKET_MSSQL_INSTANCE ? { instanceName: e.TICKET_MSSQL_INSTANCE } : {}),
      encrypt: e.TICKET_MSSQL_ENCRYPT,
      trustServerCertificate: e.TICKET_MSSQL_TRUST_SERVER_CERT,
      enableArithAbort: true,
    },
    pool: { max: 4, min: 0, idleTimeoutMillis: 30_000 },
    connectionTimeout: 30_000,
    // Agir view sayfa sorgulari 60s'i asabiliyor; pool timeout'unu yukselttik.
    // Per-query timeout yine runReadOnly icindeki Promise.race ile yonetilir.
    requestTimeout: 300_000,
  };
}

async function getPool(): Promise<ConnectionPool> {
  if (!poolPromise) {
    poolPromise = sql.connect(buildConfig()).catch((err: unknown) => {
      poolPromise = null;
      throw err;
    });
  }
  return poolPromise;
}

export type SqlParam = {
  name: string;
  type: sql.ISqlType | (() => sql.ISqlType);
  value: string | number | boolean | Date | null;
};

export type RunOptions = {
  /** Bu sorguya özel timeout (ms). Default: env.TICKET_QUERY_TIMEOUT_MS. */
  timeoutMs?: number;
};

export type RunResult<T> = {
  rows: T[];
  rowCount: number;
  durationMs: number;
};

/**
 * Tek read-only sorgu çalıştırır. Tüm değerler parametre bind ile geçer;
 * tablo/kolon adları çağıran tarafında allowlist'ten gelmelidir. Guard
 * her sorguya uygulanır.
 */
export async function runReadOnly<T = Record<string, unknown>>(
  query: string,
  params: ReadonlyArray<SqlParam> = [],
  opts: RunOptions = {},
): Promise<RunResult<T>> {
  assertReadOnly(query);

  const pool = await getPool();
  const request = pool.request();
  const timeoutMs = opts.timeoutMs ?? env().TICKET_QUERY_TIMEOUT_MS;

  for (const p of params) {
    request.input(p.name, p.type, p.value);
  }

  // mssql Request tip'inde public `timeout` yok; per-query timeout için
  // Promise.race + request.cancel() ile sürücüye iptal sinyali gönderiyoruz.
  let timer: NodeJS.Timeout | null = null;
  const start = Date.now();
  const result: IResult<T> = await Promise.race<IResult<T>>([
    request.query<T>(query),
    new Promise<IResult<T>>((_resolve, reject) => {
      timer = setTimeout(() => {
        request.cancel();
        reject(new Error(`Sorgu zaman aşımına uğradı (${timeoutMs}ms)`));
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
  const durationMs = Date.now() - start;

  return {
    rows: result.recordset ?? [],
    rowCount: result.recordset?.length ?? 0,
    durationMs,
  };
}

/** Test ve graceful shutdown için. */
export async function closePool(): Promise<void> {
  if (poolPromise) {
    const p = poolPromise;
    poolPromise = null;
    const pool = await p;
    await pool.close();
  }
}

export { sql };
