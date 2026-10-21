"""Read-only evdev input. No grabs, injection, text conversion or persistence."""
import ctypes as C
import errno
import os
import re
from gi.repository import GLib

EV_KEY, KEY_MAX = 1, 255
MODIFIERS = {29: 1, 97: 1, 56: 2, 100: 2, 42: 4, 54: 4, 125: 8, 126: 8}
MAX_DEVICES = 32


class InputEvent(C.Structure):
    _fields_ = [("seconds", C.c_long), ("micros", C.c_long),
                ("type", C.c_ushort), ("code", C.c_ushort), ("value", C.c_int)]


def library(name, signatures):
    lib = C.CDLL(name)
    for symbol, (result, arguments) in signatures.items():
        function = getattr(lib, symbol)
        function.restype, function.argtypes = result, arguments
    return lib


class Keyboard:
    def __init__(self, path):
        self.fd, self.device = -1, C.c_void_p()
        self.lib = library("libevdev.so.2", {
            "libevdev_new_from_fd": (C.c_int, [C.c_int, C.POINTER(C.c_void_p)]),
            "libevdev_free": (None, [C.c_void_p]),
            "libevdev_next_event": (C.c_int, [C.c_void_p, C.c_uint, C.POINTER(InputEvent)]),
            "libevdev_get_event_value": (C.c_int, [C.c_void_p, C.c_uint, C.c_uint]),
        })
        try:
            self.fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_CLOEXEC | os.O_NOFOLLOW)
            if self.lib.libevdev_new_from_fd(self.fd, C.byref(self.device)) < 0:
                raise OSError("Invalid evdev keyboard")
        except Exception:
            self.close()
            raise

    def held(self):
        return {code for code in range(1, KEY_MAX + 1)
                if self.lib.libevdev_get_event_value(self.device, EV_KEY, code) > 0}

    def events(self):
        self.needs_drain = False
        events = []
        event = InputEvent()
        for _ in range(256):
            result = self.lib.libevdev_next_event(self.device, 2, C.byref(event))
            if result == -errno.EAGAIN:
                return events, False
            if result == 1:  # SYN_DROPPED: synchronize without synthetic releases.
                for _ in range(1024):
                    result = self.lib.libevdev_next_event(self.device, 1, C.byref(event))
                    if result == -errno.EAGAIN:
                        self.needs_drain = True
                        return [], True
                    if result < 0:
                        raise OSError("Input synchronization failed")
                raise OSError("Input synchronization exceeded limit")
            if result < 0:
                raise OSError("Input device disconnected")
            if event.type == EV_KEY and 0 < event.code <= KEY_MAX and event.value in (0, 1):
                events.append((event.code, bool(event.value)))
        self.needs_drain = True
        return events, False

    def close(self):
        if self.device:
            self.lib.libevdev_free(self.device)
            self.device = C.c_void_p()
        if self.fd >= 0:
            os.close(self.fd)
            self.fd = -1


class KeyState:
    """Aggregate devices: releasing one keyboard never releases another's key."""
    def __init__(self):
        self.devices = {}

    def held(self):
        return set().union(*self.devices.values()) if self.devices else set()

    def event(self, device, code, down):
        keys = self.devices[device]
        if (code in keys) == down:
            return None
        keys.add(code) if down else keys.discard(code)
        if any(code in held for name, held in self.devices.items() if name != device):
            return None
        flags = 0
        for modifier, flag in MODIFIERS.items():
            if any(modifier in held for held in self.devices.values()):
                flags |= flag
        return {"type": "key", "code": code, "down": down, "modifiers": flags}


class Devices:
    def __init__(self, seat, emit, ended, keyboard_factory=Keyboard):
        self.seat, self.emit, self.ended = seat, emit, ended
        self.keyboard_factory = keyboard_factory
        self.devices, self.sources, self.drains, self.state = {}, {}, {}, KeyState()
        self.lib = library("libudev.so.1", {
            "udev_new": (C.c_void_p, []), "udev_unref": (C.c_void_p, [C.c_void_p]),
            "udev_enumerate_new": (C.c_void_p, [C.c_void_p]),
            "udev_enumerate_unref": (C.c_void_p, [C.c_void_p]),
            "udev_enumerate_add_match_subsystem": (C.c_int, [C.c_void_p, C.c_char_p]),
            "udev_enumerate_scan_devices": (C.c_int, [C.c_void_p]),
            "udev_enumerate_get_list_entry": (C.c_void_p, [C.c_void_p]),
            "udev_list_entry_get_name": (C.c_char_p, [C.c_void_p]),
            "udev_list_entry_get_next": (C.c_void_p, [C.c_void_p]),
            "udev_device_new_from_syspath": (C.c_void_p, [C.c_void_p, C.c_char_p]),
            "udev_device_get_devnode": (C.c_char_p, [C.c_void_p]),
            "udev_device_get_property_value": (C.c_char_p, [C.c_void_p, C.c_char_p]),
            "udev_device_get_action": (C.c_char_p, [C.c_void_p]),
            "udev_device_unref": (C.c_void_p, [C.c_void_p]),
            "udev_monitor_new_from_netlink": (C.c_void_p, [C.c_void_p, C.c_char_p]),
            "udev_monitor_filter_add_match_subsystem_devtype": (C.c_int, [C.c_void_p, C.c_char_p, C.c_char_p]),
            "udev_monitor_enable_receiving": (C.c_int, [C.c_void_p]),
            "udev_monitor_get_fd": (C.c_int, [C.c_void_p]),
            "udev_monitor_receive_device": (C.c_void_p, [C.c_void_p]),
            "udev_monitor_unref": (C.c_void_p, [C.c_void_p]),
        })
        self.context, self.monitor, self.monitor_source = self.lib.udev_new(), None, None
        if not self.context:
            raise OSError("udev unavailable")
        try:
            self.monitor = self.lib.udev_monitor_new_from_netlink(self.context, b"udev")
            if not self.monitor or self.lib.udev_monitor_filter_add_match_subsystem_devtype(self.monitor, b"input", None) < 0 or self.lib.udev_monitor_enable_receiving(self.monitor) < 0:
                raise OSError("udev monitor unavailable")
            self.monitor_source = GLib.io_add_watch(self.lib.udev_monitor_get_fd(self.monitor), GLib.IO_IN | GLib.IO_ERR | GLib.IO_HUP, self.hotplug)
            enumeration = self.lib.udev_enumerate_new(self.context)
            if not enumeration:
                raise OSError("udev enumeration unavailable")
            try:
                if self.lib.udev_enumerate_add_match_subsystem(enumeration, b"input") < 0 or self.lib.udev_enumerate_scan_devices(enumeration) < 0:
                    raise OSError("udev enumeration failed")
                entry = self.lib.udev_enumerate_get_list_entry(enumeration)
                while entry:
                    device = self.lib.udev_device_new_from_syspath(self.context, self.lib.udev_list_entry_get_name(entry))
                    if device:
                        try:
                            self.add(device)
                        finally:
                            self.lib.udev_device_unref(device)
                    entry = self.lib.udev_list_entry_get_next(entry)
            finally:
                self.lib.udev_enumerate_unref(enumeration)
        except Exception:
            self.close()
            raise

    def add(self, device):
        path = self.lib.udev_device_get_devnode(device)
        if not path or not re.fullmatch(rb"/dev/input/event[0-9]+", path) or path in self.devices:
            return False
        prop = self.lib.udev_device_get_property_value
        if prop(device, b"ID_INPUT_KEYBOARD") != b"1" or (prop(device, b"ID_SEAT") or b"seat0").decode() != self.seat:
            return False
        if len(self.devices) >= MAX_DEVICES:
            raise OSError("Keyboard limit exceeded")
        keyboard = self.keyboard_factory(path)
        self.devices[path] = keyboard
        self.state.devices[path] = keyboard.held()
        self.sources[path] = GLib.io_add_watch(keyboard.fd, GLib.IO_IN | GLib.IO_ERR | GLib.IO_HUP, self.read, path)
        return True

    def read(self, _fd, condition, path):
        try:
            if condition & (GLib.IO_ERR | GLib.IO_HUP):
                self.remove(path)
                self.snapshot()
                return False
            events, reset = self.devices[path].events()
            if reset:
                self.state.devices[path] = self.devices[path].held()
                self.snapshot()
            else:
                for code, down in events:
                    event = self.state.event(path, code, down)
                    if event:
                        self.emit(event)
            # libevdev can retain events after draining the kernel fd. Continue
            # in a bounded idle callback even when that fd is no longer ready.
            if path in self.devices and getattr(self.devices[path], "needs_drain", False) and path not in self.drains:
                self.drains[path] = GLib.idle_add(self.drain, path)
            return path in self.devices
        except Exception:
            self.ended("device-error")
            return False

    def drain(self, path):
        self.drains.pop(path, None)
        if path in self.devices:
            self.read(None, GLib.IO_IN, path)
        return False

    def snapshot(self):
        self.emit({"type": "reset", "held": sorted(self.state.held())})
        self.emit({"type": "status", "mode": "global" if self.devices else "waiting", "keyboards": len(self.devices)})

    def remove(self, path):
        drain = self.drains.pop(path, None)
        if drain:
            GLib.source_remove(drain)
        source = self.sources.pop(path, None)
        if source:
            GLib.source_remove(source)
        keyboard = self.devices.pop(path, None)
        if keyboard:
            keyboard.close()
        self.state.devices.pop(path, None)
        return keyboard is not None

    def hotplug(self, _fd, condition):
        try:
            if condition & (GLib.IO_ERR | GLib.IO_HUP):
                raise OSError("udev disconnected")
            device = self.lib.udev_monitor_receive_device(self.monitor)
            if not device:
                return True
            try:
                path = self.lib.udev_device_get_devnode(device)
                action = self.lib.udev_device_get_action(device)
                if action == b"remove":
                    changed = self.remove(path)
                elif action == b"change":
                    removed = self.remove(path)
                    changed = self.add(device) or removed
                elif action == b"add":
                    changed = self.add(device)
                else:
                    changed = False
                if changed:
                    self.snapshot()
            finally:
                self.lib.udev_device_unref(device)
            return True
        except Exception:
            self.ended("device-error")
            return False

    def close(self):
        if self.monitor_source:
            GLib.source_remove(self.monitor_source)
            self.monitor_source = None
        for path in list(self.devices):
            self.remove(path)
        if self.monitor:
            self.lib.udev_monitor_unref(self.monitor)
            self.monitor = None
        if self.context:
            self.lib.udev_unref(self.context)
            self.context = None
