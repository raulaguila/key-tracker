"""Owned private-bus fixtures. Never installed or imported by the service."""
import os
from pathlib import Path
import sys
from gi.repository import Gio, GLib
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'linux/dobra-input'))
import service
from evdev import KeyState
bus = Gio.DBusConnection.new_for_address_sync(sys.argv[2], Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION, None, None)
loop = GLib.MainLoop()
names = []
registrations = []
def own(name):
    service.call(bus, 'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'RequestName', GLib.Variant('(su)', (name, 0)), '(u)')
    names.append(name)
def register(path, xml, method):
    registrations.append(bus.register_object(path, Gio.DBusNodeInfo.new_for_xml(xml).interfaces[0], method, None, None))
if sys.argv[1] == 'authorities':
    props = {}
    def reset():
        props.clear()
        props.update(Active=True, LockedHint=False, Remote=False, Class='user', Type='wayland', allowed=True, delay=0, uid=os.getuid(), seat='seat0', no_pid=False, pid_path='/org/freedesktop/login1/session/test', display_id='test')
    reset()
    own('org.freedesktop.login1'); own('org.freedesktop.PolicyKit1'); own('io.dobra.TestAuthority')
    def manager(_bus, _owner, _path, _interface, method, _parameters, invocation):
        if method == 'GetSessionByPID' and props['no_pid']:
            invocation.return_dbus_error('org.freedesktop.login1.NoSessionForPID','No session'); return
        path = '/org/freedesktop/login1/user/test' if method == 'GetUser' else props['pid_path'] if method == 'GetSessionByPID' else '/org/freedesktop/login1/session/test'
        invocation.return_value(GLib.Variant('(o)', (path,)))
    register('/org/freedesktop/login1', '<node><interface name="org.freedesktop.login1.Manager"><method name="GetSession"><arg type="s" direction="in"/><arg type="o" direction="out"/></method><method name="GetSessionByPID"><arg type="u" direction="in"/><arg type="o" direction="out"/></method><method name="GetUser"><arg type="u" direction="in"/><arg type="o" direction="out"/></method></interface></node>', manager)
    def user_display(_bus, _owner, _path, _interface, _method, _parameters, invocation):
        invocation.return_value(GLib.Variant('(v)', (GLib.Variant('(so)',(props['display_id'],'/org/freedesktop/login1/session/test')),)))
    register('/org/freedesktop/login1/user/test', '<node><interface name="org.freedesktop.DBus.Properties"><method name="Get"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="v" direction="out"/></method></interface></node>', user_display)
    def properties(_bus, _owner, _path, _interface, _method, _parameters, invocation):
        data = {key: GLib.Variant('b' if type(props[key]) is bool else 's', props[key]) for key in ['Active','LockedHint','Remote','Class','Type']}
        data['User'] = GLib.Variant('(uo)', (props['uid'], '/org/freedesktop/login1/user/test'))
        data['Seat'] = GLib.Variant('(so)', (props['seat'], '/org/freedesktop/login1/seat/test'))
        invocation.return_value(GLib.Variant('(a{sv})', (data,)))
    register('/org/freedesktop/login1/session/test', '<node><interface name="org.freedesktop.DBus.Properties"><method name="GetAll"><arg type="s" direction="in"/><arg type="a{sv}" direction="out"/></method></interface></node>', properties)
    def policy(_bus, _owner, _path, _interface, method, parameters, invocation):
        if method == 'CancelCheckAuthorization':
            invocation.return_value(None); return
        subject, action, _details, flags, _cancel = parameters.unpack()
        assert subject[0] == 'system-bus-name' and subject[1]['name'].startswith(':')
        assert action == 'io.dobra.input.observe' and flags == 1
        def finish():
            invocation.return_value(GLib.Variant('((bba{ss}))', ((props['allowed'], False, {}),)))
            return False
        if props['delay']:
            GLib.timeout_add(props['delay'], finish)
        else:
            finish()
    register('/org/freedesktop/PolicyKit1/Authority', '<node><interface name="org.freedesktop.PolicyKit1.Authority"><method name="CheckAuthorization"><arg type="(sa{sv})" direction="in"/><arg type="s" direction="in"/><arg type="a{ss}" direction="in"/><arg type="u" direction="in"/><arg type="s" direction="in"/><arg type="(bba{ss})" direction="out"/></method><method name="CancelCheckAuthorization"><arg type="s" direction="in"/></method></interface></node>', policy)
    def control(_bus, _owner, _path, _interface, method, parameters, invocation):
        if method == 'Reset': reset()
        elif method == 'Set': props.update(parameters.unpack()[0])
        elif method == 'Lock':
            props['LockedHint'] = True
            bus.emit_signal(None, '/org/freedesktop/login1/session/test', 'org.freedesktop.login1.Session', 'Lock', None)
        elif method == 'Sleep':
            bus.emit_signal(None, '/org/freedesktop/login1', 'org.freedesktop.login1.Manager', 'PrepareForSleep', GLib.Variant('(b)', (True,)))
        invocation.return_value(None)
    register('/test', '<node><interface name="io.dobra.Test"><method name="Reset"/><method name="Set"><arg type="a{sv}" direction="in"/></method><method name="Lock"/><method name="Sleep"/></interface></node>', control)
else:
    class FakeDevices:
        active = None
        def __init__(self, seat, emit, ended):
            assert seat == 'seat0'
            self.emit, self.ended, self.state = emit, ended, KeyState()
            self.state.devices = {'one': set(), 'two': set()}
            self.devices = self.state.devices
            FakeDevices.active = self
        def snapshot(self):
            self.emit({'type':'status', 'mode':'global', 'keyboards': len(self.devices)})
            self.emit({'type':'reset', 'held': sorted(self.state.held())})
        def close(self): FakeDevices.active = None
    broker = service.Service(bus, devices_factory=FakeDevices)
    own(service.NAME); own('io.dobra.TestBroker')
    def control(_bus, _owner, _path, _interface, method, parameters, invocation):
        device = FakeDevices.active
        if method == 'Emit' and device:
            keyboard, code, down = parameters.unpack()
            event = device.state.event(keyboard, code, down)
            if event: device.emit(event)
        elif method == 'ResetInput' and device: device.snapshot()
        if method == 'Stats': invocation.return_value(GLib.Variant('(u)', (int(device is not None),)))
        else: invocation.return_value(None)
    register('/test', '<node><interface name="io.dobra.Test"><method name="Emit"><arg type="s" direction="in"/><arg type="q" direction="in"/><arg type="b" direction="in"/></method><method name="Stats"><arg type="u" direction="out"/></method><method name="ResetInput"/></interface></node>', control)
print('ready', flush=True)
loop.run()
