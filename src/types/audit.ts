/**
 * Audit event types — mirror of the records doover-control writes to the
 * `dv-audit` channel (see ``doover-control/doover_control/events/audit.py``
 * for the source of truth).
 *
 * Each record is read back via the standard channel-messages APIs: it lands
 * inside a ``MessageStructure<AuditEvent>`` envelope (with ``id``, ``timestamp``,
 * ``channel``, etc.), and the record itself is on ``message.data``.
 */

/** Channel name on which audit records live in doover-data. */
export const DV_AUDIT_CHANNEL = "dv-audit";

/** The role this party plays in the record. */
export type AuditEntityType =
  // Subject shapes (the routing key for the dv-audit channel)
  | "device"
  | "user"
  | "organisation"
  // Target shapes — the model class names from doover-control
  | "Tunnel"
  | "ApplicationInstallation"
  | "SolutionInstallation"
  | "ApplicationDeployment"
  | "ObjectGroup"
  | "PendingUser"
  | "User"
  // Non-human actors
  | "fusionauth"
  | "system";

export interface AuditEntity {
  type: AuditEntityType;
  /** Stringified id (User pk, Device pk, FA UUID, etc.). May be absent for `system`. */
  id?: string;
  /** Display name. May be an email for users / pending invites. */
  name?: string;
}

export interface AuditOrganisation {
  id: string;
  name: string;
}

export interface AuditRequestContext {
  ip_address?: string;
  user_agent?: string;
}

/** Origin system for the event. */
export type AuditSource = "control" | "auth" | "data" | "tunnels";

/**
 * String-literal union of every wired audit action — kept in lock-step with
 * ``doover_control/events/types.py``'s ``EventType`` enum. Future event types
 * declared in Python but not yet emitted are intentionally included so the
 * frontend mapping (icons, labels) can be filled in ahead of the wire-up.
 */
export type AuditAction =
  // User
  | "user.logged_in"
  | "user.login.failed"
  | "user.signed_up"
  | "user.created"
  | "user.updated"
  | "user.deleted"
  | "user.deactivated"
  | "user.reactivated"
  | "user.password_changed"
  | "user.password_reset"
  | "user.password_breached"
  | "user.mfa_changed"
  | "user.email_verified"
  | "user.email_changed"
  | "user.idp_linked"
  | "user.idp_unlinked"
  | "user.token_revoked"
  | "user.invited"
  | "user.removed"
  | "user.role_changed"
  // Application / solution
  | "app.installed"
  | "app.deployed"
  | "app.config_changed"
  | "app.uninstalled"
  | "solution.config_changed"
  // Group
  | "group.created"
  | "group.edited"
  | "group.deleted"
  // Device
  | "device.created"
  | "device.updated"
  | "device.config_changed"
  | "device.archived"
  | "device.unarchived"
  | "device.deleted"
  | "device.opened"
  // Tunnel
  | "tunnel.created"
  | "tunnel.deleted"
  | "tunnel.opened"
  | "tunnel.closed"
  | "tunnel.accessed"
  // Other
  | "notification.sent"
  | "report.created"
  | "command.received";

/**
 * The audit record payload as written by ``publish_audit`` — i.e. what you
 * find on ``MessageStructure<AuditEvent>.data`` after reading the channel.
 *
 * The doover-data ``MessageStructure`` envelope provides ``id`` (snowflake)
 * and ``timestamp`` (epoch ms) for ordering; this struct is the body only.
 */
export interface AuditEvent {
  action: AuditAction;
  actor: AuditEntity | null;
  subject: AuditEntity | null;
  organisation: AuditOrganisation | null;
  source: AuditSource;
  metadata: Record<string, unknown>;
  request_context: AuditRequestContext | null;
}
