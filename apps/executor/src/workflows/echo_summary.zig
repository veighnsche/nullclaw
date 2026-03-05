const std = @import("std");

pub fn execute(prompt: []const u8) []const u8 {
    const trimmed = std.mem.trim(u8, prompt, " \t\r\n");
    if (trimmed.len == 0) return "empty prompt";
    return trimmed;
}

test "execute_returns_trimmed_prompt" {
    try std.testing.expectEqualStrings("hello", execute("  hello  "));
}

test "execute_returns_empty_prompt_marker" {
    try std.testing.expectEqualStrings("empty prompt", execute("   "));
}
