const std = @import("std");
const contracts = @import("contracts.zig");

pub const QueueMessage = struct {
    task_id: []const u8,
    workflow: []const u8,
    prompt: []const u8,
    requested_by: []const u8,
    channel: []const u8,
};

pub fn message_from_envelope(task: contracts.TaskEnvelope) !QueueMessage {
    if (task.id.len == 0) return error.InvalidTaskId;
    if (task.workflow.len == 0) return error.InvalidWorkflow;
    if (task.requested_by.len == 0) return error.InvalidRequestedBy;
    if (task.channel.len == 0) return error.InvalidChannel;

    return .{
        .task_id = task.id,
        .workflow = task.workflow,
        .prompt = task.prompt,
        .requested_by = task.requested_by,
        .channel = task.channel,
    };
}

pub fn can_enqueue_status(status: contracts.TaskStatus) bool {
    return status == .queued;
}

pub fn encode_queue_message_json(allocator: std.mem.Allocator, message: QueueMessage) ![]u8 {
    return std.fmt.allocPrint(
        allocator,
        \\{{"task_id":{f},"workflow":{f},"prompt":{f},"requested_by":{f},"channel":{f}}}
    ,
        .{
            std.json.fmt(message.task_id, .{}),
            std.json.fmt(message.workflow, .{}),
            std.json.fmt(message.prompt, .{}),
            std.json.fmt(message.requested_by, .{}),
            std.json.fmt(message.channel, .{}),
        },
    );
}

test "message_from_envelope_requires_task_id" {
    const task = contracts.TaskEnvelope{
        .id = "",
        .workflow = "echo_summary",
        .created_at_unix = 0,
        .requested_by = "user_a",
        .channel = "web",
        .prompt = "hello",
    };

    try std.testing.expectError(error.InvalidTaskId, message_from_envelope(task));
}

test "message_from_envelope_maps_fields" {
    const task = contracts.TaskEnvelope{
        .id = "task-1",
        .workflow = "echo_summary",
        .created_at_unix = 0,
        .requested_by = "user_a",
        .channel = "web",
        .prompt = "hello",
    };

    const msg = try message_from_envelope(task);
    try std.testing.expectEqualStrings("task-1", msg.task_id);
    try std.testing.expectEqualStrings("echo_summary", msg.workflow);
    try std.testing.expectEqualStrings("hello", msg.prompt);
    try std.testing.expectEqualStrings("user_a", msg.requested_by);
    try std.testing.expectEqualStrings("web", msg.channel);
}

test "can_enqueue_status_only_for_queued" {
    try std.testing.expect(can_enqueue_status(.queued));
    try std.testing.expect(!can_enqueue_status(.waiting_approval));
    try std.testing.expect(!can_enqueue_status(.running));
}

test "encode_queue_message_json_emits_fields" {
    const msg = QueueMessage{
        .task_id = "task-42",
        .workflow = "echo_summary",
        .prompt = "hello",
        .requested_by = "user_a",
        .channel = "whatsapp",
    };

    const encoded = try encode_queue_message_json(std.testing.allocator, msg);
    defer std.testing.allocator.free(encoded);

    try std.testing.expectEqualStrings(
        "{\"task_id\":\"task-42\",\"workflow\":\"echo_summary\",\"prompt\":\"hello\",\"requested_by\":\"user_a\",\"channel\":\"whatsapp\"}",
        encoded,
    );
}
