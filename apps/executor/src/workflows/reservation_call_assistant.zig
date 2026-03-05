const std = @import("std");

pub fn execute(_: []const u8) []const u8 {
    return "reservation_call_assistant scaffold: call execution disabled";
}

test "reservation_call_assistant_scaffold_response" {
    try std.testing.expect(std.mem.indexOf(u8, execute("x"), "disabled") != null);
}
