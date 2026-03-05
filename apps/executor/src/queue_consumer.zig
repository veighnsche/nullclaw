const std = @import("std");
const edge = @import("edge");
const task_runner = @import("task_runner.zig");

pub const ConsumeOutcome = struct {
    task_id: []u8,
    workflow: []u8,
    terminal_status: edge.contracts.TaskStatus,
    summary: []u8,

    pub fn deinit(self: *ConsumeOutcome, allocator: std.mem.Allocator) void {
        allocator.free(self.task_id);
        allocator.free(self.workflow);
        allocator.free(self.summary);
    }
};

pub fn consume_once(allocator: std.mem.Allocator, raw_message: []const u8) !ConsumeOutcome {
    var parsed = try std.json.parseFromSlice(edge.queue_handoff.QueueMessage, allocator, raw_message, .{});
    defer parsed.deinit();

    const message = parsed.value;

    if (!edge.queue_handoff.can_enqueue_status(.queued)) return error.InvalidQueueState;
    if (!edge.task_ledger.is_valid_status_transition(.queued, .running)) return error.InvalidStateTransition;

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
        .terminal_status = terminal_status,
        .summary = try allocator.dupe(u8, run_result.summary),
    };
}

test "consume_once_runs_echo_summary_from_queue_payload" {
    const payload =
        \\{"task_id":"task-1","workflow":"echo_summary","prompt":"hello","requested_by":"user_a","channel":"whatsapp"}
    ;

    var outcome = try consume_once(std.testing.allocator, payload);
    defer outcome.deinit(std.testing.allocator);

    try std.testing.expectEqualStrings("task-1", outcome.task_id);
    try std.testing.expectEqualStrings("echo_summary", outcome.workflow);
    try std.testing.expectEqual(edge.contracts.TaskStatus.succeeded, outcome.terminal_status);
}
