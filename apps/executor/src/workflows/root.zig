const std = @import("std");
const echo_summary = @import("echo_summary.zig");
const social_draft_and_approve = @import("social_draft_and_approve.zig");
const keynote_pdf_pack = @import("keynote_pdf_pack.zig");
const reservation_call_assistant = @import("reservation_call_assistant.zig");
const music_generate_and_release = @import("music_generate_and_release.zig");

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
    if (std.mem.eql(u8, workflow, "social_draft_and_approve")) {
        return .{
            .terminal_status = .succeeded,
            .summary = social_draft_and_approve.execute(prompt),
        };
    }
    if (std.mem.eql(u8, workflow, "keynote_pdf_pack")) {
        return .{
            .terminal_status = .failed,
            .summary = keynote_pdf_pack.execute(prompt),
        };
    }
    if (std.mem.eql(u8, workflow, "reservation_call_assistant")) {
        return .{
            .terminal_status = .failed,
            .summary = reservation_call_assistant.execute(prompt),
        };
    }
    if (std.mem.eql(u8, workflow, "music_generate_and_release")) {
        return .{
            .terminal_status = .failed,
            .summary = music_generate_and_release.execute(prompt),
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

test "run_dispatches_social_draft_and_approve" {
    const result = try run("social_draft_and_approve", "launch post");
    try std.testing.expectEqual(TerminalStatus.succeeded, result.terminal_status);
    try std.testing.expect(std.mem.indexOf(u8, result.summary, "approval required") != null);
}

test "run_dispatches_scaffolded_non_terminal_workflows_as_failed" {
    const keynote = try run("keynote_pdf_pack", "deck");
    try std.testing.expectEqual(TerminalStatus.failed, keynote.terminal_status);

    const reservation = try run("reservation_call_assistant", "book table");
    try std.testing.expectEqual(TerminalStatus.failed, reservation.terminal_status);

    const music = try run("music_generate_and_release", "club track");
    try std.testing.expectEqual(TerminalStatus.failed, music.terminal_status);
}
