const std = @import("std");
const edge = @import("edge");
const task_runner = @import("task_runner.zig");
const notifier = @import("notify/whatsapp_terminal_notifier.zig");

const MAX_WORKFLOW_ATTEMPTS: u8 = 3;

pub const ConsumeOutcome = struct {
    task_id: []u8,
    workflow: []u8,
    requested_by: []u8,
    channel: []u8,
    terminal_status: edge.contracts.TaskStatus,
    summary: []u8,

    pub fn deinit(self: *ConsumeOutcome, allocator: std.mem.Allocator) void {
        allocator.free(self.task_id);
        allocator.free(self.workflow);
        allocator.free(self.requested_by);
        allocator.free(self.channel);
        allocator.free(self.summary);
    }

    pub fn notifier_status(self: ConsumeOutcome) notifier.TerminalStatus {
        return switch (self.terminal_status) {
            .succeeded => .succeeded,
            else => .failed,
        };
    }
};

pub fn consume_once(allocator: std.mem.Allocator, raw_message: []const u8) !ConsumeOutcome {
    var parsed = try edge.queue_handoff.parse_queue_message_json(allocator, raw_message);
    defer parsed.deinit();

    const message = parsed.value;

    if (!edge.queue_handoff.can_enqueue_status(.queued)) return error.InvalidQueueState;
    if (!edge.task_ledger.is_valid_status_transition(.queued, .running)) return error.InvalidStateTransition;
    if (message.attempts >= MAX_WORKFLOW_ATTEMPTS) return error.MaxAttemptsExceeded;

    const run_result = task_runner.run_task(message.workflow, message.prompt);
    const terminal_status: edge.contracts.TaskStatus = switch (run_result.terminal_status) {
        .succeeded => .succeeded,
        .failed => .failed,
    };

    if (!edge.task_ledger.is_valid_status_transition(.running, terminal_status)) {
        return error.InvalidStateTransition;
    }

    return .{
        .task_id = try allocator.dupe(u8, message.task_id),
        .workflow = try allocator.dupe(u8, message.workflow),
        .requested_by = try allocator.dupe(u8, message.requested_by),
        .channel = try allocator.dupe(u8, message.channel),
        .terminal_status = terminal_status,
        .summary = try allocator.dupe(u8, run_result.summary),
    };
}

test "consume_once_runs_echo_summary_from_queue_payload" {
    const payload =
        \\{"task_id":"task-1","workflow":"echo_summary","prompt":"hello","requested_by":"user_a","channel":"whatsapp","attempts":0}
    ;

    var outcome = try consume_once(std.testing.allocator, payload);
    defer outcome.deinit(std.testing.allocator);

    try std.testing.expectEqualStrings("task-1", outcome.task_id);
    try std.testing.expectEqualStrings("echo_summary", outcome.workflow);
    try std.testing.expectEqualStrings("user_a", outcome.requested_by);
    try std.testing.expectEqualStrings("whatsapp", outcome.channel);
    try std.testing.expectEqual(edge.contracts.TaskStatus.succeeded, outcome.terminal_status);
    try std.testing.expectEqual(notifier.TerminalStatus.succeeded, outcome.notifier_status());
}

test "consume_once_rejects_when_attempts_exhausted" {
    const payload =
        \\{"task_id":"task-1","workflow":"echo_summary","prompt":"hello","requested_by":"user_a","channel":"whatsapp","attempts":3}
    ;
    try std.testing.expectError(error.MaxAttemptsExceeded, consume_once(std.testing.allocator, payload));
}
