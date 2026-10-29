"""Explicit, unprivileged Wayland input playback through desktop portals.

Only stream geometry is used: no PipeWire connection or screen frames are read.
The InputCapture portal is intentionally not used as a passive recorder: it
redirects input away from desktop applications instead of observing their use.
"""
import ctypes
import json
import os
import re
import sys
import time
import uuid

PORTAL = "org.freedesktop.portal.Desktop"
PATH = "/org/freedesktop/portal/desktop"
REMOTE = "org.freedesktop.portal.RemoteDesktop"
SCREENCAST = "org.freedesktop.portal.ScreenCast"
REQUEST = "org.freedesktop.portal.Request"
SESSION = "org.freedesktop.portal.Session"
MAX_FRAME = 8192


class PortalError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def emit(event):
    sys.stdout.write(json.dumps(event, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def integer(value, minimum, maximum):
    return type(value) is int and minimum <= value <= maximum


def parse_geometry(streams):
    """Never guess monitor offsets: a wrong guess can click another window."""
    if not isinstance(streams, (list, tuple)) or not 1 <= len(streams) <= 32:
        raise PortalError("geometry-missing")
    monitors = []
    for stream in streams:
        if not isinstance(stream, (list, tuple)) or len(stream) != 2:
            raise PortalError("geometry-missing")
        node, properties = stream
        if not integer(node, 1, 0xFFFFFFFF) or not isinstance(properties, dict):
            raise PortalError("geometry-missing")
        position = properties.get("position")
        size = properties.get("logical_size", properties.get("size"))
        if not isinstance(position, (list, tuple)) or len(position) != 2 or not all(integer(v, -100000, 100000) for v in position):
            raise PortalError("geometry-missing")
        if not isinstance(size, (list, tuple)) or len(size) != 2 or not all(integer(v, 1, 200000) for v in size):
            raise PortalError("geometry-missing")
        # Window sources cannot represent the user's global desktop coordinates.
        if properties.get("source_type", 1) != 1:
            raise PortalError("geometry-missing")
        monitors.append((node, position[0], position[1], size[0], size[1]))
    return monitors


def locate(monitors, x, y):
    if not integer(x, -100000, 100000) or not integer(y, -100000, 100000):
        raise PortalError("protocol")
    for node, left, top, width, height in monitors:
        if left <= x < left + width and top <= y < top + height:
            return node, float(x - left), float(y - top)
    raise PortalError("coordinates")


KEYSYMS = {
    "Space": 0x20, "Tab": 0xFF09, "Enter": 0xFF0D,
    "Escape": 0xFF1B, "Backspace": 0xFF08, "Delete": 0xFFFF,
    "Insert": 0xFF63, "Home": 0xFF50, "End": 0xFF57,
    "PageUp": 0xFF55, "PageDown": 0xFF56,
    "Left": 0xFF51, "Up": 0xFF52, "Right": 0xFF53, "Down": 0xFF54,
    "Plus": 0x2B, "Equal": 0x3D, "Minus": 0x2D, "Comma": 0x2C,
    "Period": 0x2E, "Slash": 0x2F, "Backslash": 0x5C,
    "Semicolon": 0x3B, "Quote": 0x27, "Backquote": 0x60,
    "BracketLeft": 0x5B, "BracketRight": 0x5D,
    "NumpadAdd": 0xFFAB, "NumpadSubtract": 0xFFAD,
    "NumpadMultiply": 0xFFAA, "NumpadDivide": 0xFFAF,
    "NumpadDecimal": 0xFFAE, "NumpadEnter": 0xFF8D,
    "NumpadEqual": 0xFFBD, "NumpadComma": 0xFFAC,
}
KEYSYMS.update({"F" + str(i): 0xFFBD + i for i in range(1, 25)})
KEYSYMS.update({"Numpad" + str(i): 0xFFB0 + i for i in range(10)})
MODIFIERS = {"Control": 0xFFE3, "CommandOrControl": 0xFFE3,
             "Alt": 0xFFE9, "Shift": 0xFFE1, "Super": 0xFFEB, "Command": 0xFFEB}


def parse_key(accelerator):
    if not isinstance(accelerator, str) or not 1 <= len(accelerator) <= 100:
        raise PortalError("protocol")
    parts = accelerator.split("+")
    key = parts.pop()
    if len(parts) > 6 or len(set(parts)) != len(parts) or any(item not in MODIFIERS for item in parts):
        raise PortalError("protocol")
    if key in KEYSYMS:
        keysym = KEYSYMS[key]
    elif re.fullmatch(r"[A-Z0-9]", key):
        keysym = ord(key.lower())
    else:
        raise PortalError("protocol")
    modifiers = list(dict.fromkeys(MODIFIERS[item] for item in parts))
    return modifiers + [keysym]


class DesktopPortal:
    def __init__(self, Gio, GLib):
        self.Gio, self.GLib = Gio, GLib
        self.bus = None
        self.session = None
        self.monitors = []
        self.ready = False
        self.closing = False
        self.active_requests = {}
        self.closed_subscription = None
        self.keys_down = []
        self.buttons_down = []

    def call(self, interface, method, parameters, timeout=2000, object_path=PATH, result_type=None):
        return self.bus.call_sync(PORTAL, object_path, interface, method, parameters,
                                  result_type, self.Gio.DBusCallFlags.NONE, timeout, None)

    def request(self, interface, method, signature, arguments, options):
        token = "dobra_" + uuid.uuid4().hex
        options = dict(options)
        options["handle_token"] = self.GLib.Variant("s", token)
        # Subscribe before the call. A portal may respond before the method reply.
        sender = self.bus.get_unique_name().lstrip(":").replace(".", "_")
        handle = PATH + "/request/" + sender + "/" + token
        result = {}
        loop = self.GLib.MainLoop()

        def response(_bus, _sender, object_path, _interface, _signal, parameters):
            if object_path != result.get("handle", handle):
                return
            status, values = parameters.unpack()
            result["response"] = (status, values)
            loop.quit()

        def timeout():
            result["error"] = "timeout"
            loop.quit()
            return False

        subscription = self.bus.signal_subscribe(PORTAL, REQUEST, "Response", None, None,
                                                  self.Gio.DBusSignalFlags.NONE, response)
        timer = self.GLib.timeout_add_seconds(110, timeout)
        self.active_requests[token] = (loop, handle)
        try:
            reply = self.call(interface, method, self.GLib.Variant(signature, (*arguments, options)))
            actual = reply.unpack()[0]
            if not isinstance(actual, str) or not actual.startswith(PATH + "/request/"):
                raise PortalError("protocol")
            result["handle"] = actual
            self.active_requests[token] = (loop, actual)
            if "response" not in result:
                loop.run()
            if self.closing:
                raise PortalError("cancelled")
            if "response" not in result:
                raise PortalError(result.get("error", "revoked"))
            status, values = result["response"]
            if status != 0:
                raise PortalError("denied" if status == 1 else "unavailable")
            return values
        finally:
            self.active_requests.pop(token, None)
            self.bus.signal_unsubscribe(subscription)
            if "response" not in result:
                # Close pending consent UI on timeout, cancellation or parent EOF.
                try:
                    self.call(REQUEST, "Close", None, 500, result.get("handle", handle))
                except self.GLib.Error:
                    pass  # Session/connection close below is the final revocation.
            if "error" not in result:
                self.GLib.source_remove(timer)

    def session_closed(self, *_args):
        if self.closing:
            return
        self.ready = False
        self.session = None
        self.monitors = []
        for loop, _handle in self.active_requests.values():
            loop.quit()
        emit({"type": "closed"})

    def authorize(self):
        if self.ready:
            return
        self.close_session()
        self.closing = False
        if not self.bus:
            self.bus = self.Gio.bus_get_sync(self.Gio.BusType.SESSION, None)
        device_types = self.call("org.freedesktop.DBus.Properties", "Get",
                                 self.GLib.Variant("(ss)", (REMOTE, "AvailableDeviceTypes"))).unpack()[0]
        if not integer(device_types, 0, 7) or device_types & 3 != 3:
            raise PortalError("unavailable")
        result = self.request(REMOTE, "CreateSession", "(a{sv})", (),
                              {"session_handle_token": self.GLib.Variant("s", "dobra_" + uuid.uuid4().hex)})
        session = result.get("session_handle")
        if not isinstance(session, str) or not re.fullmatch(r"/org/freedesktop/portal/desktop/session/[A-Za-z0-9_]+/[A-Za-z0-9_]+", session):
            raise PortalError("protocol")
        self.session = session
        self.closed_subscription = self.bus.signal_subscribe(PORTAL, SESSION, "Closed", session, None,
                                                              self.Gio.DBusSignalFlags.NONE, self.session_closed)
        self.request(REMOTE, "SelectDevices", "(oa{sv})", (session,), {"types": self.GLib.Variant("u", 3)})
        self.request(SCREENCAST, "SelectSources", "(oa{sv})", (session,),
                     {"types": self.GLib.Variant("u", 1), "multiple": self.GLib.Variant("b", True)})
        result = self.request(REMOTE, "Start", "(osa{sv})", (session, ""), {})
        if not integer(result.get("devices"), 0, 7) or result["devices"] & 3 != 3:
            raise PortalError("denied")
        self.monitors = parse_geometry(result.get("streams"))
        if not self.session:
            raise PortalError("revoked")
        self.ready = True

    def notify(self, method, signature, *arguments):
        if not self.ready or not self.session:
            raise PortalError("permission-required")
        self.call(REMOTE, method, self.GLib.Variant(signature, (self.session, {}, *arguments)))

    def release_inputs(self):
        failed = False
        while self.keys_down:
            key = self.keys_down.pop()
            try:
                self.notify("NotifyKeyboardKeysym", "(oa{sv}iu)", key, 0)
            except (self.GLib.Error, PortalError):
                failed = True
        while self.buttons_down:
            button = self.buttons_down.pop()
            try:
                self.notify("NotifyPointerButton", "(oa{sv}iu)", button, 0)
            except (self.GLib.Error, PortalError):
                failed = True
        return not failed

    def click(self, command):
        if not self.ready:
            raise PortalError("permission-required")
        node, x, y = locate(self.monitors, command.get("x"), command.get("y"))
        button = {"left": 0x110, "right": 0x111, "middle": 0x112}.get(command.get("button"))
        if button is None or not integer(command.get("clicks"), 1, 2):
            raise PortalError("protocol")
        self.notify("NotifyPointerMotionAbsolute", "(oa{sv}udd)", node, x, y)
        try:
            for index in range(command["clicks"]):
                if index:
                    time.sleep(0.075)
                # Remember first: even a timed-out press may have reached the OS.
                self.buttons_down.append(button)
                self.notify("NotifyPointerButton", "(oa{sv}iu)", button, 1)
                self.notify("NotifyPointerButton", "(oa{sv}iu)", button, 0)
                self.buttons_down.pop()
        finally:
            if not self.release_inputs():
                self.close_session()
                raise PortalError("revoked")

    def key(self, command):
        if not self.ready:
            raise PortalError("permission-required")
        keys = parse_key(command.get("key"))
        try:
            for key in keys:
                self.keys_down.append(key)
                self.notify("NotifyKeyboardKeysym", "(oa{sv}iu)", key, 1)
        finally:
            if not self.release_inputs():
                self.close_session()
                raise PortalError("revoked")

    def close_session(self):
        if self.bus and self.closed_subscription is not None:
            self.bus.signal_unsubscribe(self.closed_subscription)
            self.closed_subscription = None
        if self.session:
            self.release_inputs()
            session, self.session = self.session, None
            self.ready = False
            try:
                self.call(SESSION, "Close", None, 500, session)
            except self.GLib.Error:
                pass  # Dropping the private helper's bus connection also revokes it.
        self.ready = False
        self.monitors = []

    def close(self):
        self.closing = True
        for loop, handle in list(self.active_requests.values()):
            try:
                self.call(REQUEST, "Close", None, 500, handle)
            except self.GLib.Error:
                pass
            loop.quit()
        self.close_session()


def error_code(Gio, error):
    remote = Gio.DBusError.get_remote_error(error) or ""
    if remote.endswith(("AccessDenied", "NotAllowed", "Cancelled")):
        return "denied"
    if remote.endswith(("UnknownObject", "NotFound", "InvalidSession")):
        return "revoked"
    if remote.endswith(("NoReply", "Timeout", "TimedOut")):
        return "timeout"
    return "unavailable"


def main():
    try:
        from gi.repository import Gio, GLib
    except ImportError:
        emit({"type": "fatal", "code": "runtime-missing"})
        return
    # A helper must not retain desktop access after Electron exits/crashes.
    parent = os.getppid()
    ctypes.CDLL(None).prctl(1, 15, 0, 0, 0)
    if parent == 1 or os.getppid() != parent:
        return
    portal = DesktopPortal(Gio, GLib)
    loop = GLib.MainLoop()
    buffer = b""
    busy = False

    def stop():
        portal.close()
        loop.quit()
        return False

    def handle(command):
        nonlocal busy
        ident = command.get("id") if isinstance(command, dict) else None
        if not integer(ident, 1, 9007199254740991) or command.get("op") not in ("authorize", "click", "key"):
            raise PortalError("protocol")
        if busy:
            emit({"id": ident, "ok": False, "code": "busy"})
            return
        busy = True
        try:
            if command["op"] == "authorize":
                portal.authorize()
                emit({"id": ident, "ok": True, "playback": True, "recording": False})
            elif command["op"] == "click":
                portal.click(command)
                emit({"id": ident, "ok": True})
            else:
                portal.key(command)
                emit({"id": ident, "ok": True})
        except PortalError as error:
            if error.code != "coordinates":
                portal.close_session()
            emit({"id": ident, "ok": False, "code": error.code})
        except GLib.Error as error:
            portal.close_session()
            emit({"id": ident, "ok": False, "code": error_code(Gio, error)})
        finally:
            busy = False

    def stdin(_fd, condition):
        nonlocal buffer
        if condition & (GLib.IO_ERR | GLib.IO_HUP):
            return stop()
        try:
            chunk = os.read(0, MAX_FRAME)
            if not chunk:
                return stop()
            buffer += chunk
            if len(buffer) > MAX_FRAME:
                raise PortalError("protocol")
            while b"\n" in buffer:
                raw, buffer = buffer.split(b"\n", 1)
                handle(json.loads(raw))
            return True
        except (OSError, ValueError, TypeError, PortalError):
            emit({"type": "fatal", "code": "protocol"})
            return stop()

    GLib.io_add_watch(0, GLib.IO_IN | GLib.IO_HUP | GLib.IO_ERR, stdin)
    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, 15, stop)
    try:
        loop.run()
    finally:
        portal.close()


if __name__ == "__main__":
    main()
