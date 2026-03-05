const std = @import("std");
const queue_consumer = @import("queue_consumer.zig");

const CallbackConfig = struct {
    url: []const u8,
    secret: []const u8,
};

fn getEnvVarOwnedOrNull(allocator: std.mem.Allocator, name: []const u8) !?[]u8 {
    return std.process.getEnvVarOwned(allocator, name) catch |err| switch (err) {
        error.EnvironmentVariableNotFound => null,
        else => return err,
    };
}

fn parseCallbackConfig(callback_url: ?[]const u8, callback_secret: ?[]const u8) !?CallbackConfig {
    if (callback_url == null and callback_secret == null) return null;
    if (callback_url == null) return error.CallbackUrlRequired;
    if (callback_secret == null) return error.CallbackSecretRequired;

    const uri = std.Uri.parse(callback_url.?) catch return error.InvalidCallbackUrl;
    if (!std.ascii.eqlIgnoreCase(uri.scheme, "https")) return error.CallbackUrlMustUseHttps;
    if (uri.host == null) return error.InvalidCallbackUrl;

    return .{
        .url = callback_url.?,
        .secret = callback_secret.?,
    };
}

fn buildSignatureHeader(secret: []const u8, payload: []const u8, buf: *[80]u8) ![]const u8 {
    const HmacSha256 = std.crypto.auth.hmac.sha2.HmacSha256;
    var mac: [HmacSha256.mac_length]u8 = undefined;
    HmacSha256.create(&mac, payload, secret);
    const mac_hex = std.fmt.bytesToHex(mac, .lower);
    return std.fmt.bufPrint(buf, "sha256={s}", .{mac_hex[0..]});
}

fn buildTerminalPayload(allocator: std.mem.Allocator, outcome: queue_consumer.ConsumeOutcome) ![]u8 {
    const terminal_status = switch (outcome.terminal_status) {
        .succeeded => "succeeded",
        .failed, .canceled => "failed",
        else => return error.InvalidTerminalStatus,
    };

    return std.fmt.allocPrint(
        allocator,
        \\{{"task_id":{f},"requested_by":{f},"terminal_status":{f},"summary":{f}}}
    ,
        .{
            std.json.fmt(outcome.task_id, .{}),
            std.json.fmt(outcome.requested_by, .{}),
            std.json.fmt(terminal_status, .{}),
            std.json.fmt(outcome.summary, .{}),
        },
    );
}

fn postTerminalCallback(allocator: std.mem.Allocator, callback: CallbackConfig, payload: []const u8) !void {
    var signature_buf: [80]u8 = undefined;
    const signature = try buildSignatureHeader(callback.secret, payload, &signature_buf);

    var client: std.http.Client = .{ .allocator = allocator };
    defer client.deinit();

    var aw: std.Io.Writer.Allocating = .init(allocator);
    defer aw.deinit();

    const result = try client.fetch(.{
        .location = .{ .url = callback.url },
        .method = .POST,
        .payload = payload,
        .extra_headers = &.{
            .{ .name = "Content-Type", .value = "application/json" },
            .{ .name = "x-nullclaw-signature", .value = signature },
        },
        .response_writer = &aw.writer,
    });

    if (result.status != .ok) return error.TerminalCallbackFailed;
}

pub fn runOnce(allocator: std.mem.Allocator, raw_message: []const u8, callback: ?CallbackConfig) ![]u8 {
    const trimmed = std.mem.trim(u8, raw_message, " \t\r\n");
    if (trimmed.len == 0) return error.EmptyInput;

    var outcome = try queue_consumer.consume_once(allocator, trimmed);
    defer outcome.deinit(allocator);

    const payload = try buildTerminalPayload(allocator, outcome);
    errdefer allocator.free(payload);

    if (callback) |cfg| {
        try postTerminalCallback(allocator, cfg, payload);
    }

    return payload;
}

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    const callback_url = try getEnvVarOwnedOrNull(allocator, "NULLCLAW_EXECUTOR_CALLBACK_URL");
    defer if (callback_url) |value| allocator.free(value);

    const callback_secret = try getEnvVarOwnedOrNull(allocator, "NULLCLAW_EXECUTOR_CALLBACK_SECRET");
    defer if (callback_secret) |value| allocator.free(value);

    const callback = try parseCallbackConfig(callback_url, callback_secret);

    const stdin = std.fs.File.stdin();
    var read_buf: [2048]u8 = undefined;
    var input_bytes: std.ArrayListUnmanaged(u8) = .empty;
    defer input_bytes.deinit(allocator);

    while (true) {
        const n = try stdin.read(&read_buf);
        if (n == 0) break;
        try input_bytes.appendSlice(allocator, read_buf[0..n]);
    }

    const payload = try runOnce(allocator, input_bytes.items, callback);
    defer allocator.free(payload);

    var out_buf: [1024]u8 = undefined;
    var bw = std.fs.File.stdout().writer(&out_buf);
    const w = &bw.interface;
    try w.print("{s}\n", .{payload});
    try w.flush();
}

test "runOnce_builds_terminal_payload_for_echo_summary" {
    const payload =
        \\{"task_id":"task-1","workflow":"echo_summary","prompt":"hello","requested_by":"user_a","channel":"whatsapp","attempts":0}
    ;

    const terminal = try runOnce(std.testing.allocator, payload, null);
    defer std.testing.allocator.free(terminal);

    try std.testing.expect(std.mem.containsAtLeast(u8, terminal, 1, "\"task_id\":\"task-1\""));
    try std.testing.expect(std.mem.containsAtLeast(u8, terminal, 1, "\"requested_by\":\"user_a\""));
    try std.testing.expect(std.mem.containsAtLeast(u8, terminal, 1, "\"terminal_status\":\"succeeded\""));
}

test "runOnce_rejects_empty_input" {
    try std.testing.expectError(error.EmptyInput, runOnce(std.testing.allocator, "   ", null));
}

test "parseCallbackConfig_requires_secret_when_url_is_set" {
    try std.testing.expectError(
        error.CallbackSecretRequired,
        parseCallbackConfig("https://example.test/terminal", null),
    );
}

test "parseCallbackConfig_requires_url_when_secret_is_set" {
    try std.testing.expectError(
        error.CallbackUrlRequired,
        parseCallbackConfig(null, "test-secret"),
    );
}

test "parseCallbackConfig_rejects_non_https_url" {
    try std.testing.expectError(
        error.CallbackUrlMustUseHttps,
        parseCallbackConfig("http://example.test/terminal", "test-secret"),
    );
}
