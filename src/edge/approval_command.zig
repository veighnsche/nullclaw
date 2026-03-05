const std = @import("std");
const contracts = @import("contracts.zig");

pub const ApprovalCommand = union(enum) {
    approve,
    reject,
    revise: []const u8,
};

pub fn parse_approval_command(raw_text: []const u8) ?ApprovalCommand {
    const text = std.mem.trim(u8, raw_text, " \t\r\n");
    if (std.ascii.eqlIgnoreCase(text, "approve")) return .approve;
    if (std.ascii.eqlIgnoreCase(text, "posten maar")) return .approve;
    if (std.ascii.eqlIgnoreCase(text, "reject")) return .reject;
    if (std.ascii.eqlIgnoreCase(text, "afkeuren")) return .reject;

    const revise_prefix = "aanpassen:";
    if (text.len >= revise_prefix.len and std.ascii.eqlIgnoreCase(text[0..revise_prefix.len], revise_prefix)) {
        const patch_text = std.mem.trim(u8, text[revise_prefix.len..], " \t\r\n");
        if (patch_text.len == 0) return null;
        return .{ .revise = patch_text };
    }

    return null;
}

pub fn apply_approval_command(
    current_status: contracts.TaskStatus,
    command: ApprovalCommand,
) !contracts.TaskStatus {
    if (current_status != .waiting_approval) return error.InvalidStateTransition;

    return switch (command) {
        .approve => .queued,
        .reject => .canceled,
        .revise => .queued,
    };
}

test "parse_approval_command_accepts_case_insensitive_tokens" {
    try std.testing.expectEqualDeep(ApprovalCommand{ .approve = {} }, parse_approval_command("APPROVE").?);
    try std.testing.expectEqualDeep(ApprovalCommand{ .approve = {} }, parse_approval_command("posten maar").?);
    try std.testing.expectEqualDeep(ApprovalCommand{ .reject = {} }, parse_approval_command(" reject ").?);
    try std.testing.expectEqualDeep(ApprovalCommand{ .reject = {} }, parse_approval_command("afkeuren").?);
}

test "parse_approval_command_supports_revision_command" {
    const parsed = parse_approval_command("aanpassen: voeg emoji toe").?;
    switch (parsed) {
        .revise => |text| try std.testing.expectEqualStrings("voeg emoji toe", text),
        else => return error.UnexpectedCommand,
    }
}

test "parse_approval_command_returns_null_for_unknown_token" {
    try std.testing.expect(parse_approval_command("hold") == null);
    try std.testing.expect(parse_approval_command("aanpassen:   ") == null);
}

test "apply_approval_command_transitions_from_waiting_approval" {
    try std.testing.expectEqual(
        contracts.TaskStatus.queued,
        try apply_approval_command(.waiting_approval, .approve),
    );
    try std.testing.expectEqual(
        contracts.TaskStatus.canceled,
        try apply_approval_command(.waiting_approval, .reject),
    );
    try std.testing.expectEqual(
        contracts.TaskStatus.queued,
        try apply_approval_command(.waiting_approval, .{ .revise = "shorter copy" }),
    );
}

test "apply_approval_command_rejects_invalid_source_state" {
    try std.testing.expectError(
        error.InvalidStateTransition,
        apply_approval_command(.queued, .approve),
    );
}
