const std = @import("std");
const workflows = @import("workflows/root.zig");
const edge = @import("edge");

pub const TaskResult = struct {
    status: edge.contracts.TaskStatus,
    summary: []const u8,
    details: ?[]const u8 = null,
};

pub fn run_task(allocator: std.mem.Allocator, workflow: []const u8, prompt: []const u8) TaskResult {
    const result = workflows.run(allocator, workflow, prompt) catch |err| {
        return switch (err) {
            error.UnknownWorkflow => .{
                .status = .failed,
                .summary = "unknown workflow",
            },
            error.OutOfMemory => .{
                .status = .failed,
                .summary = "workflow execution failed: out of memory",
            },
        };
    };

    return .{
        .status = result.status,
        .summary = result.summary,
        .details = result.details,
    };
}

test "run_task_executes_echo_summary" {
    const result = run_task(std.testing.allocator, "echo_summary", "  hello ");
    try @import("std").testing.expectEqualStrings("hello", result.summary);
    try std.testing.expectEqual(edge.contracts.TaskStatus.succeeded, result.status);
}

test "run_task_fails_on_unknown_workflow" {
    const result = run_task(std.testing.allocator, "missing", "hello");
    try @import("std").testing.expectEqualStrings("unknown workflow", result.summary);
    try std.testing.expectEqual(edge.contracts.TaskStatus.failed, result.status);
}

test "run_task_returns_waiting_approval_for_social_draft" {
    const result = run_task(std.testing.allocator, "social_draft_and_approve", "launch post");
    defer if (result.details) |value| std.testing.allocator.free(value);
    try std.testing.expectEqual(edge.contracts.TaskStatus.waiting_approval, result.status);
    try std.testing.expect(result.details != null);
}
