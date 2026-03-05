const std = @import("std");
const contracts = @import("contracts.zig");

pub const MAX_TASK_ID_LEN: usize = 128;
pub const MAX_WORKFLOW_LEN: usize = 96;
pub const MAX_REQUESTED_BY_LEN: usize = 128;
pub const MAX_CHANNEL_LEN: usize = 64;
pub const MAX_PROMPT_LEN: usize = 8192;
pub const MAX_ATTEMPTS: u8 = 8;

pub const QueueMessage = struct {
    task_id: []const u8,
    workflow: []const u8,
    prompt: []const u8,
    requested_by: []const u8,
    channel: []const u8,
    attempts: u8 = 0,
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

pub fn parse_queue_message_json(allocator: std.mem.Allocator, raw_json: []const u8) !std.json.Parsed(QueueMessage) {
    var parsed = std.json.parseFromSlice(QueueMessage, allocator, raw_json, .{
        .ignore_unknown_fields = false,
    }) catch return error.InvalidQueuePayload;
    errdefer parsed.deinit();

    validate_queue_message(parsed.value) catch return error.InvalidQueuePayload;
    return parsed;
}

pub fn encode_queue_message_json(allocator: std.mem.Allocator, message: QueueMessage) ![]u8 {
    return std.fmt.allocPrint(
        allocator,
        \\{{"task_id":{f},"workflow":{f},"prompt":{f},"requested_by":{f},"channel":{f},"attempts":{d}}}
    ,
        .{
            std.json.fmt(message.task_id, .{}),
            std.json.fmt(message.workflow, .{}),
            std.json.fmt(message.prompt, .{}),
            std.json.fmt(message.requested_by, .{}),
            std.json.fmt(message.channel, .{}),
            message.attempts,
        },
    );
}

pub fn validate_queue_message(message: QueueMessage) !void {
    if (message.task_id.len == 0 or message.task_id.len > MAX_TASK_ID_LEN) return error.InvalidQueuePayload;
    if (message.workflow.len == 0 or message.workflow.len > MAX_WORKFLOW_LEN) return error.InvalidQueuePayload;
    if (message.requested_by.len == 0 or message.requested_by.len > MAX_REQUESTED_BY_LEN) return error.InvalidQueuePayload;
    if (message.channel.len == 0 or message.channel.len > MAX_CHANNEL_LEN) return error.InvalidQueuePayload;
    if (message.prompt.len == 0 or message.prompt.len > MAX_PROMPT_LEN) return error.InvalidQueuePayload;
    if (message.attempts > MAX_ATTEMPTS) return error.InvalidQueuePayload;

    if (has_nul_byte(message.task_id)) return error.InvalidQueuePayload;
    if (has_nul_byte(message.workflow)) return error.InvalidQueuePayload;
    if (has_nul_byte(message.requested_by)) return error.InvalidQueuePayload;
    if (has_nul_byte(message.channel)) return error.InvalidQueuePayload;
    if (has_nul_byte(message.prompt)) return error.InvalidQueuePayload;
}

fn has_nul_byte(value: []const u8) bool {
    return std.mem.indexOfScalar(u8, value, 0) != null;
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
        .attempts = 1,
    };

    const encoded = try encode_queue_message_json(std.testing.allocator, msg);
    defer std.testing.allocator.free(encoded);

    try std.testing.expectEqualStrings(
        "{\"task_id\":\"task-42\",\"workflow\":\"echo_summary\",\"prompt\":\"hello\",\"requested_by\":\"user_a\",\"channel\":\"whatsapp\",\"attempts\":1}",
        encoded,
    );
}

test "parse_queue_message_json_rejects_unknown_fields" {
    const raw =
        \\{"task_id":"task-1","workflow":"echo_summary","prompt":"hello","requested_by":"user_a","channel":"whatsapp","extra":"nope"}
    ;
    try std.testing.expectError(error.InvalidQueuePayload, parse_queue_message_json(std.testing.allocator, raw));
}

test "parse_queue_message_json_rejects_missing_required_field" {
    const raw =
        \\{"task_id":"task-1","prompt":"hello","requested_by":"user_a","channel":"whatsapp"}
    ;
    try std.testing.expectError(error.InvalidQueuePayload, parse_queue_message_json(std.testing.allocator, raw));
}

test "validate_queue_message_rejects_oversized_prompt" {
    const long_prompt = try std.testing.allocator.alloc(u8, MAX_PROMPT_LEN + 1);
    defer std.testing.allocator.free(long_prompt);
    @memset(long_prompt, 'x');

    const message = QueueMessage{
        .task_id = "task-1",
        .workflow = "echo_summary",
        .prompt = long_prompt,
        .requested_by = "user_a",
        .channel = "whatsapp",
    };
    try std.testing.expectError(error.InvalidQueuePayload, validate_queue_message(message));
}

test "parse_queue_message_json_defaults_attempts_to_zero" {
    const raw =
        \\{"task_id":"task-1","workflow":"echo_summary","prompt":"hello","requested_by":"user_a","channel":"whatsapp"}
    ;

    var parsed = try parse_queue_message_json(std.testing.allocator, raw);
    defer parsed.deinit();
    try std.testing.expectEqual(@as(u8, 0), parsed.value.attempts);
}
