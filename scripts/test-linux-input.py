"""No host keyboard access: actual GIO, D-Bus authorization and private FD IPC."""
import ctypes
import json
import os
from pathlib import Path
import selectors
import socket
import subprocess
import sys
import tempfile
import time
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from gi.repository import Gio, GLib
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'linux/dobra-input'))
from evdev import KeyState, Keyboard, InputEvent, Devices
import service


class NativeStateTests(unittest.TestCase):
    def test_multi_keyboard_modifiers_and_repeats(self):
        state = KeyState(); state.devices = {'a': set(), 'b': set()}
        self.assertEqual(state.event('a', 29, True)['modifiers'], 1)
        self.assertEqual(state.event('b', 29, True), None)
        self.assertEqual(state.event('a', 29, False), None)
        self.assertEqual(state.event('b', 30, True)['modifiers'], 1)
        self.assertEqual(state.event('b', 30, True), None)
        self.assertEqual(state.event('b', 29, False)['modifiers'], 0)
        self.assertEqual(state.event('b', 30, False)['down'], False)

    def test_keyboard_opens_read_only_without_following_links(self):
        class Lib:
            def libevdev_new_from_fd(self, _fd, _dev): return -1
        with patch('evdev.library', return_value=Lib()), patch('evdev.os.open', return_value=42) as opened, patch('evdev.os.close') as closed:
            with self.assertRaises(OSError): Keyboard('/dev/input/event42')
            flags = opened.call_args[0][1]
            self.assertEqual(flags & os.O_ACCMODE, os.O_RDONLY)
            self.assertTrue(flags & os.O_NOFOLLOW)
            self.assertTrue(flags & os.O_NONBLOCK)
            closed.assert_called_once_with(42)

    def test_sync_dropped_discards_partial_gesture(self):
        class Lib:
            def __init__(self): self.results = iter([0, 1, 1, -11])
            def libevdev_next_event(self, _dev, flags, ptr):
                result = next(self.results)
                event = ctypes.cast(ptr, ctypes.POINTER(InputEvent)).contents
                event.type, event.code, event.value = 1, 30, 1
                return result
        keyboard = Keyboard.__new__(Keyboard); keyboard.lib = Lib(); keyboard.device = ctypes.c_void_p(1)
        self.assertEqual(keyboard.events(), ([], True))

    def test_filter_bounds_and_invalid_session(self):
        for keys in [[0], [256], [True], list(range(1, 258))]:
            with self.assertRaises(ValueError): service.filter_keys(keys, False, True)
        authority = service.Authority(None)
        for value in ['', '../session', 'x'*129]:
            with self.assertRaises(ValueError): authority.session(':1.1', value)

    def test_oversized_dbus_payload_is_rejected_before_unpack(self):
        errors = []
        parameters = SimpleNamespace(get_size=lambda: 4097, unpack=lambda: self.fail('Oversized request must not be materialized'))
        invocation = SimpleNamespace(return_dbus_error=lambda name, message: errors.append(name))
        broker = service.Service.__new__(service.Service)
        broker.method(None, ':1.2', None, service.INTERFACE, 'Start', parameters, invocation)
        self.assertEqual(errors, [service.INTERFACE+'.InvalidRequest'])

    def test_native_buffer_drains_without_another_fd_notification(self):
        class Lib:
            def __init__(self): self.index = 0
            def libevdev_next_event(self, _dev, _flags, ptr):
                self.index += 1
                if self.index > 257: return -11
                event = ctypes.cast(ptr, ctypes.POINTER(InputEvent)).contents
                event.type, event.code, event.value = (1,30,1) if self.index == 1 else (1,30,0) if self.index == 257 else (0,0,0)
                return 0
        keyboard = Keyboard.__new__(Keyboard); keyboard.lib = Lib(); keyboard.device = ctypes.c_void_p(1)
        devices = Devices.__new__(Devices); devices.devices = {'one':keyboard}; devices.drains = {}
        devices.state = KeyState(); devices.state.devices = {'one':set()}
        events = []; devices.emit = events.append; devices.ended = lambda reason: self.fail(reason)
        self.assertTrue(devices.read(None, GLib.IO_IN, 'one'))
        self.assertEqual([event['down'] for event in events], [True])
        self.assertEqual(len(devices.drains), 1)
        context = GLib.MainContext.default()
        while devices.drains: context.iteration(False)
        self.assertEqual([event['down'] for event in events], [True,False])
        self.assertEqual(devices.state.held(), set())

    def test_hotplug_seat_change_closes_previously_owned_keyboard(self):
        path = b'/dev/input/event7'; closed = []; events = []
        devices = Devices.__new__(Devices); devices.seat = 'seat0'; devices.monitor = object()
        devices.devices = {path:SimpleNamespace(close=lambda: closed.append(True))}
        devices.identities = {path:{'id':'linux:'+'a'*40,'name':'Fixture'}}; devices.selected_id = ''
        devices.sources = {}; devices.drains = {}; devices.state = KeyState(); devices.state.devices = {path:{30}}
        devices.emit = events.append; devices.ended = lambda reason: self.fail(reason)
        devices.lib = SimpleNamespace(udev_monitor_receive_device=lambda _: object(), udev_device_get_devnode=lambda _: path,
            udev_device_get_action=lambda _: b'change', udev_device_unref=lambda _: None,
            udev_device_get_property_value=lambda _, key: b'1' if key == b'ID_INPUT_KEYBOARD' else b'seat1')
        self.assertTrue(devices.hotplug(None, GLib.IO_IN))
        self.assertEqual(closed, [True]); self.assertEqual(devices.devices, {})
        self.assertEqual(events, [{'type':'devices','devices':[],'selectedId':''},{'type':'status','mode':'waiting','keyboards':0},{'type':'reset','held':[]}])


class BusTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix='dobra-private-bus-')
        cls.daemon = subprocess.Popen(['dbus-daemon','--session','--nofork','--print-address=1'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        cls.address = cls.daemon.stdout.readline().strip()
        cls.processes = []
        for mode in ['authorities','broker']:
            process = subprocess.Popen(['/usr/bin/python3','-I', str(ROOT/'test/linux_input_fixture.py'),mode,cls.address], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            cls.processes.append(process)
            selector = selectors.DefaultSelector(); selector.register(process.stdout, selectors.EVENT_READ)
            if not selector.select(8): raise RuntimeError('Private fixture did not start')
            if process.stdout.readline().strip() != 'ready': raise RuntimeError(process.stderr.read())
            selector.close()
        cls.control = cls.connect()

    @classmethod
    def connect(cls):
        return Gio.DBusConnection.new_for_address_sync(cls.address, Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION, None, None)

    @classmethod
    def tearDownClass(cls):
        cls.control.close_sync(None)
        for process in reversed(cls.processes): process.terminate(); process.communicate(timeout=3)
        cls.daemon.terminate(); cls.daemon.communicate(timeout=3)
        cls.directory.cleanup()

    def setUp(self):
        self.actor = self.connect(); self.streams = []
        self.control_call('Authority', 'Reset')

    def tearDown(self):
        self.actor.close_sync(None)
        for stream in self.streams: stream.close()
        deadline = time.monotonic()+3
        while self.control_call('Broker','Stats','(u)').unpack()[0] and time.monotonic()<deadline: time.sleep(.02)

    def control_call(self, kind, method, result=None, params=None):
        return service.call(self.control, 'io.dobra.Test'+kind, '/test', 'io.dobra.Test', method, params, result)

    def set_props(self, **values):
        variants = {key: GLib.Variant('b' if type(value) is bool else 'u' if type(value) is int else 's',value) for key,value in values.items()}
        self.control_call('Authority','Set',params=GLib.Variant('(a{sv})',(variants,)))

    def start(self, keys=(30,), visual=False, observe=True, selected_id=""):
        reply, descriptors = self.actor.call_with_unix_fd_list_sync(service.NAME,service.PATH,service.INTERFACE,'Start',GLib.Variant('(saqbbs)',('test',list(keys),visual,observe,selected_id)),GLib.VariantType.new('(h)'),Gio.DBusCallFlags.NONE,5000,None,None)
        stream = socket.socket(fileno=descriptors.get(reply.unpack()[0])); stream.settimeout(3); self.streams.append(stream)
        return stream

    def receive(self, stream, kind):
        while True:
            event = json.loads(stream.recv(4096))
            if event['type'] == kind: return event

    def emit(self, code, down, keyboard='one'):
        self.control_call('Broker','Emit',params=GLib.Variant('(sqb)',(keyboard,code,down)))

    def test_private_stream_filter_and_normal_key_events(self):
        stream = self.start()
        first = self.receive(stream,'status'); self.assertEqual(first['type'],'status'); self.assertEqual(first['mode'],'global')
        self.assertEqual(json.loads(stream.recv(4096)), {'type':'reset','held':[]})
        self.emit(31,True); self.emit(30,True)
        event = self.receive(stream,'key'); self.assertGreaterEqual(event.pop('monotonicMs'),0)
        self.assertEqual(event, {'type':'key','code':30,'down':True,'modifiers':0})
        self.emit(29,True); self.assertEqual(self.receive(stream,'key')['modifiers'],1)
        self.emit(30,False); self.assertEqual(self.receive(stream,'key')['down'],False)
        self.assertEqual(self.control_call('Broker','Stats','(u)').unpack()[0],1)

    def test_unauthorized_peer_cannot_configure_or_stop_owner(self):
        stream = self.start(); self.receive(stream,'status')
        with self.assertRaises(GLib.Error):
            service.call(self.control,service.NAME,service.PATH,service.INTERFACE,'Configure',GLib.Variant('(aqbbs)',([31],True,True,'')))
        service.call(self.control,service.NAME,service.PATH,service.INTERFACE,'Stop')
        self.emit(30,True); self.assertEqual(self.receive(stream,'key')['code'],30)

    def test_polkit_denied_and_session_guards(self):
        for changes in [dict(allowed=False), dict(Active=False), dict(LockedHint=True), dict(Remote=True), dict(Class='greeter'), dict(uid=os.getuid()+1), dict(seat='')]:
            self.control_call('Authority','Reset'); self.set_props(**changes)
            with self.assertRaises(GLib.Error): self.start()
            self.assertEqual(self.control_call('Broker','Stats','(u)').unpack()[0],0)

    def test_idle_does_not_open_devices_and_configure_is_reversible(self):
        stream = self.start(observe=False); self.assertEqual(self.receive(stream,'status')['mode'],'idle')
        self.assertEqual(self.control_call('Broker','Stats','(u)').unpack()[0],0)
        service.call(self.actor,service.NAME,service.PATH,service.INTERFACE,'Configure',GLib.Variant('(aqbbs)',([30],False,True,'')))
        self.assertEqual(self.receive(stream,'status')['mode'],'global')
        service.call(self.actor,service.NAME,service.PATH,service.INTERFACE,'Configure',GLib.Variant('(aqbbs)',([],False,False,'')))
        self.assertEqual(self.receive(stream,'status')['mode'],'idle')
        self.assertEqual(self.control_call('Broker','Stats','(u)').unpack()[0],0)

    def test_lock_closes_devices_and_requires_new_authorization(self):
        stream = self.start(); self.receive(stream,'status'); self.emit(30,True); self.receive(stream,'key')
        self.control_call('Authority','Lock')
        self.assertEqual(self.receive(stream,'ended')['reason'],'session-suspended')
        with self.assertRaises(GLib.Error): service.call(self.actor,service.NAME,service.PATH,service.INTERFACE,'Ping')
        self.assertEqual(self.control_call('Broker','Stats','(u)').unpack()[0],0)

    def test_sleep_and_session_deactivation_close_devices(self):
        stream = self.start(); self.receive(stream,'status'); self.control_call('Authority','Sleep')
        self.assertEqual(self.receive(stream,'ended')['reason'],'session-suspended')
        self.control_call('Authority','Reset')
        stream = self.start(); self.receive(stream,'status'); self.set_props(Active=False)
        self.assertEqual(self.receive(stream,'ended')['reason'],'session-suspended')

    def test_reset_preserves_held_state_without_synthetic_release(self):
        stream = self.start(); self.receive(stream,'status'); self.emit(30,True); self.receive(stream,'key')
        self.control_call('Broker','ResetInput')
        self.assertEqual(self.receive(stream,'status')['mode'],'global')
        self.assertEqual(self.receive(stream,'reset')['held'],[30])
        self.emit(30,False); self.assertEqual(self.receive(stream,'key')['down'],False)

    def test_disconnecting_client_revokes_private_stream(self):
        stream = self.start(); self.receive(stream,'status'); self.actor.close_sync(None)
        self.assertEqual(self.receive(stream,'ended')['reason'],'connection-lost')
        self.actor = self.connect()

    def test_production_bridge_uses_fd_protocol(self):
        env = {**os.environ,'DBUS_SYSTEM_BUS_ADDRESS':self.address,'XDG_SESSION_ID':'test'}
        child = subprocess.Popen(['/usr/bin/python3','-I',str(ROOT/'app/linux-input/client.py')], stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env)
        try:
            child.stdin.write(json.dumps({'type':'configure','keys':[30],'visual':False,'observe':True})+'\n'); child.stdin.flush()
            selector = selectors.DefaultSelector(); selector.register(child.stdout,selectors.EVENT_READ)
            # TextIO can buffer several frames, so use fd reads for this proof.
            os.set_blocking(child.stdout.fileno(),False)
            data = b''; deadline = time.monotonic()+5
            while b'"mode":"global"' not in data and time.monotonic()<deadline:
                if selector.select(.1): data += os.read(child.stdout.fileno(),8192)
            self.assertIn(b'"type":"connected"',data)
            self.assertIn(b'"mode":"global"',data)
            self.emit(30,True)
            deadline=time.monotonic()+3
            while b'"type":"key"' not in data and time.monotonic()<deadline:
                if selector.select(.1): data += os.read(child.stdout.fileno(),8192)
            self.assertIn(b'"code":30',data)
            self.control_call('Broker','LargeCatalog')
            deadline=time.monotonic()+3
            while b'large-keyboard-31' not in data and time.monotonic()<deadline:
                if selector.select(.1):
                    chunk=os.read(child.stdout.fileno(),65536)
                    if not chunk: break
                    data+=chunk
            self.assertIn(b'large-keyboard-31',data,'catalog above 4 KiB must cross the private datagram intact')
            child.stdin.close(); child.stdin=None
            self.assertEqual(child.wait(timeout=3),0)
        finally:
            if child.poll() is None: child.kill()
            child.communicate(timeout=3)

    def test_lock_during_authorization_never_opens_devices(self):
        self.set_props(delay=350)
        result = []
        def start():
            try: self.start(); result.append('authorized')
            except GLib.Error: result.append('denied')
        worker = threading.Thread(target=start); worker.start()
        time.sleep(.1); self.control_call('Authority','Lock'); worker.join(timeout=3)
        self.assertEqual(result,['denied'])
        self.assertEqual(self.control_call('Broker','Stats','(u)').unpack()[0],0)

    def test_visual_tracking_is_explicit_and_reversible(self):
        stream = self.start(); self.receive(stream,'status'); self.receive(stream,'reset'); self.emit(31,True)
        service.call(self.actor,service.NAME,service.PATH,service.INTERFACE,'Configure',GLib.Variant('(aqbbs)',([30],True,True,'')))
        self.receive(stream,'status'); self.assertIn(31,self.receive(stream,'reset')['held'])
        self.emit(32,True); self.assertEqual(self.receive(stream,'key')['code'],32)
        service.call(self.actor,service.NAME,service.PATH,service.INTERFACE,'Configure',GLib.Variant('(aqbbs)',([30],False,True,'')))
        self.assertEqual(self.receive(stream,'reset')['held'],[])

    def test_device_selection_is_transported_and_excludes_other_keyboard_modifiers(self):
        selected = 'linux:'+'2'*40
        stream = self.start(selected_id=selected)
        catalog = self.receive(stream,'devices')
        self.assertEqual(catalog['selectedId'], selected)
        self.assertEqual(len(catalog['devices']),2)
        self.receive(stream,'status'); self.receive(stream,'reset')
        self.emit(29,True,keyboard='one'); self.emit(30,True,keyboard='one')
        self.emit(30,True,keyboard='two')
        event = self.receive(stream,'key')
        self.assertEqual(event['code'],30); self.assertEqual(event['modifiers'],0)
        service.call(self.actor,service.NAME,service.PATH,service.INTERFACE,'Configure',GLib.Variant('(aqbbs)',([30],False,True,'linux:'+'3'*40)))
        self.assertEqual(self.receive(stream,'status')['mode'],'waiting')
        self.assertEqual(self.receive(stream,'reset')['held'],[])

    def test_slow_reader_is_disconnected_instead_of_losing_keyups(self):
        stream = self.start(); self.receive(stream,'status')
        for index in range(400): self.emit(30,index%2==0)
        self.assertEqual(self.control_call('Broker','Stats','(u)').unpack()[0],0)

    def test_missing_heartbeat_closes_devices(self):
        stream = self.start(); self.receive(stream,'status'); stream.settimeout(8)
        self.assertEqual(self.receive(stream,'ended')['reason'],'session-suspended')
        self.assertEqual(self.control_call('Broker','Stats','(u)').unpack()[0],0)

    def test_process_session_must_match_and_user_service_fallback_is_scoped(self):
        self.set_props(pid_path='/org/freedesktop/login1/session/other')
        with self.assertRaises(GLib.Error): self.start()
        self.set_props(no_pid=True,display_id='other')
        with self.assertRaises(GLib.Error): self.start()
        self.set_props(display_id='test')
        stream = self.start(); self.assertEqual(self.receive(stream,'status')['mode'],'global')


if __name__ == '__main__':
    unittest.main(verbosity=2)
