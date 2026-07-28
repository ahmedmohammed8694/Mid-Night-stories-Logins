// src/permissions.js — RBAC permission engine & audit logger for Midnight Stories worker

/**
 * Calculates effective permissions for an employee.
 *
 * Rule:
 *   effective = (role permissions via employee/team)
 *             + (active ALLOW overrides)
 *             - (active DENY overrides)
 *
 * DENY overrides always win over ALLOW.
 */
export async function getEffectivePermissions(db, employeeId) {
  const now = new Date().toISOString();

  // 1. Role permissions (via employee → role → role_permissions)
  const { results: rolePerms } = await db.prepare(`
    SELECT p.code, rp.effect
    FROM employee_users eu
    JOIN role_permissions rp ON rp.role_id = eu.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE eu.id = ?
  `).bind(employeeId).all().catch(() => ({ results: [] }));

  // 2. Active employee overrides (not expired)
  const { results: overrides } = await db.prepare(`
    SELECT p.code, epo.effect
    FROM employee_permission_overrides epo
    JOIN permissions p ON p.id = epo.permission_id
    WHERE epo.employee_id = ?
      AND (epo.expires_at IS NULL OR epo.expires_at > ?)
  `).bind(employeeId, now).all().catch(() => ({ results: [] }));

  // Build sets
  const allowed = new Set();
  const denied  = new Set();

  for (const { code, effect } of (rolePerms || [])) {
    if (effect === 'allow') allowed.add(code);
    else denied.add(code);
  }

  // Overrides: DENY always wins
  for (const { code, effect } of (overrides || [])) {
    if (effect === 'deny') {
      denied.add(code);
      allowed.delete(code);
    } else {
      if (!denied.has(code)) allowed.add(code);
    }
  }

  return { allowed: [...allowed], denied: [...denied] };
}

/**
 * Returns true if the employee has the given permission code.
 */
export async function hasPermission(db, employeeId, code) {
  const { allowed } = await getEffectivePermissions(db, employeeId);
  return allowed.includes(code);
}

/**
 * Middleware factory: requires a specific permission code.
 * Reads employee from JWT payload stored as c.get('employee').
 */
export function requirePermission(code) {
  return async (c, next) => {
    const employee = c.get('employee');
    if (!employee) return c.json({ error: 'Unauthorized' }, 401);

    if (employee.isSuperAdmin) { await next(); return; }

    const db = c.env.DB;
    const ok = await hasPermission(db, employee.id, code);
    if (!ok) return c.json({ error: `Permission denied: ${code}` }, 403);
    await next();
  };
}

/**
 * Resolves ticket routing for a given account + category + subcategory.
 * Returns { team_id, sla_id, priority }.
 */
export async function resolveTicketRouting(db, accountId, categoryId, subcategoryId) {
  if (subcategoryId) {
    const sub = await db.prepare(`
      SELECT default_team_id, default_sla_id, default_priority
      FROM ticket_subcategories WHERE id = ?
    `).bind(subcategoryId).first().catch(() => null);
    if (sub?.default_team_id) {
      return { team_id: sub.default_team_id, sla_id: sub.default_sla_id, priority: sub.default_priority };
    }
  }

  if (categoryId) {
    const cat = await db.prepare(`
      SELECT default_team_id, default_sla_id, default_priority
      FROM ticket_categories WHERE id = ?
    `).bind(categoryId).first().catch(() => null);
    if (cat?.default_team_id) {
      return { team_id: cat.default_team_id, sla_id: cat.default_sla_id, priority: cat.default_priority };
    }
  }

  const escalation = await db.prepare(
    "SELECT id FROM teams WHERE account_id IS NULL AND status = 'active' LIMIT 1"
  ).first().catch(() => null);
  return { team_id: escalation?.id ?? null, sla_id: null, priority: 'medium' };
}

/**
 * Finds eligible agents in a team who have ticket.view + ticket.reply.
 */
export async function getEligibleAgents(db, teamId) {
  const { results } = await db.prepare(`
    SELECT eu.id, eu.full_name, eu.email
    FROM employee_users eu
    WHERE eu.team_id = ?
      AND eu.employment_status = 'active'
      AND EXISTS (
        SELECT 1 FROM role_permissions rp
        JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = eu.role_id AND p.code = 'ticket.view' AND rp.effect = 'allow'
      )
      AND EXISTS (
        SELECT 1 FROM role_permissions rp
        JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = eu.role_id AND p.code = 'ticket.reply' AND rp.effect = 'allow'
      )
  `).bind(teamId).all().catch(() => ({ results: [] }));
  return results || [];
}

/**
 * Writes an immutable audit log entry.
 */
export async function writeAuditLog(db, { actorId, actorType = 'employee', action, targetType, targetId, oldValue, newValue, ipHash }) {
  await db.prepare(`
    INSERT INTO audit_log (actor_id, actor_type, action, target_type, target_id, old_value, new_value, ip_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    actorId, actorType, action,
    targetType ?? null, targetId ?? null,
    oldValue ? JSON.stringify(oldValue) : null,
    newValue ? JSON.stringify(newValue) : null,
    ipHash ?? null
  ).run().catch((err) => console.error('writeAuditLog error:', err));
}
