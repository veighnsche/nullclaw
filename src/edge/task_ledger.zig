const std = @import("std");
const contracts = @import("contracts.zig");

pub const QUEUED_INSERT_SQL =
    \\INSERT INTO tasks (
    \\  id,
    \\  status,
    \\  workflow,
    \\  risk_level,
    \\  action_target,
    \\  requested_by,
    \\  channel,
    \\  prompt,
    \\  attempts,
    \\  created_at,
    \\  updated_at,
    \\  version
    \\) VALUES (?, 'queued', ?, ?, ?, ?, ?, ?, 0, ?, ?, 0)
;

pub const QueuedInsert = struct {
    task_id: []const u8,
    workflow: []const u8,
    risk_level: contracts.RiskLevel,
    action_target: contracts.ActionTarget,
    requested_by: []const u8,
    channel: []const u8,
    prompt: []const u8,
    created_at_iso8601: []const u8,
    updated_at_iso8601: []const u8,
};

pub fn validate_task_for_queued_insert(task: contracts.TaskEnvelope) !void {
    if (task.id.len == 0) return error.InvalidTaskId;
    if (task.workflow.len == 0) return error.InvalidWorkflow;
    if (task.prompt.len == 0) return error.InvalidPrompt;
    if (task.requested_by.len == 0) return error.InvalidRequestedBy;
    if (task.channel.len == 0) return error.InvalidChannel;
}

pub fn build_queued_insert(task: contracts.TaskEnvelope, now_iso8601: []const u8) !QueuedInsert {
    try validate_task_for_queued_insert(task);
    if (now_iso8601.len == 0) return error.InvalidTimestamp;

    return .{
        .task_id = task.id,
        .workflow = task.workflow,
        .risk_level = task.risk_level,
        .action_target = task.action_target,
        .requested_by = task.requested_by,
        .channel = task.channel,
        .prompt = task.prompt,
        .created_at_iso8601 = now_iso8601,
        .updated_at_iso8601 = now_iso8601,
    };
}

pub fn is_valid_status_transition(from: contracts.TaskStatus, to: contracts.TaskStatus) bool {
    return switch (from) {
        .queued => switch (to) {
            .running, .waiting_approval, .canceled, .failed => true,
            else => false,
        },
        .waiting_approval => switch (to) {
            .queued, .canceled => true,
            else => false,
        },
        .running => switch (to) {
            .succeeded, .failed, .canceled => true,
            else => false,
        },
        .succeeded, .failed, .canceled => false,
    };
}

test "validate_task_for_queued_insert_rejects_empty_fields" {
    const task_missing_id = contracts.TaskEnvelope{
        .id = "",
        .workflow = "echo_summary",
        .created_at_unix = 0,
        .requested_by = "user_a",
        .channel = "web",
        .prompt = "hello",
    };
    try std.testing.expectError(error.InvalidTaskId, validate_task_for_queued_insert(task_missing_id));

    const task_missing_prompt = contracts.TaskEnvelope{
        .id = "task-1",
        .workflow = "echo_summary",
        .created_at_unix = 0,
        .requested_by = "user_a",
        .channel = "web",
        .prompt = "",
    };
    try std.testing.expectError(error.InvalidPrompt, validate_task_for_queued_insert(task_missing_prompt));

    const task_missing_channel = contracts.TaskEnvelope{
        .id = "task-1",
        .workflow = "echo_summary",
        .created_at_unix = 0,
        .requested_by = "user_a",
        .channel = "",
        .prompt = "hello",
    };
    try std.testing.expectError(error.InvalidChannel, validate_task_for_queued_insert(task_missing_channel));
}

test "build_queued_insert_maps_task_to_queued_row" {
    const task = contracts.TaskEnvelope{
        .id = "task-1",
        .workflow = "echo_summary",
        .created_at_unix = 0,
        .requested_by = "user_a",
        .channel = "whatsapp",
        .prompt = "hello",
        .risk_level = .low,
        .action_target = .local,
    };

    const row = try build_queued_insert(task, "2026-03-05T10:00:00Z");
    try std.testing.expectEqualStrings("task-1", row.task_id);
    try std.testing.expectEqualStrings("echo_summary", row.workflow);
    try std.testing.expectEqual(contracts.RiskLevel.low, row.risk_level);
    try std.testing.expectEqual(contracts.ActionTarget.local, row.action_target);
}

test "is_valid_status_transition_allows_expected_paths" {
    try std.testing.expect(is_valid_status_transition(.queued, .running));
    try std.testing.expect(is_valid_status_transition(.waiting_approval, .queued));
    try std.testing.expect(is_valid_status_transition(.running, .succeeded));
}

test "is_valid_status_transition_rejects_invalid_paths" {
    try std.testing.expect(!is_valid_status_transition(.queued, .succeeded));
    try std.testing.expect(!is_valid_status_transition(.succeeded, .running));
    try std.testing.expect(!is_valid_status_transition(.canceled, .queued));
}
