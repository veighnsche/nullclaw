const std = @import("std");
const edge = @import("edge");
const approval_command = edge.approval_command;

pub const WorkflowResult = struct {
    status: edge.contracts.TaskStatus,
    summary: []const u8,
    details: ?[]const u8 = null,
};

pub const ApprovalResolution = struct {
    next_status: edge.contracts.TaskStatus,
    next_prompt: ?[]u8 = null,
    summary: []const u8,
    details: ?[]u8 = null,

    pub fn deinit(self: *ApprovalResolution, allocator: std.mem.Allocator) void {
        if (self.next_prompt) |value| allocator.free(value);
        if (self.details) |value| allocator.free(value);
    }
};

fn build_draft_details(allocator: std.mem.Allocator, draft_text: []const u8, revision_request: ?[]const u8) ![]u8 {
    if (revision_request) |revision| {
        return std.fmt.allocPrint(
            allocator,
            \\{{"draft_text":{f},"revision_request":{f}}}
        ,
            .{
                std.json.fmt(draft_text, .{}),
                std.json.fmt(revision, .{}),
            },
        );
    }

    return std.fmt.allocPrint(
        allocator,
        \\{{"draft_text":{f}}}
    ,
        .{std.json.fmt(draft_text, .{})},
    );
}

fn append_revision_request(allocator: std.mem.Allocator, prompt: []const u8, revision_request: []const u8) ![]u8 {
    return std.fmt.allocPrint(
        allocator,
        "{s}\n\nRevision request: {s}",
        .{ std.mem.trim(u8, prompt, " \t\r\n"), revision_request },
    );
}

pub fn execute(allocator: std.mem.Allocator, prompt: []const u8) !WorkflowResult {
    const trimmed = std.mem.trim(u8, prompt, " \t\r\n");
    if (trimmed.len == 0) {
        return .{
            .status = .failed,
            .summary = "social_draft_and_approve scaffold: empty prompt",
        };
    }

    const details = try build_draft_details(allocator, trimmed, null);
    return .{
        .status = .waiting_approval,
        .summary = "social_draft_and_approve scaffold: draft generated, approval required",
        .details = details,
    };
}

pub fn apply_approval(
    allocator: std.mem.Allocator,
    current_status: edge.contracts.TaskStatus,
    original_prompt: []const u8,
    draft_text: []const u8,
    raw_command: []const u8,
) !ApprovalResolution {
    const command = approval_command.parse_approval_command(raw_command) orelse return error.InvalidApprovalCommand;
    const next_status = try approval_command.apply_approval_command(current_status, command);

    return switch (command) {
        .approve => .{
            .next_status = next_status,
            .summary = "social_draft_and_approve scaffold: approval received, re-queued for publish step",
            .details = try build_draft_details(allocator, draft_text, null),
            .next_prompt = try allocator.dupe(u8, std.mem.trim(u8, original_prompt, " \t\r\n")),
        },
        .reject => .{
            .next_status = next_status,
            .summary = "social_draft_and_approve scaffold: draft rejected",
            .details = try build_draft_details(allocator, draft_text, null),
        },
        .revise => |revision_request| .{
            .next_status = next_status,
            .summary = "social_draft_and_approve scaffold: revision requested, re-queued for another draft",
            .details = try build_draft_details(allocator, draft_text, revision_request),
            .next_prompt = try append_revision_request(allocator, original_prompt, revision_request),
        },
    };
}

test "social_draft_and_approve_waits_for_approval" {
    const result = try execute(std.testing.allocator, "launch post");
    defer if (result.details) |value| std.testing.allocator.free(value);

    try std.testing.expectEqual(edge.contracts.TaskStatus.waiting_approval, result.status);
    try std.testing.expect(std.mem.indexOf(u8, result.summary, "approval required") != null);
    try std.testing.expect(result.details != null);
    try std.testing.expect(std.mem.indexOf(u8, result.details.?, "\"draft_text\":\"launch post\"") != null);
}

test "social_draft_and_approve_rejects_empty_prompt" {
    const result = try execute(std.testing.allocator, "   ");
    try std.testing.expectEqual(edge.contracts.TaskStatus.failed, result.status);
}

test "social_draft_and_approve_apply_approval_transitions" {
    var approved = try apply_approval(
        std.testing.allocator,
        .waiting_approval,
        "launch post",
        "launch post",
        "approve",
    );
    defer approved.deinit(std.testing.allocator);
    try std.testing.expectEqual(edge.contracts.TaskStatus.queued, approved.next_status);
    try std.testing.expectEqualStrings("launch post", approved.next_prompt.?);

    var rejected = try apply_approval(
        std.testing.allocator,
        .waiting_approval,
        "launch post",
        "launch post",
        "reject",
    );
    defer rejected.deinit(std.testing.allocator);
    try std.testing.expectEqual(edge.contracts.TaskStatus.canceled, rejected.next_status);
    try std.testing.expect(rejected.next_prompt == null);
}

test "social_draft_and_approve_apply_approval_revise_flow" {
    var revised = try apply_approval(
        std.testing.allocator,
        .waiting_approval,
        "launch post",
        "launch post",
        "aanpassen: add a stronger hook",
    );
    defer revised.deinit(std.testing.allocator);

    try std.testing.expectEqual(edge.contracts.TaskStatus.queued, revised.next_status);
    try std.testing.expect(std.mem.indexOf(u8, revised.next_prompt.?, "Revision request: add a stronger hook") != null);
    try std.testing.expect(std.mem.indexOf(u8, revised.details.?, "\"revision_request\":\"add a stronger hook\"") != null);
}
