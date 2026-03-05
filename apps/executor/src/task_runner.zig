const workflows = @import("workflows/root.zig");

pub const TaskResult = struct {
    terminal_status: enum { succeeded, failed },
    summary: []const u8,
};

pub fn run_task(workflow: []const u8, prompt: []const u8) TaskResult {
    const result = workflows.run(workflow, prompt) catch |err| {
        return switch (err) {
            error.UnknownWorkflow => .{
                .terminal_status = .failed,
                .summary = "unknown workflow",
            },
        };
    };

    return .{
        .terminal_status = switch (result.terminal_status) {
            .succeeded => .succeeded,
            .failed => .failed,
        },
        .summary = result.summary,
    };
}

test "run_task_executes_echo_summary" {
    const result = run_task("echo_summary", "  hello ");
    try @import("std").testing.expectEqualStrings("hello", result.summary);
    try @import("std").testing.expectEqual(@as(@TypeOf(result.terminal_status), .succeeded), result.terminal_status);
}

test "run_task_fails_on_unknown_workflow" {
    const result = run_task("missing", "hello");
    try @import("std").testing.expectEqualStrings("unknown workflow", result.summary);
    try @import("std").testing.expectEqual(@as(@TypeOf(result.terminal_status), .failed), result.terminal_status);
}
