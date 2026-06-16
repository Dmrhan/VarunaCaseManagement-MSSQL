/*
 * Görünürlük kuralları — bir kullanıcının hangi ticket'ları görebileceği.
 *
 * Kurallar:
 *   - super_admin: HER ŞEY
 *   - L1_agent:
 *       (assigned_to = me)
 *       OR (assigned_to IS NULL AND status = 'open' AND escalated_to_role IS NULL)
 *   - L1_lead:
 *       Tüm L1 havuzu: assigned_to IN (L1 üyeleri) OR atanmamış L1 ticket'lar
 *   - L2_agent:
 *       (assigned_to = me)
 *       OR (assigned_to IS NULL AND escalated_to_role = 'L2')
 *   - L2_lead:
 *       L1 + L2 her şey
 *
 * Output: { whereSql, whereParams } — store.listTickets'a doğrudan geçilir.
 */

import { getCcDb, type CcRole } from "./db";

export type VisibilityWhere = {
  whereSql: string;
  whereParams: Record<string, unknown>;
};

function l1Ids(): number[] {
  const rows = getCcDb()
    .prepare(
      `SELECT id FROM cc_users WHERE role IN ('L1_agent', 'L1_lead') AND active = 1`,
    )
    .all() as Array<{ id: number }>;
  return rows.map((r) => r.id);
}

function l2Ids(): number[] {
  const rows = getCcDb()
    .prepare(
      `SELECT id FROM cc_users WHERE role IN ('L2_agent', 'L2_lead') AND active = 1`,
    )
    .all() as Array<{ id: number }>;
  return rows.map((r) => r.id);
}

function inListClause(
  column: string,
  ids: number[],
  paramPrefix: string,
): { sql: string; params: Record<string, unknown> } {
  if (ids.length === 0) {
    // Boş liste: hiçbir satır eşleşmesin
    return { sql: "0 = 1", params: {} };
  }
  const placeholders = ids.map((_, i) => `@${paramPrefix}_${i}`).join(",");
  const params: Record<string, unknown> = {};
  ids.forEach((id, i) => {
    params[`${paramPrefix}_${i}`] = id;
  });
  return { sql: `${column} IN (${placeholders})`, params };
}

/**
 * Bir kullanıcı için ticket görünürlük WHERE clause'u üretir.
 */
export function visibilityFor(user: {
  id: number;
  role: CcRole;
}): VisibilityWhere {
  if (user.role === "super_admin") {
    return { whereSql: "1 = 1", whereParams: {} };
  }

  if (user.role === "L1_agent") {
    return {
      whereSql: `(assigned_to = @me_l1
                  OR (assigned_to IS NULL
                      AND status = 'open'
                      AND escalated_to_role IS NULL))`,
      whereParams: { me_l1: user.id },
    };
  }

  if (user.role === "L1_lead") {
    const l1 = inListClause("assigned_to", l1Ids(), "l1");
    return {
      whereSql: `(${l1.sql}
                  OR (assigned_to IS NULL AND escalated_to_role IS NULL))`,
      whereParams: { ...l1.params },
    };
  }

  if (user.role === "L2_agent") {
    return {
      whereSql: `(assigned_to = @me_l2
                  OR (assigned_to IS NULL AND escalated_to_role = 'L2'))`,
      whereParams: { me_l2: user.id },
    };
  }

  // L2_lead
  const all = inListClause("assigned_to", [...l1Ids(), ...l2Ids()], "team");
  return {
    whereSql: `(${all.sql} OR assigned_to IS NULL)`,
    whereParams: { ...all.params },
  };
}

/**
 * Bir kullanıcının belirli bir ticket'a erişimi var mı?
 * (Detay sayfası / patch endpoint guard'ı için.)
 */
export function canAccessTicket(
  user: { id: number; role: CcRole },
  ticket: {
    assigned_to: number | null;
    status: string;
    escalated_to_role: string | null;
  },
): boolean {
  if (user.role === "super_admin") return true;

  if (user.role === "L1_agent") {
    if (ticket.assigned_to === user.id) return true;
    if (
      ticket.assigned_to === null &&
      ticket.status === "open" &&
      ticket.escalated_to_role === null
    ) {
      return true;
    }
    return false;
  }

  if (user.role === "L1_lead") {
    if (ticket.assigned_to === null && ticket.escalated_to_role === null) {
      return true;
    }
    if (ticket.assigned_to === null) return false; // L2 havuzu
    return l1Ids().includes(ticket.assigned_to);
  }

  if (user.role === "L2_agent") {
    if (ticket.assigned_to === user.id) return true;
    if (ticket.assigned_to === null && ticket.escalated_to_role === "L2") {
      return true;
    }
    return false;
  }

  // L2_lead — L1 + L2
  if (ticket.assigned_to === null) return true;
  const all = [...l1Ids(), ...l2Ids()];
  return all.includes(ticket.assigned_to);
}
