const std = @import("std");

/// Risk level assigned to a task before execution.
pub const RiskLevel = enum {
    low,
    medium,
    high,
};

/// Side-effect class targeted by a task.
pub const ActionTarget = enum {
    /// Read-only, internal, or local transformations.
    local,
    /// Writes to a user account in an external platform.
    external_account,
    /// Public content release (for example social publishing).
    public_publish,
    /// Any operation that commits money or purchases.
    money,
};

/// Approval mode derived from policy and task intent.
pub const ApprovalMode = enum {
    auto,
    require_confirmation,
};

/// Lifecycle states for async edge task processing.
pub const TaskStatus = enum {
    queued,
    running,
    waiting_approval,
    succeeded,
    failed,
    canceled,
};

/// Normalized async task contract between ingress and executor.
pub const TaskEnvelope = struct {
    id: []const u8,
    workflow: []const u8,
    created_at_unix: i64,
    requested_by: []const u8,
    channel: []const u8,
    prompt: []const u8,
    risk_level: RiskLevel = .low,
    action_target: ActionTarget = .local,
    metadata_json: ?[]const u8 = null,
};

/// Standard terminal or intermediate result payload.
pub const TaskResult = struct {
    task_id: []const u8,
    status: TaskStatus,
    summary: []const u8,
    details: ?[]const u8 = null,
    attempts: u8 = 0,
};

/// Policy helper:
/// - high risk always requires confirmation
/// - money/public/external-account targets require confirmation
/// - medium risk local actions require confirmation
pub fn approval_mode_for(risk_level: RiskLevel, action_target: ActionTarget) ApprovalMode {
    if (risk_level == .high) return .require_confirmation;
    return switch (action_target) {
        .money, .public_publish, .external_account => .require_confirmation,
        .local => if (risk_level == .medium) .require_confirmation else .auto,
    };
}

/// True when no further transitions should occur.
pub fn is_terminal_status(status: TaskStatus) bool {
    return switch (status) {
        .succeeded, .failed, .canceled => true,
        else => false,
    };
}

test "approval_mode_for_low_local_is_auto" {
    try std.testing.expectEqual(
        ApprovalMode.auto,
        approval_mode_for(.low, .local),
    );
}

test "approval_mode_for_medium_local_requires_confirmation" {
    try std.testing.expectEqual(
        ApprovalMode.require_confirmation,
        approval_mode_for(.medium, .local),
    );
}

test "approval_mode_for_money_requires_confirmation" {
    try std.testing.expectEqual(
        ApprovalMode.require_confirmation,
        approval_mode_for(.low, .money),
    );
}

test "is_terminal_status_only_for_final_states" {
    try std.testing.expect(!is_terminal_status(.queued));
    try std.testing.expect(!is_terminal_status(.running));
    try std.testing.expect(!is_terminal_status(.waiting_approval));
    try std.testing.expect(is_terminal_status(.succeeded));
    try std.testing.expect(is_terminal_status(.failed));
    try std.testing.expect(is_terminal_status(.canceled));
}
