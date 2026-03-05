const std = @import("std");

pub const TerminalStatus = enum {
    succeeded,
    failed,
};

pub const TerminalUpdate = struct {
    task_id: []const u8,
    recipient: []const u8,
    terminal_status: TerminalStatus,
    summary: []const u8,
};

pub fn format_whatsapp_message(allocator: std.mem.Allocator, status: TerminalStatus, summary: []const u8) ![]u8 {
    const clean_summary = std.mem.trim(u8, summary, " \t\r\n");
    return switch (status) {
        .succeeded => std.fmt.allocPrint(allocator, "Gelukt: {s}", .{clean_summary}),
        .failed => std.fmt.allocPrint(allocator, "Niet gelukt, dit is geprobeerd: {s}", .{clean_summary}),
    };
}

pub fn build_terminal_update_json(allocator: std.mem.Allocator, update: TerminalUpdate) ![]u8 {
    return std.fmt.allocPrint(
        allocator,
        \\{{"task_id":{f},"recipient":{f},"terminal_status":{f},"summary":{f}}}
    ,
        .{
            std.json.fmt(update.task_id, .{}),
            std.json.fmt(update.recipient, .{}),
            std.json.fmt(@tagName(update.terminal_status), .{}),
            std.json.fmt(update.summary, .{}),
        },
    );
}

test "format_whatsapp_message_for_success" {
    const msg = try format_whatsapp_message(std.testing.allocator, .succeeded, "klaar");
    defer std.testing.allocator.free(msg);
    try std.testing.expectEqualStrings("Gelukt: klaar", msg);
}

test "format_whatsapp_message_for_failure" {
    const msg = try format_whatsapp_message(std.testing.allocator, .failed, "mislukt");
    defer std.testing.allocator.free(msg);
    try std.testing.expectEqualStrings("Niet gelukt, dit is geprobeerd: mislukt", msg);
}

test "build_terminal_update_json_includes_all_fields" {
    const payload = try build_terminal_update_json(
        std.testing.allocator,
        .{
            .task_id = "task-1",
            .recipient = "user_a",
            .terminal_status = .succeeded,
            .summary = "klaar",
        },
    );
    defer std.testing.allocator.free(payload);

    try std.testing.expect(std.mem.containsAtLeast(u8, payload, 1, "\"task_id\":\"task-1\""));
    try std.testing.expect(std.mem.containsAtLeast(u8, payload, 1, "\"terminal_status\":\"succeeded\""));
}
