pub const TaskResult = struct {
    terminal_status: enum { succeeded, failed },
    summary: []const u8,
};

pub fn run_task(workflow: []const u8, prompt: []const u8) TaskResult {
    _ = workflow;
    _ = prompt;
    return .{
        .terminal_status = .succeeded,
        .summary = "stub",
    };
}
