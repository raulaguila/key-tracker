"""Dobra Input1: privileged device boundary; GUI and actions stay unprivileged."""
import json
import os
from pathlib import Path
import re
import socket
import sys
import time
import uuid

from gi.repository import Gio, GLib
sys.path.insert(0, str(Path(__file__).resolve().parent))
from evdev import Devices, MODIFIERS

MAX_FRAME_BYTES = 65536

NAME, PATH, INTERFACE = "io.dobra.Input1", "/io/dobra/Input1", "io.dobra.Input1"
XML = '''<node><interface name="io.dobra.Input1">
<method name="Version"><arg type="u" direction="out"/></method>
<method name="Start"><arg type="s" direction="in"/><arg type="aq" direction="in"/><arg type="b" direction="in"/><arg type="b" direction="in"/><arg type="s" direction="in"/><arg type="h" direction="out"/></method>
<method name="Configure"><arg type="aq" direction="in"/><arg type="b" direction="in"/><arg type="b" direction="in"/><arg type="s" direction="in"/></method>
<method name="Ping"/><method name="Stop"/>
</interface></node>'''


def call(bus, name, path, interface, method, parameters=None, result=None, timeout=2000):
    return bus.call_sync(name, path, interface, method, parameters,
                         GLib.VariantType.new(result) if result else None,
                         Gio.DBusCallFlags.NONE, timeout, None)


def filter_keys(keys, visual, observe):
    if len(keys) > 256 or any(type(code) is not int or not 0 < code <= 255 for code in keys):
        raise ValueError("Invalid key filter")
    return set(keys), bool(visual), bool(observe)


def filter_device(identifier):
    if not isinstance(identifier, str) or len(identifier) > 160 or re.search(r"[\x00-\x1f\x7f]", identifier):
        raise ValueError("Invalid device selection")
    return identifier


class Authority:
    def __init__(self, bus):
        self.bus = bus

    def session(self, owner, requested):
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", requested):
            raise ValueError("Invalid session")
        uid = call(self.bus, "org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "GetConnectionUnixUser", GLib.Variant("(s)", (owner,)), "(u)").unpack()[0]
        if uid == 0:
            raise ValueError("Root GUI not allowed")
        path = call(self.bus, "org.freedesktop.login1", "/org/freedesktop/login1", "org.freedesktop.login1.Manager", "GetSession", GLib.Variant("(s)", (requested,)), "(o)").unpack()[0]
        pid = call(self.bus, "org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "GetConnectionUnixProcessID", GLib.Variant("(s)", (owner,)), "(u)").unpack()[0]
        try:
            actual = call(self.bus, "org.freedesktop.login1", "/org/freedesktop/login1", "org.freedesktop.login1.Manager", "GetSessionByPID", GLib.Variant("(u)", (pid,)), "(o)").unpack()[0]
        except GLib.Error as error:
            if Gio.DBusError.get_remote_error(error) != "org.freedesktop.login1.NoSessionForPID":
                raise
            # Apps started by systemd --user may have no session cgroup. Bind
            # those to logind's graphical Display, never an arbitrary hint.
            user = call(self.bus, "org.freedesktop.login1", "/org/freedesktop/login1", "org.freedesktop.login1.Manager", "GetUser", GLib.Variant("(u)", (uid,)), "(o)").unpack()[0]
            display = call(self.bus, "org.freedesktop.login1", user, "org.freedesktop.DBus.Properties", "Get", GLib.Variant("(ss)", ("org.freedesktop.login1.User", "Display")), "(v)").unpack()[0]
            if display[0] != requested:
                raise ValueError("Session hint is not the user's graphical display")
            actual = display[1]
        if actual != path:
            raise ValueError("Session does not belong to the requesting process")
        props = call(self.bus, "org.freedesktop.login1", path, "org.freedesktop.DBus.Properties", "GetAll", GLib.Variant("(s)", ("org.freedesktop.login1.Session",)), "(a{sv})").unpack()[0]
        if props.get("User", (None,))[0] != uid or not props.get("Active") or props.get("Remote", True) or props.get("LockedHint", True) or props.get("Class") not in ("user", "user-early") or props.get("Type") not in ("wayland", "x11"):
            raise ValueError("Local unlocked active session required")
        seat = props.get("Seat", ("",))[0]
        if not seat or len(seat) > 128:
            raise ValueError("Session has no seat")
        return {"uid": uid, "path": path, "seat": seat, "id": requested}

    def authorize(self, owner, cancellation_id, callback):
        subject = ("system-bus-name", {"name": GLib.Variant("s", owner)})
        params = GLib.Variant("((sa{sv})sa{ss}us)", (subject, "io.dobra.input.observe", {}, 1, cancellation_id))
        def completed(bus, result):
            try:
                reply = bus.call_finish(result).unpack()[0]
                callback(bool(reply[0]))
            except GLib.Error:
                callback(False)
        self.bus.call("org.freedesktop.PolicyKit1", "/org/freedesktop/PolicyKit1/Authority", "org.freedesktop.PolicyKit1.Authority", "CheckAuthorization", params, GLib.VariantType.new("((bba{ss}))"), Gio.DBusCallFlags.NONE, 90000, None, completed)

    def cancel(self, cancellation_id):
        self.bus.call("org.freedesktop.PolicyKit1", "/org/freedesktop/PolicyKit1/Authority", "org.freedesktop.PolicyKit1.Authority", "CancelCheckAuthorization", GLib.Variant("(s)", (cancellation_id,)), None, Gio.DBusCallFlags.NONE, 2000, None, None)


class Session:
    def __init__(self, service, owner, identity, stream, keys, visual, observe, selected_id=""):
        self.service, self.owner, self.identity, self.stream = service, owner, identity, stream
        self.devices, self.closed = None, False
        self.selected_id = filter_device(selected_id)
        self.last_ping = time.monotonic()
        self.keys, self.visual, self.observe = filter_keys(keys, visual, observe)

    def send(self, event):
        if self.closed:
            return
        if event["type"] == "key" and not (self.visual or event["code"] in self.keys or event["code"] in MODIFIERS):
            return
        if event["type"] == "key":
            event = {**event, "monotonicMs": time.monotonic_ns() / 1000000}
        if event["type"] == "reset":
            event = {**event, "held": [code for code in event["held"] if self.visual or code in self.keys or code in MODIFIERS]}
        try:
            # Bounded kernel queue; a slow/disconnected client loses the session,
            # never a silently dropped keyup or an unbounded event buffer.
            payload = json.dumps(event, separators=(",", ":")).encode("ascii")
            if len(payload) > MAX_FRAME_BYTES:
                raise OSError("Input frame exceeds limit")
            self.stream.send(payload)
        except OSError:
            self.service.end(self.owner, "connection-lost")

    def configure(self, keys, visual, observe, selected_id=""):
        self.selected_id = filter_device(selected_id)
        self.keys, self.visual, self.observe = filter_keys(keys, visual, observe)
        if not observe:
            if self.devices:
                self.devices.close()
                self.devices = None
            self.send({"type": "devices", "devices": [], "selectedId": self.selected_id})
            self.send({"type": "reset", "held": []})
            self.send({"type": "status", "mode": "idle", "keyboards": 0})
            return
        if not self.devices:
            self.devices = self.service.devices_factory(self.identity["seat"], self.send, lambda reason: self.service.end(self.owner, reason))
        if hasattr(self.devices, "select"):
            self.devices.select(self.selected_id)
        self.devices.snapshot()

    def close(self, reason):
        if self.closed:
            return
        self.closed = True
        if self.devices:
            self.devices.close()
            self.devices = None
        try:
            self.stream.send(json.dumps({"type": "ended", "reason": reason}).encode("ascii"))
        except OSError:
            pass
        self.stream.close()


class Service:
    def __init__(self, bus, authority=None, devices_factory=Devices):
        self.bus, self.authority, self.devices_factory = bus, authority or Authority(bus), devices_factory
        self.sessions, self.pending = {}, {}
        self.registration = bus.register_object(PATH, Gio.DBusNodeInfo.new_for_xml(XML).interfaces[0], self.method, None, None)
        self.subscriptions = [
            bus.signal_subscribe("org.freedesktop.DBus", "org.freedesktop.DBus", "NameOwnerChanged", "/org/freedesktop/DBus", None, Gio.DBusSignalFlags.NONE, self.owner_changed),
            bus.signal_subscribe("org.freedesktop.login1", "org.freedesktop.DBus.Properties", "PropertiesChanged", None, "org.freedesktop.login1.Session", Gio.DBusSignalFlags.NONE, self.session_changed),
            bus.signal_subscribe("org.freedesktop.login1", "org.freedesktop.login1.Session", "Lock", None, None, Gio.DBusSignalFlags.NONE, self.locked),
            bus.signal_subscribe("org.freedesktop.login1", "org.freedesktop.login1.Manager", "PrepareForSleep", "/org/freedesktop/login1", None, Gio.DBusSignalFlags.NONE, self.sleep),
        ]
        self.timer = GLib.timeout_add_seconds(1, self.check_sessions)

    @staticmethod
    def error(invocation, reason):
        invocation.return_dbus_error(INTERFACE + "." + reason, reason)

    def method(self, _bus, owner, _path, _interface, method, parameters, invocation):
        # Inspect serialized size before unpacking attacker-controlled variants;
        # the D-Bus transport ceiling is much larger than this protocol needs.
        if parameters.get_size() > 4096:
            self.error(invocation, "InvalidRequest")
            return
        try:
            if method == "Version":
                invocation.return_value(GLib.Variant("(u)", (2,)))
            elif method == "Start":
                self.start(owner, parameters.unpack(), invocation)
            elif method == "Stop":
                self.end(owner, "disabled")
                invocation.return_value(None)
            elif owner not in self.sessions:
                self.error(invocation, "NotAuthorized")
            elif method == "Ping":
                self.sessions[owner].last_ping = time.monotonic()
                invocation.return_value(None)
            elif method == "Configure":
                session = self.sessions[owner]
                # Recheck the authenticated owner's session at each policy change.
                self.authority.session(owner, session.identity["id"])
                session.configure(*parameters.unpack())
                invocation.return_value(None)
            else:
                self.error(invocation, "InvalidRequest")
        except (ValueError, OSError, GLib.Error):
            self.end(owner, "unavailable")
            self.error(invocation, "Unavailable")

    def start(self, owner, parameters, invocation):
        requested, keys, visual, observe, *selection = parameters
        selected_id = filter_device(selection[0] if selection else "")
        filter_keys(keys, visual, observe)
        if owner in self.pending or owner in self.sessions or len(self.pending) + len(self.sessions) >= 16:
            self.error(invocation, "Busy")
            return
        identity = self.authority.session(owner, requested)
        if any(item.identity["uid"] == identity["uid"] for item in self.sessions.values()) or any(item["identity"]["uid"] == identity["uid"] for item in self.pending.values()):
            self.error(invocation, "Busy")
            return
        cancellation = str(uuid.uuid4())
        self.pending[owner] = {"identity": identity, "id": cancellation, "invocation": invocation}
        def authorized(allowed):
            pending = self.pending.pop(owner, None)
            if not pending:
                return
            if not allowed:
                self.error(invocation, "NotAuthorized")
                return
            try:
                current = self.authority.session(owner, requested)
                if current != identity:
                    raise ValueError("Session changed during authorization")
                server, client = socket.socketpair(socket.AF_UNIX, socket.SOCK_SEQPACKET | socket.SOCK_CLOEXEC)
                server.setblocking(False)
                server.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, MAX_FRAME_BYTES)
                session = Session(self, owner, identity, server, keys, visual, observe, selected_id)
                self.sessions[owner] = session
                try:
                    session.configure(keys, visual, observe, selected_id)
                    if session.closed:
                        raise OSError("Input unavailable")
                    descriptors = Gio.UnixFDList.new()
                    index = descriptors.append(client.fileno())
                    invocation.return_value_with_unix_fd_list(GLib.Variant("(h)", (index,)), descriptors)
                finally:
                    client.close()
            except (ValueError, OSError, GLib.Error):
                self.end(owner, "unavailable")
                self.error(invocation, "Unavailable")
        self.authority.authorize(owner, cancellation, authorized)

    def end(self, owner, reason):
        session = self.sessions.pop(owner, None)
        if session:
            session.close(reason)
        pending = self.pending.pop(owner, None)
        if pending:
            try:
                self.authority.cancel(pending["id"])
            except GLib.Error:
                pass  # Closed already; the authority/connection may be gone.
            self.error(pending["invocation"], "Cancelled")

    def owner_changed(self, _bus, _sender, _path, _interface, _signal, parameters):
        name, _old, new = parameters.unpack()
        if name == "org.freedesktop.login1":
            for owner in list(self.sessions) + list(self.pending):
                self.end(owner, "session-unavailable")
        elif not new:
            self.end(name, "connection-lost")

    def session_changed(self, _bus, _sender, path, _interface, _signal, parameters):
        _interface, changed, invalidated = parameters.unpack()
        for owner, session in list(self.sessions.items()):
            if session.identity["path"] == path and (changed.get("Active") is False or changed.get("LockedHint") is True or changed.get("Remote") is True or {"User", "Seat", "Class", "Type"}.intersection(changed) or {"Active", "LockedHint", "Remote", "User", "Seat", "Class", "Type"}.intersection(invalidated)):
                self.end(owner, "session-suspended")

    def locked(self, _bus, _sender, path, *_args):
        for owner, session in list(self.sessions.items()):
            if session.identity["path"] == path:
                self.end(owner, "session-suspended")
        for owner, pending in list(self.pending.items()):
            if pending["identity"]["path"] == path:
                self.end(owner, "session-suspended")

    def sleep(self, _bus, _sender, _path, _interface, _signal, parameters):
        if parameters.unpack()[0]:
            for owner in list(self.sessions) + list(self.pending):
                self.end(owner, "session-suspended")

    def check_sessions(self):
        for owner, session in list(self.sessions.items()):
            try:
                if time.monotonic() - session.last_ping > 6 or self.authority.session(owner, session.identity["id"]) != session.identity:
                    self.end(owner, "session-suspended")
            except ValueError:
                self.end(owner, "session-suspended")
            except GLib.Error:
                self.end(owner, "session-unavailable")
        return True

    def close(self):
        GLib.source_remove(self.timer)
        for owner in list(self.sessions) + list(self.pending):
            self.end(owner, "service-stopped")
        for subscription in self.subscriptions:
            self.bus.signal_unsubscribe(subscription)
        self.bus.unregister_object(self.registration)


def main():
    if os.geteuid() != 0 or len(sys.argv) != 1:
        raise SystemExit("Dobra Input1 must be activated by the system service")
    bus = Gio.bus_get_sync(Gio.BusType.SYSTEM, None)
    loop = GLib.MainLoop()
    service = Service(bus)
    owner = Gio.bus_own_name_on_connection(bus, NAME, Gio.BusNameOwnerFlags.NONE, None, lambda *_: loop.quit())
    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, 15, lambda: (loop.quit(), False)[1])
    GLib.timeout_add_seconds(30, lambda: True if service.sessions or service.pending else (loop.quit(), False)[1])
    try:
        loop.run()
    finally:
        service.close()
        Gio.bus_unown_name(owner)


if __name__ == "__main__":
    main()
