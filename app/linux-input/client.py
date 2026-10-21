"""Unprivileged bridge: private D-Bus session stream -> bounded JSON pipe."""
import ctypes
import json
import os
import re
import socket
import sys


def emit(event):
    sys.stdout.write(json.dumps(event, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def main():
    try:
        from gi.repository import Gio, GLib
    except ImportError:
        emit({"type": "error", "reason": "runtime-missing"})
        return
    # Do not survive an Electron crash, including while authentication is open.
    parent = os.getppid()
    ctypes.CDLL(None).prctl(1, 15, 0, 0, 0)
    if parent == 1 or os.getppid() != parent:
        return
    name, path, interface = "io.dobra.Input1", "/io/dobra/Input1", "io.dobra.Input1"
    bus = None
    stream = None
    loop = GLib.MainLoop()
    buffer = b""
    def fail(reason):
        emit({"type": "error", "reason": reason})
        loop.quit()
        return False
    def error_reason(error):
        remote = Gio.DBusError.get_remote_error(error) or ""
        if remote.endswith(("ServiceUnknown", "NameHasNoOwner")):
            return "not-installed"
        if remote.endswith(("NotAuthorized", "AccessDenied", "Cancelled")):
            return "denied"
        if remote.endswith("Busy"):
            return "busy"
        return "unavailable"
    def config(raw):
        value = json.loads(raw)
        keys = value.get("keys")
        if value.get("type") != "configure" or not isinstance(keys, list) or len(keys) > 256 or any(type(code) is not int or not 0 < code <= 255 for code in keys) or type(value.get("visual")) is not bool or type(value.get("observe")) is not bool:
            raise ValueError("Invalid configuration")
        selected_id = value.get("selectedId", "")
        if not isinstance(selected_id, str) or len(selected_id) > 160 or re.search(r"[\x00-\x1f\x7f]", selected_id):
            raise ValueError("Invalid device selection")
        return keys, value["visual"], value["observe"], selected_id
    def done(connection, result):
        try:
            connection.call_finish(result)
        except GLib.Error as error:
            fail(error_reason(error))
    def request(method, parameters=None):
        bus.call(name, path, interface, method, parameters, None, Gio.DBusCallFlags.NONE, 2000, None, done)
    def stdin(_fd, condition):
        nonlocal buffer
        if condition & (GLib.IO_ERR | GLib.IO_HUP):
            loop.quit()
            return False
        try:
            chunk = os.read(0, 8192)
            if not chunk:
                loop.quit()
                return False
            buffer += chunk
            if len(buffer) > 8192:
                raise ValueError("Configuration limit")
            while b"\n" in buffer:
                raw, buffer = buffer.split(b"\n", 1)
                keys, visual, observe, selected_id = config(raw)
                request("Configure", GLib.Variant("(aqbbs)", (keys, visual, observe, selected_id)))
            return True
        except (OSError, ValueError, TypeError):
            return fail("protocol-error")
    def events(_fd, condition):
        if condition & (GLib.IO_ERR | GLib.IO_HUP):
            return fail("connection-lost")
        try:
            for _ in range(128):
                try:
                    raw = stream.recv(4096)
                except BlockingIOError:
                    break
                if not raw:
                    return fail("connection-lost")
                event = json.loads(raw)
                if event.get("type") not in ("key", "reset", "status", "devices", "ended"):
                    raise ValueError("Invalid event")
                emit(event)
                if event["type"] == "ended":
                    loop.quit()
                    return False
            return True
        except (OSError, ValueError, TypeError):
            return fail("protocol-error")
    try:
        while b"\n" not in buffer:
            chunk = os.read(0, 8192)
            if not chunk:
                return
            buffer += chunk
            if len(buffer) > 8192:
                raise ValueError("Configuration limit")
        initial, buffer = buffer.split(b"\n", 1)
        keys, visual, observe, selected_id = config(initial)
        bus = Gio.bus_get_sync(Gio.BusType.SYSTEM, None)
        version = bus.call_sync(name, path, interface, "Version", None, GLib.VariantType.new("(u)"), Gio.DBusCallFlags.NONE, 5000, None).unpack()[0]
        if version != 2:
            emit({"type": "error", "reason": "version-mismatch"})
            return
        session = os.environ.get("XDG_SESSION_ID", "")
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", session):
            user = bus.call_sync("org.freedesktop.login1", "/org/freedesktop/login1", "org.freedesktop.login1.Manager", "GetUser", GLib.Variant("(u)", (os.getuid(),)), GLib.VariantType.new("(o)"), Gio.DBusCallFlags.NONE, 2000, None).unpack()[0]
            session = bus.call_sync("org.freedesktop.login1", user, "org.freedesktop.DBus.Properties", "Get", GLib.Variant("(ss)", ("org.freedesktop.login1.User", "Display")), GLib.VariantType.new("(v)"), Gio.DBusCallFlags.NONE, 2000, None).unpack()[0][0]
        emit({"type": "authorizing"})
        reply, descriptors = bus.call_with_unix_fd_list_sync(name, path, interface, "Start", GLib.Variant("(saqbbs)", (session, keys, visual, observe, selected_id)), GLib.VariantType.new("(h)"), Gio.DBusCallFlags.NONE, 95000, None, None)
        stream = socket.socket(fileno=descriptors.get(reply.unpack()[0]))
        stream.setblocking(False)
        emit({"type": "connected"})
        GLib.io_add_watch(stream.fileno(), GLib.IO_IN | GLib.IO_HUP | GLib.IO_ERR, events)
        GLib.io_add_watch(0, GLib.IO_IN | GLib.IO_HUP | GLib.IO_ERR, stdin)
        GLib.timeout_add_seconds(2, lambda: (request("Ping"), True)[1])
        GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, 15, lambda: (loop.quit(), False)[1])
        loop.run()
    except GLib.Error as error:
        emit({"type": "error", "reason": error_reason(error)})
    except (OSError, ValueError, TypeError):
        emit({"type": "error", "reason": "unavailable"})
    finally:
        if stream:
            stream.close()
        if bus:
            try:
                bus.call_sync(name, path, interface, "Stop", None, None, Gio.DBusCallFlags.NONE, 1000, None)
            except GLib.Error:
                pass
            bus.close_sync(None)


if __name__ == "__main__":
    main()
