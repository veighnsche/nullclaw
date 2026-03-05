const std = @import("std");
const echo_summary = @import("echo_summary.zig");

pub const TerminalStatus = enum {
    succeeded,
    failed,
};

pub const WorkflowResult = struct {
    terminal_status: TerminalStatus,
    summary: []const u8,
};

pub fn run(workflow: []const u8, prompt: []const u8) !WorkflowResult {
    if (std.mem.eql(u8, workflow, "echo_summary")) {
        return .{
            .terminal_status = .succeeded,
            .summary = echo_summary.execute(prompt),
        };
    }

    return error.UnknownWorkflow;
}

test "run_dispatches_echo_summary" {
    const result = try run("echo_summary", "hello");
    try std.testing.expectEqual(TerminalStatus.succeeded, result.terminal_status);
    try std.testing.expectEqualStrings("hello", result.summary);
}

test "run_rejects_unknown_workflow" {
    try std.testing.expectError(error.UnknownWorkflow, run("not_a_workflow", "hello"));
}
