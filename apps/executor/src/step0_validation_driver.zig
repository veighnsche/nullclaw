const std = @import("std");
const task_runner = @import("task_runner.zig");

const QueueMessage = struct {
    task_id: []const u8,
    workflow: []const u8,
    prompt: []const u8,
    requested_by: []const u8,
    channel: []const u8,
    attempts: u8 = 0,
};

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    const stdin = std.fs.File.stdin();
    var read_buf: [2048]u8 = undefined;
    var input_bytes: std.ArrayListUnmanaged(u8) = .empty;
    defer input_bytes.deinit(allocator);

    while (true) {
        const n = try stdin.read(&read_buf);
        if (n == 0) break;
        try input_bytes.appendSlice(allocator, read_buf[0..n]);
    }

    const trimmed = std.mem.trim(u8, input_bytes.items, " \t\r\n");
    if (trimmed.len == 0) return error.EmptyInput;

    var parsed = try std.json.parseFromSlice(QueueMessage, allocator, trimmed, .{});
    defer parsed.deinit();

    const message = parsed.value;
    const result = task_runner.run_task(message.workflow, message.prompt);
    const terminal_status = switch (result.terminal_status) {
        .succeeded => "succeeded",
        .failed => "failed",
    };

    const payload = try std.fmt.allocPrint(
        allocator,
        \\{{"task_id":{f},"requested_by":{f},"terminal_status":{f},"summary":{f}}}
    ,
        .{
            std.json.fmt(message.task_id, .{}),
            std.json.fmt(message.requested_by, .{}),
            std.json.fmt(terminal_status, .{}),
            std.json.fmt(result.summary, .{}),
        },
    );
    defer allocator.free(payload);

    var out_buf: [1024]u8 = undefined;
    var bw = std.fs.File.stdout().writer(&out_buf);
    const w = &bw.interface;
    try w.print("{s}\n", .{payload});
    try w.flush();
}

test "step0_validation_driver_runner_returns_success_for_echo_summary" {
    const result = task_runner.run_task("echo_summary", "  hello  ");
    try std.testing.expectEqualStrings("hello", result.summary);
    try std.testing.expectEqual(@as(@TypeOf(result.terminal_status), .succeeded), result.terminal_status);
}
