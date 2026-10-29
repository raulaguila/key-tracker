"""Read native AT-SPI or send X11 keys on the isolated test display."""
import ctypes
import json
import sys
import time

import gi

gi.require_version('Atspi', '2.0')
from gi.repository import Atspi


def snapshot():
    rows = []

    def walk(node, depth):
        if depth > 30 or len(rows) > 2500:
            return
        state = node.get_state_set()
        rows.append({
            'role': node.get_role_name(),
            'name': node.get_name(),
            'description': node.get_description(),
            'focused': state.contains(Atspi.StateType.FOCUSED),
            'states': [item.value_nick for item in state.get_states()],
            'attributes': node.get_attributes(),
        })
        for index in range(node.get_child_count()):
            walk(node.get_child_at_index(index), depth + 1)

    walk(Atspi.get_desktop(0), 0)
    print(json.dumps(rows, ensure_ascii=False))


def send_keys(chords):
    x11 = ctypes.CDLL('libX11.so.6')
    xtst = ctypes.CDLL('libXtst.so.6')
    x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
    x11.XOpenDisplay.restype = ctypes.c_void_p
    x11.XStringToKeysym.argtypes = [ctypes.c_char_p]
    x11.XStringToKeysym.restype = ctypes.c_ulong
    x11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    x11.XKeysymToKeycode.restype = ctypes.c_uint
    x11.XSync.argtypes = [ctypes.c_void_p, ctypes.c_int]
    x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
    xtst.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
    display = x11.XOpenDisplay(None)
    if not display:
        raise RuntimeError('No test display')
    try:
        for chord in chords:
            codes = [x11.XKeysymToKeycode(display, x11.XStringToKeysym(key.encode())) for key in chord.split('+')]
            for code in codes:
                xtst.XTestFakeKeyEvent(display, code, 1, 0)
            for code in reversed(codes):
                xtst.XTestFakeKeyEvent(display, code, 0, 0)
            x11.XSync(display, 0)
            time.sleep(.18)
    finally:
        x11.XCloseDisplay(display)


if __name__ == '__main__':
    if len(sys.argv) > 1:
        send_keys(sys.argv[1:])
    else:
        snapshot()
