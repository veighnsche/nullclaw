const std = @import("std");
const echo_summary = @import("echo_summary.zig");
const social_draft_and_approve = @import("social_draft_and_approve.zig");
const keynote_pdf_pack = @import("keynote_pdf_pack.zig");
const reservation_call_assistant = @import("reservation_call_assistant.zig");
const music_generate_and_release = @import("music_generate_and_release.zig");
const edge = @import("edge");

pub const WorkflowResult = struct {
    status: edge.contracts.TaskStatus,
    summary: []const u8,
    details: ?[]const u8 = null,
};

pub fn run(allocator: std.mem.Allocator, workflow: []const u8, prompt: []const u8) !WorkflowResult {
    if (std.mem.eql(u8, workflow, "echo_summary")) {
        return .{
            .status = .succeeded,
            .summary = echo_summary.execute(prompt),
        };
    }
    if (std.mem.eql(u8, workflow, "social_draft_and_approve")) {
        const social_result = try social_draft_and_approve.execute(allocator, prompt);
        return .{
            .status = social_result.status,
            .summary = social_result.summary,
            .details = social_result.details,
        };
    }
    if (std.mem.eql(u8, workflow, "keynote_pdf_pack")) {
        return .{
            .status = .failed,
            .summary = keynote_pdf_pack.execute(prompt),
        };
    }
    if (std.mem.eql(u8, workflow, "reservation_call_assistant")) {
        return .{
            .status = .failed,
            .summary = reservation_call_assistant.execute(prompt),
        };
    }
    if (std.mem.eql(u8, workflow, "music_generate_and_release")) {
        return .{
            .status = .failed,
            .summary = music_generate_and_release.execute(prompt),
        };
    }

    return error.UnknownWorkflow;
}

test "run_dispatches_echo_summary" {
    const result = try run(std.testing.allocator, "echo_summary", "hello");
    try std.testing.expectEqual(edge.contracts.TaskStatus.succeeded, result.status);
    try std.testing.expectEqualStrings("hello", result.summary);
}

test "run_rejects_unknown_workflow" {
    try std.testing.expectError(error.UnknownWorkflow, run(std.testing.allocator, "not_a_workflow", "hello"));
}

test "run_dispatches_social_draft_and_approve" {
    const result = try run(std.testing.allocator, "social_draft_and_approve", "launch post");
    defer if (result.details) |value| std.testing.allocator.free(value);
    try std.testing.expectEqual(edge.contracts.TaskStatus.waiting_approval, result.status);
    try std.testing.expect(std.mem.indexOf(u8, result.summary, "approval required") != null);
}

test "run_dispatches_scaffolded_non_terminal_workflows_as_failed" {
    const keynote = try run(std.testing.allocator, "keynote_pdf_pack", "deck");
    try std.testing.expectEqual(edge.contracts.TaskStatus.failed, keynote.status);

    const reservation = try run(std.testing.allocator, "reservation_call_assistant", "book table");
    try std.testing.expectEqual(edge.contracts.TaskStatus.failed, reservation.status);

    const music = try run(std.testing.allocator, "music_generate_and_release", "club track");
    try std.testing.expectEqual(edge.contracts.TaskStatus.failed, music.status);
}
