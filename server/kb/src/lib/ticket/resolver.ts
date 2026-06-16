import { runReadOnly } from "../db";
import { getByIdQuery, recentQuery } from "./query-builder";
import { env } from "../env";
import type { TicketRow } from "./types";

/** Tek ticket — yoksa null. */
export async function getById(bildirimNo: number): Promise<TicketRow | null> {
  if (!Number.isInteger(bildirimNo) || bildirimNo <= 0) {
    throw new Error("Bildirim_No pozitif tamsayı olmalı.");
  }
  const q = getByIdQuery(bildirimNo);
  const res = await runReadOnly<TicketRow>(q.text, q.params);
  return res.rows[0] ?? null;
}

/** Son N günde, opsiyonel proje filtresiyle. */
export async function recent(args: {
  project?: string | null;
  lookbackDays?: number;
  limit?: number;
  withDescriptionOnly?: boolean;
}): Promise<TicketRow[]> {
  const e = env();
  const q = recentQuery({
    lookbackDays: args.lookbackDays ?? e.TICKET_ANALYSIS_LOOKBACK_DAYS,
    limit: Math.min(args.limit ?? e.TICKET_QUERY_ROW_LIMIT, e.TICKET_QUERY_ROW_LIMIT),
    project: args.project ?? null,
    withDescriptionOnly: args.withDescriptionOnly ?? false,
  });
  const res = await runReadOnly<TicketRow>(q.text, q.params);
  return res.rows;
}
