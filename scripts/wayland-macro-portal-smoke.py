"""Isolated D-Bus contract test, not proof of a compositor or native input.

Run: dbus-run-session -- /usr/bin/python3 -I -B scripts/wayland-macro-portal-smoke.py
No real desktop portal is contacted and no OS input is injected.
"""
import json
from pathlib import Path
import subprocess
import sys
from gi.repository import Gio, GLib

ROOT = "/org/freedesktop/portal/desktop"
REMOTE = "org.freedesktop.portal.RemoteDesktop"
SCREEN = "org.freedesktop.portal.ScreenCast"
REQUEST = "org.freedesktop.portal.Request"
SESSION = "org.freedesktop.portal.Session"

XML = """<node>
<interface name="org.freedesktop.portal.RemoteDesktop">
  <property name="AvailableDeviceTypes" type="u" access="read"/>
  <method name="CreateSession"><arg type="a{sv}" direction="in"/><arg type="o" direction="out"/></method>
  <method name="SelectDevices"><arg type="o" direction="in"/><arg type="a{sv}" direction="in"/><arg type="o" direction="out"/></method>
  <method name="Start"><arg type="o" direction="in"/><arg type="s" direction="in"/><arg type="a{sv}" direction="in"/><arg type="o" direction="out"/></method>
  <method name="NotifyPointerMotionAbsolute"><arg type="o" direction="in"/><arg type="a{sv}" direction="in"/><arg type="u" direction="in"/><arg type="d" direction="in"/><arg type="d" direction="in"/></method>
  <method name="NotifyPointerButton"><arg type="o" direction="in"/><arg type="a{sv}" direction="in"/><arg type="i" direction="in"/><arg type="u" direction="in"/></method>
  <method name="NotifyKeyboardKeysym"><arg type="o" direction="in"/><arg type="a{sv}" direction="in"/><arg type="i" direction="in"/><arg type="u" direction="in"/></method>
</interface>
<interface name="org.freedesktop.portal.ScreenCast">
  <method name="SelectSources"><arg type="o" direction="in"/><arg type="a{sv}" direction="in"/><arg type="o" direction="out"/></method>
</interface>
<interface name="org.freedesktop.portal.Request">
  <method name="Close"/>
  <signal name="Response"><arg type="u"/><arg type="a{sv}"/></signal>
</interface>
<interface name="org.freedesktop.portal.Session"><method name="Close"/><signal name="Closed"/></interface>
</node>"""

bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
reply = bus.call_sync("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "RequestName",
                      GLib.Variant("(su)", ("org.freedesktop.portal.Desktop", 4)), None, Gio.DBusCallFlags.NONE, 2000, None)
assert reply.unpack()[0] == 1
interfaces = {item.name: item for item in Gio.DBusNodeInfo.new_for_xml(XML).interfaces}
calls = []
session_closed = False
session_path = None
loop = GLib.MainLoop()
failure = None


def method(_bus, sender, object_path, interface, name, params, invocation):
    global session_path, session_closed
    values = params.unpack() if params else ()
    calls.append((name, values))
    if name == "Close":
        if interface == SESSION:
            session_closed = True
        invocation.return_value(None)
        return
    if name.startswith("Notify"):
        assert values[0] == session_path
        invocation.return_value(None)
        return
    options = values[-1]
    unique = sender.lstrip(":").replace(".", "_")
    request_path = ROOT + "/request/" + unique + "/" + options["handle_token"]
    bus.register_object(request_path, interfaces[REQUEST], method, None, None)
    results = {}
    if name == "CreateSession":
        session_path = ROOT + "/session/" + unique + "/" + options["session_handle_token"]
        bus.register_object(session_path, interfaces[SESSION], method, None, None)
        results["session_handle"] = GLib.Variant("o", session_path)
    elif name == "SelectDevices":
        assert options["types"] == 3
    elif name == "SelectSources":
        assert options["types"] == 1 and options["multiple"] is True
    elif name == "Start":
        results["devices"] = GLib.Variant("u", 3)
        results["streams"] = GLib.Variant("a(ua{sv})", [(91, {"position": GLib.Variant("(ii)", (-100, 0)), "size": GLib.Variant("(ii)", (1920, 1080)), "source_type": GLib.Variant("u", 1)})])
    invocation.return_value(GLib.Variant("(o)", (request_path,)))

    def respond():
        bus.emit_signal(sender, request_path, REQUEST, "Response", GLib.Variant("(ua{sv})", (0, results)))
        return False
    GLib.idle_add(respond)


def property_get(_bus, _sender, _path, _interface, prop):
    assert prop == "AvailableDeviceTypes"
    return GLib.Variant("u", 3)


for interface in (REMOTE, SCREEN):
    bus.register_object(ROOT, interfaces[interface], method, property_get, None)

helper = subprocess.Popen(["/usr/bin/python3", "-I", "-B", str(Path(__file__).resolve().parents[1] / "app/macro-input/wayland.py")],
                          stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)


def send(command):
    helper.stdin.write(json.dumps(command) + "\n")
    helper.stdin.flush()


def stdout(_fd, _condition):
    global failure
    try:
        line = helper.stdout.readline()
        if not line:
            raise AssertionError("Helper exited before completing the portal contract")
        event = json.loads(line)
        assert event.get("ok") is True, event
        if event["id"] == 1:
            assert event["playback"] is True and event["recording"] is False
            send({"id": 2, "op": "click", "x": 200, "y": 300, "button": "left", "clicks": 1})
        elif event["id"] == 2:
            send({"id": 3, "op": "key", "key": "Control+V"})
        elif event["id"] == 3:
            helper.stdin.close()
            return False
        else:
            raise AssertionError(event)
        return True
    except Exception as error:
        failure = error
        loop.quit()
        return False


def exited(_pid, _status):
    loop.quit()


def timeout():
    global failure
    failure = AssertionError("Portal contract did not finish within 10 seconds")
    loop.quit()
    return False


GLib.io_add_watch(helper.stdout.fileno(), GLib.IO_IN | GLib.IO_HUP | GLib.IO_ERR, stdout)
GLib.child_watch_add(helper.pid, exited)
GLib.timeout_add_seconds(10, timeout)
send({"id": 1, "op": "authorize"})
try:
    loop.run()
    if failure:
        raise failure
    assert session_closed, "EOF must close the authorized portal session"
    assert [name for name, _ in calls[:4]] == ["CreateSession", "SelectDevices", "SelectSources", "Start"]
    assert ("NotifyPointerMotionAbsolute", (session_path, {}, 91, 300.0, 300.0)) in calls
    assert [(values[-2], values[-1]) for name, values in calls if name == "NotifyPointerButton"] == [(0x110, 1), (0x110, 0)]
    assert [(values[-2], values[-1]) for name, values in calls if name == "NotifyKeyboardKeysym"] == [(0xFFE3, 1), (ord("v"), 1), (ord("v"), 0), (0xFFE3, 0)]
    print("Portal D-Bus contract passed: consent, monitor geometry, click/key ordering and EOF revocation. No compositor input tested.")
finally:
    if helper.poll() is None:
        helper.terminate()
    helper.wait(timeout=3)
